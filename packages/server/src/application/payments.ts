import { createHash } from 'node:crypto';
import {
  CreatePaymentIntentSchema,
  PaymentIntentResponseSchema,
  ProviderEventSchema,
  RetryPaymentIntentSchema,
  type CreatePaymentIntent,
  type PaymentIntentResponse,
  type ProviderEvent,
  type RetryPaymentIntent,
} from '../contracts/payments.ts';
import { NotFoundError } from '../domain/index.ts';
import type { PrismaClient } from '../infra/db/index.ts';
import { DeliveryAddressEligibilityError, getConfirmedDeliveryAddressInput } from './delivery-addresses.ts';
import { PaymentProviderDisabledError, type PaymentProviderPort } from './payment-provider.ts';
import { ORDER_RECOVERY_JOB_TYPE, ensureOrderForSucceededPayment } from './orders.ts';
import { createJob } from '../infra/jobs/index.ts';
import { isSerializableTransactionConflict, withSerializableTransactionRetry } from './transaction-retry.ts';
import { AdminRequiredError } from './check-runs.ts';

export class PaymentConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'PaymentConflictError'; }
}
export class PaymentEligibilityError extends Error {
  constructor(message: string) { super(message); this.name = 'PaymentEligibilityError'; }
}

function errorCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;
}

function fingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sameInstant(left: Date, right: string) {
  const parsed = new Date(right);
  return !Number.isNaN(parsed.getTime()) && left.getTime() === parsed.getTime();
}

async function requireTrustedProvider(prisma: PrismaClient, provider: PaymentProviderPort) {
  const trusted = await prisma.paymentProviderTrust.findUnique({ where: { provider: provider.name } });
  if (!trusted || !trusted.sandboxOnly || trusted.verificationKeyHash !== provider.verificationKeyHash) {
    throw new PaymentProviderDisabledError('支付 provider 与数据库可信配置不匹配');
  }
}

type IntentWithAttempts = Awaited<ReturnType<PrismaClient['paymentIntent']['findUniqueOrThrow']>> & {
  attempts: Array<{
    id: string; attemptNo: number; provider: string; providerPaymentId: string; status: string;
    failureCode: string | null; failureMessage: string | null; createdAt: Date; resolvedAt: Date | null;
  }>;
  order: { id: string } | null;
};

type RecoveryJob = {
  id: string;
  ownerUserId: string;
  idempotencyKey: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  errorClass: string | null;
  errorDetail: unknown;
  updatedAt: Date;
};

function recoveryJobKey(ownerUserId: string, paymentIntentId: string) {
  return `${ownerUserId}:${paymentIntentId}`;
}

function deriveRecoveryState(row: IntentWithAttempts, job: RecoveryJob | null) {
  if (row.status === 'needs_attention') {
    return { recoveryAction: 'contact_support' as const, orderRecoveryStatus: 'needs_attention' as const };
  }
  if (row.order) return { recoveryAction: 'view_order' as const, orderRecoveryStatus: 'order_created' as const };
  if (row.status !== 'succeeded') {
    if (row.status === 'requires_action') {
      return { recoveryAction: 'complete_payment' as const, orderRecoveryStatus: 'not_succeeded' as const };
    }
    if (row.status === 'failed' || row.status === 'canceled') {
      return { recoveryAction: 'retry_payment' as const, orderRecoveryStatus: 'not_succeeded' as const };
    }
    return { recoveryAction: 'wait' as const, orderRecoveryStatus: 'not_succeeded' as const };
  }
  if (job?.status === 'pending' || job?.status === 'running') {
    return { recoveryAction: 'wait' as const, orderRecoveryStatus: 'recovering' as const };
  }
  if (job?.status === 'failed') {
    return { recoveryAction: 'contact_support' as const, orderRecoveryStatus: 'failed' as const };
  }
  return { recoveryAction: 'contact_support' as const, orderRecoveryStatus: 'needs_attention' as const };
}

function toResponse(row: IntentWithAttempts, recoveryJob: RecoveryJob | null): PaymentIntentResponse {
  const recovery = deriveRecoveryState(row, recoveryJob);
  return PaymentIntentResponseSchema.parse({
    id: row.id,
    quoteId: row.quoteId,
    deliveryAddressId: row.deliveryAddressId,
    deliveryAddressVersion: row.deliveryAddressVersion,
    amountCent: row.amountCent,
    currency: row.currency,
    mode: row.mode,
    provider: row.provider,
    sandboxOnly: row.sandboxOnly,
    status: row.status,
    attentionCode: row.status === 'needs_attention' ? row.attentionCode ?? 'unspecified' : null,
    ...recovery,
    label: '沙箱支付（不会发生真实扣款或成交）',
    attempts: row.attempts.map((attempt) => ({
      id: attempt.id,
      attemptNo: attempt.attemptNo,
      provider: attempt.provider,
      providerPaymentId: attempt.providerPaymentId,
      status: attempt.status,
      actionUrl: `/sandbox-pay/${attempt.id}`,
      failureCode: attempt.failureCode,
      failureMessage: attempt.failureMessage,
      createdAt: attempt.createdAt.toISOString(),
      resolvedAt: attempt.resolvedAt?.toISOString() ?? null,
    })),
    succeededAt: row.succeededAt?.toISOString() ?? null,
    failedAt: row.failedAt?.toISOString() ?? null,
    canceledAt: row.canceledAt?.toISOString() ?? null,
    needsAttentionAt: row.needsAttentionAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

async function readIntent(prisma: PrismaClient, id: string) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.paymentIntent.findUniqueOrThrow({
      where: { id },
      include: { attempts: { orderBy: { attemptNo: 'asc' } }, order: { select: { id: true } } },
    }) as unknown as IntentWithAttempts;
    const recoveryJob = await tx.job.findUnique({
      where: { job_owner_type_idempotency_key: {
        ownerUserId: row.ownerUserId, type: ORDER_RECOVERY_JOB_TYPE, idempotencyKey: row.id,
      } },
    }) as unknown as RecoveryJob | null;
    return toResponse(row, recoveryJob);
  }, { isolationLevel: 'RepeatableRead' });
}

async function readRecoveryJobs(prisma: PrismaClient, rows: IntentWithAttempts[]) {
  if (rows.length === 0) return new Map<string, RecoveryJob>();
  const jobs = await prisma.job.findMany({
    where: { type: ORDER_RECOVERY_JOB_TYPE, idempotencyKey: { in: rows.map(({ id }) => id) } },
  }) as unknown as RecoveryJob[];
  return new Map(jobs.map((job) => [recoveryJobKey(job.ownerUserId, job.idempotencyKey), job]));
}

async function ensureAttempt(prisma: PrismaClient, provider: PaymentProviderPort, intentId: string, attemptNo: number) {
  const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intentId } });
  const existing = await prisma.paymentAttempt.findUnique({
    where: { paymentIntentId_attemptNo: { paymentIntentId: intent.id, attemptNo } },
  });
  if (existing) {
    if (existing.provider !== provider.name) throw new PaymentConflictError('支付尝试的 provider 与当前可信 provider 不一致');
    return;
  }
  const created = await provider.createPayment({
    merchantPaymentId: `${intent.id}:${attemptNo}`,
    amountCent: intent.amountCent,
    currency: 'CNY',
  });
  const providerPayment = created.payment;
  if (providerPayment.status !== 'requires_action') {
    throw new PaymentConflictError('sandbox provider 创建支付时只允许返回 requires_action');
  }
  if (providerPayment.amountCent !== intent.amountCent || providerPayment.currency !== intent.currency) {
    throw new PaymentConflictError('provider 创建支付返回的金额或币种不一致');
  }
  if (!providerPayment.providerPaymentId || Number.isNaN(new Date(providerPayment.updatedAt).getTime())) {
    throw new PaymentConflictError('provider 创建支付返回的身份或时间非法');
  }
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ set_config: string }>>`
        SELECT set_config('petscape.payment_attempt_proof', ${created.persistenceProof}, true)
      `;
      await tx.paymentAttempt.create({ data: {
        paymentIntentId: intent.id,
        attemptNo,
        provider: provider.name,
        providerPaymentId: providerPayment.providerPaymentId,
        status: providerPayment.status,
        providerObservedStatus: providerPayment.status,
        providerObservedAt: new Date(providerPayment.updatedAt),
      } });
    });
  } catch (error) {
    if (!errorCode(error, 'P2002')) throw error;
    const raced = await prisma.paymentAttempt.findUnique({
      where: { paymentIntentId_attemptNo: { paymentIntentId: intent.id, attemptNo } },
    });
    if (!raced || raced.provider !== provider.name ||
        raced.providerPaymentId !== providerPayment.providerPaymentId ||
        raced.status !== providerPayment.status || raced.providerObservedStatus !== providerPayment.status ||
        !sameInstant(raced.providerObservedAt, providerPayment.updatedAt)) {
      throw new PaymentConflictError('provider payment ID 或支付尝试唯一键发生身份冲突');
    }
  }
}

export async function createPaymentIntent({ prisma, provider, ownerUserId, input: untrusted }: {
  prisma: PrismaClient; provider: PaymentProviderPort; ownerUserId: string; input: CreatePaymentIntent;
}): Promise<{ paymentIntent: PaymentIntentResponse; created: boolean }> {
  await requireTrustedProvider(prisma, provider);
  const input = CreatePaymentIntentSchema.parse(untrusted);
  const existingByKey = await prisma.paymentIntent.findFirst({ where: { ownerUserId, idempotencyKey: input.idempotencyKey } });
  if (existingByKey) {
    if (existingByKey.quoteId !== input.quoteId) throw new PaymentConflictError('同一 idempotencyKey 不得跨 Quote 使用');
    await ensureAttempt(prisma, provider, existingByKey.id, 1);
    return { paymentIntent: await readIntent(prisma, existingByKey.id), created: false };
  }

  let createdId: string | null = null;
  try {
    const result = await withSerializableTransactionRetry(() => prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "quote" WHERE "id"=${input.quoteId} AND "ownerUserId"=${ownerUserId} FOR UPDATE
      `;
      if (locked.length !== 1) throw new NotFoundError('Quote');
      const raced = await tx.paymentIntent.findFirst({ where: { ownerUserId, idempotencyKey: input.idempotencyKey } });
      if (raced) {
        if (raced.quoteId !== input.quoteId) throw new PaymentConflictError('同一 idempotencyKey 不得跨 Quote 使用');
        return { id: raced.id, created: false as const };
      }
      const quote = await tx.quote.findUniqueOrThrow({ where: { id: input.quoteId } });
      if (quote.status !== 'accepted' || !quote.acceptedAt || !quote.sandboxOnly) {
        throw new PaymentEligibilityError('只有已接受的沙箱 Quote 可以创建支付意图');
      }
      let address;
      try {
        address = await getConfirmedDeliveryAddressInput({ prisma: tx as PrismaClient, ownerUserId, quoteId: quote.id });
      } catch (error) {
        if (error instanceof DeliveryAddressEligibilityError) throw new PaymentEligibilityError(error.message);
        throw error;
      }
      const row = await tx.paymentIntent.create({ data: {
        ownerUserId,
        quoteId: quote.id,
        deliveryAddressId: address.addressId,
        deliveryAddressVersion: address.version,
        deliveryAddressSnapshot: address,
        amountCent: quote.amountCent,
        currency: quote.currency,
        mode: 'sandbox_test',
        provider: provider.name,
        sandboxOnly: true,
        status: 'requires_action',
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: fingerprint({ quoteId: input.quoteId }),
        verificationKeyHash: provider.verificationKeyHash,
      } });
      return { id: row.id, created: true as const };
    }, { isolationLevel: 'Serializable' }));
    createdId = result.id;
    await ensureAttempt(prisma, provider, result.id, 1);
    return { paymentIntent: await readIntent(prisma, result.id), created: result.created };
  } catch (error) {
    if (errorCode(error, 'P2002')) {
      const existing = await prisma.paymentIntent.findFirst({ where: { ownerUserId, OR: [{ idempotencyKey: input.idempotencyKey }, { quoteId: input.quoteId }] } });
      if (existing && existing.quoteId === input.quoteId && existing.idempotencyKey === input.idempotencyKey) {
        await ensureAttempt(prisma, provider, existing.id, 1);
        return { paymentIntent: await readIntent(prisma, existing.id), created: false };
      }
      throw new PaymentConflictError('该 Quote 已有不同的支付意图');
    }
    if (createdId) throw new PaymentConflictError('支付渠道初始化失败，可使用同一幂等键重试');
    throw error;
  }
}

export async function listPaymentIntents({ prisma, ownerUserId }: { prisma: PrismaClient; ownerUserId: string }) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.paymentIntent.findMany({
      where: { ownerUserId },
      include: { attempts: { orderBy: { attemptNo: 'asc' } }, order: { select: { id: true } } },
      orderBy: { createdAt: 'desc' },
    }) as unknown as IntentWithAttempts[];
    const jobs = await readRecoveryJobs(tx as PrismaClient, rows);
    return rows.map((row) => toResponse(row, jobs.get(recoveryJobKey(row.ownerUserId, row.id)) ?? null));
  }, { isolationLevel: 'RepeatableRead' });
}

function stableJobErrorCode(job: RecoveryJob) {
  if (!job.errorDetail || typeof job.errorDetail !== 'object' || !('code' in job.errorDetail)) {
    return job.status === 'failed' || job.status === 'needs_attention' ? 'order_recovery_failed' : null;
  }
  const code = (job.errorDetail as { code?: unknown }).code;
  return typeof code === 'string' && /^[a-z0-9_.-]{1,80}$/i.test(code) ? code : 'order_recovery_failed';
}

function stableJobErrorSummary(job: RecoveryJob) {
  if (job.status === 'failed') return '订单补单失败，请按 Job ID 查询受控日志';
  if (job.status === 'needs_attention') return '订单补单需要人工检查，请按 Job ID 查询受控日志';
  return null;
}

export async function listAdminPaymentAttention({ prisma, actorUserId }: { prisma: PrismaClient; actorUserId: string }) {
  return prisma.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { role: true } });
    if (actor?.role !== 'admin') throw new AdminRequiredError();
    const rows = await tx.paymentIntent.findMany({
      where: { OR: [
        { status: 'needs_attention' },
        { status: 'succeeded', order: { is: null } },
      ] },
      include: { attempts: { orderBy: { attemptNo: 'asc' } }, order: { select: { id: true } } },
      orderBy: { updatedAt: 'desc' },
    }) as unknown as IntentWithAttempts[];
    const jobs = await readRecoveryJobs(tx as PrismaClient, rows);
    return rows.map((row) => ({
      ownerUserId: row.ownerUserId,
      paymentIntent: toResponse(row, jobs.get(recoveryJobKey(row.ownerUserId, row.id)) ?? null),
      recoveryJob: (() => {
        const job = jobs.get(recoveryJobKey(row.ownerUserId, row.id));
        return job ? {
          id: job.id,
          status: job.status,
          attemptCount: job.attemptCount,
          maxAttempts: job.maxAttempts,
          errorClass: job.errorClass,
          errorCode: stableJobErrorCode(job),
          errorSummary: stableJobErrorSummary(job),
          updatedAt: job.updatedAt.toISOString(),
        } : null;
      })(),
    }));
  }, { isolationLevel: 'RepeatableRead' });
}

export async function getPaymentIntent({ prisma, ownerUserId, paymentIntentId }: {
  prisma: PrismaClient; ownerUserId: string; paymentIntentId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.paymentIntent.findFirst({
      where: { id: paymentIntentId, ownerUserId },
      include: { attempts: { orderBy: { attemptNo: 'asc' } }, order: { select: { id: true } } },
    }) as unknown as IntentWithAttempts | null;
    if (!row) throw new NotFoundError('PaymentIntent');
    const recoveryJob = await tx.job.findUnique({ where: { job_owner_type_idempotency_key: {
      ownerUserId, type: ORDER_RECOVERY_JOB_TYPE, idempotencyKey: paymentIntentId,
    } } }) as unknown as RecoveryJob | null;
    return toResponse(row, recoveryJob);
  }, { isolationLevel: 'RepeatableRead' });
}

export async function retryPaymentIntent({ prisma, provider, ownerUserId, paymentIntentId, input: untrusted }: {
  prisma: PrismaClient; provider: PaymentProviderPort; ownerUserId: string; paymentIntentId: string; input: RetryPaymentIntent;
}) {
  await requireTrustedProvider(prisma, provider);
  const input = RetryPaymentIntentSchema.parse(untrusted);
  const reconciled = await reconcilePaymentIntent({ prisma, provider, ownerUserId, paymentIntentId });
  if (reconciled.status !== input.expectedStatus) {
    throw new PaymentConflictError(`支付状态已从 ${input.expectedStatus} 变化为 ${reconciled.status}`);
  }
  for (let retryNo = 0; retryNo < 5; retryNo += 1) {
    try {
      await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "payment_intent" WHERE "id"=${paymentIntentId} AND "ownerUserId"=${ownerUserId} FOR UPDATE
        `;
        if (locked.length !== 1) throw new NotFoundError('PaymentIntent');
        const row = await tx.paymentIntent.findUniqueOrThrow({ where: { id: paymentIntentId }, include: { attempts: true } });
        if (row.status !== input.expectedStatus) throw new PaymentConflictError('支付状态已变化，请刷新后重试');
        if (row.attempts.some((attempt) =>
          ['succeeded', 'processing'].includes(attempt.status) ||
          ['succeeded', 'processing'].includes(attempt.providerObservedStatus))) {
          throw new PaymentConflictError('存在已成功或处理中的渠道尝试，禁止创建新支付尝试');
        }
        const nextAttemptNo = Math.max(...row.attempts.map((attempt) => attempt.attemptNo)) + 1;
        const created = await provider.createPayment({
          merchantPaymentId: `${row.id}:${nextAttemptNo}`, amountCent: row.amountCent, currency: 'CNY',
        });
        const providerPayment = created.payment;
        if (providerPayment.status !== 'requires_action' || providerPayment.amountCent !== row.amountCent ||
            providerPayment.currency !== row.currency || !providerPayment.providerPaymentId ||
            Number.isNaN(new Date(providerPayment.updatedAt).getTime())) {
          throw new PaymentConflictError('sandbox provider 创建重试支付时返回了不可信结果');
        }
        await tx.$queryRaw<Array<{ set_config: string }>>`
          SELECT set_config('petscape.payment_attempt_proof', ${created.persistenceProof}, true)
        `;
        await tx.paymentAttempt.create({ data: {
          paymentIntentId, attemptNo: nextAttemptNo, provider: provider.name,
          providerPaymentId: providerPayment.providerPaymentId, status: providerPayment.status,
          providerObservedStatus: providerPayment.status, providerObservedAt: new Date(providerPayment.updatedAt),
        } });
        await tx.paymentIntent.update({ where: { id: paymentIntentId }, data: {
          status: 'requires_action', attentionCode: null, failedAt: null, canceledAt: null,
        } });
      }, { isolationLevel: 'Serializable' });
      return readIntent(prisma, paymentIntentId);
    } catch (error) {
      if (isSerializableTransactionConflict(error) && retryNo < 4) continue;
      if (isSerializableTransactionConflict(error)) throw new PaymentConflictError('支付重试发生并发冲突，请刷新后重试');
      if (errorCode(error, 'P2002')) throw new PaymentConflictError('支付状态已变化');
      throw error;
    }
  }
  throw new PaymentConflictError('支付重试发生并发冲突，请刷新后重试');
}

function intentStateData(status: ProviderEvent['status'], occurredAt: Date) {
  if (status === 'succeeded') return { status, attentionCode: null, succeededAt: occurredAt, failedAt: null, canceledAt: null, needsAttentionAt: null };
  if (status === 'failed') return { status, attentionCode: null, succeededAt: null, failedAt: occurredAt, canceledAt: null, needsAttentionAt: null };
  if (status === 'canceled') return { status, attentionCode: null, succeededAt: null, failedAt: null, canceledAt: occurredAt, needsAttentionAt: null };
  return { status, attentionCode: null, succeededAt: null, failedAt: null, canceledAt: null, needsAttentionAt: null };
}

function canApplyAttemptStatus(current: string, next: ProviderEvent['status']) {
  if (current === next) return true;
  if (current === 'requires_action') return ['processing', 'succeeded', 'failed', 'canceled'].includes(next);
  if (current === 'processing') return ['succeeded', 'failed', 'canceled'].includes(next);
  return false;
}

function eventPayload(event: ProviderEvent) {
  return { status: event.status, failureCode: event.failureCode, failureMessage: event.failureMessage };
}

function duplicateEventMatches(
  duplicate: {
    provider: string; providerPaymentId: string; source: string; providerStatus: string;
    amountCent: number; currency: string; occurredAt: Date; sanitizedPayload: unknown;
  },
  event: ProviderEvent,
  source: 'webhook' | 'sandbox_action' | 'query',
) {
  const payload = duplicate.sanitizedPayload && typeof duplicate.sanitizedPayload === 'object'
    ? duplicate.sanitizedPayload as { status?: unknown; failureCode?: unknown; failureMessage?: unknown }
    : null;
  return duplicate.provider === event.provider && duplicate.providerPaymentId === event.providerPaymentId &&
    duplicate.source === source && duplicate.providerStatus === event.status && duplicate.amountCent === event.amountCent &&
    duplicate.currency === event.currency && duplicate.occurredAt.getTime() === new Date(event.occurredAt).getTime() &&
    payload !== null && payload.status === event.status && payload.failureCode === event.failureCode && payload.failureMessage === event.failureMessage &&
    Object.keys(payload).length === 3;
}

async function applyVerifiedEvent(
  prisma: PrismaClient,
  event: ProviderEvent,
  source: 'webhook' | 'sandbox_action' | 'query',
  persistenceProof: string,
) {
  for (let attemptNo = 0; attemptNo < 5; attemptNo += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
      const duplicate = await tx.paymentEvent.findUnique({ where: { providerEventId: event.providerEventId } });
      if (duplicate) {
        if (!duplicateEventMatches(duplicate, event, source)) {
          throw new PaymentConflictError('provider event ID 已被不同身份或 payload 使用');
        }
        return { duplicate: true as const, paymentIntentId: duplicate.paymentIntentId };
      }
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "payment_attempt" WHERE "providerPaymentId"=${event.providerPaymentId} FOR UPDATE
      `;
      if (locked.length !== 1) throw new NotFoundError('PaymentAttempt');
      const attempt = await tx.paymentAttempt.findUniqueOrThrow({ where: { providerPaymentId: event.providerPaymentId } });
      const intent = await tx.paymentIntent.findUniqueOrThrow({ where: { id: attempt.paymentIntentId }, include: { attempts: true } });
      const occurredAt = new Date(event.occurredAt);
      let processingResult: 'applied' | 'ignored_stale' | 'needs_attention' = 'applied';
      let attentionCode: 'amount_mismatch' | 'stale_succeeded_attempt' | 'provider_state_conflict' | null = null;
      const moneyMismatch = event.amountCent !== intent.amountCent || event.currency !== intent.currency;
      const intentTerminal = ['succeeded', 'canceled', 'needs_attention'].includes(intent.status);
      const stale = intentTerminal || !canApplyAttemptStatus(attempt.status, event.status) ||
        (attempt.lastEventAt !== null && occurredAt <= attempt.lastEventAt);
      const latestNo = Math.max(...intent.attempts.map((item) => item.attemptNo));
      if (intent.status === 'needs_attention') {
        processingResult = 'ignored_stale';
      } else if (moneyMismatch) {
        processingResult = 'needs_attention';
        attentionCode = 'amount_mismatch';
      } else if (event.status === 'succeeded' && attempt.attemptNo !== latestNo) {
        processingResult = 'needs_attention';
        attentionCode = 'stale_succeeded_attempt';
      } else if (event.status === 'succeeded' && intent.status !== 'succeeded' &&
        (intentTerminal || !canApplyAttemptStatus(attempt.status, event.status))) {
        processingResult = 'needs_attention';
        attentionCode = 'provider_state_conflict';
      } else if (event.status === 'processing' &&
        (attempt.attemptNo !== latestNo || ['failed', 'canceled', 'needs_attention'].includes(intent.status))) {
        processingResult = 'needs_attention';
        attentionCode = 'provider_state_conflict';
      } else if (stale || attempt.attemptNo !== latestNo) processingResult = 'ignored_stale';

      await tx.$queryRaw<Array<{ set_config: string }>>`
        SELECT set_config('petscape.payment_event_proof', ${persistenceProof}, true)
      `;

      const storedEvent = await tx.paymentEvent.create({ data: {
        paymentIntentId: intent.id,
        paymentAttemptId: attempt.id,
        provider: event.provider,
        providerEventId: event.providerEventId,
        providerPaymentId: event.providerPaymentId,
        source,
        providerStatus: event.status,
        verified: true,
        amountCent: event.amountCent,
        currency: event.currency,
        occurredAt,
        sanitizedPayload: eventPayload(event),
        processingResult,
        processedAt: new Date(),
      } });

      if (processingResult === 'needs_attention') {
        await tx.paymentIntent.update({ where: { id: intent.id }, data: {
          status: 'needs_attention', attentionCode, succeededAt: null, failedAt: null, canceledAt: null, needsAttentionAt: occurredAt,
          lastAppliedEventId: storedEvent.id,
        } });
      } else if (processingResult === 'applied') {
        await tx.paymentAttempt.update({ where: { id: attempt.id }, data: {
          status: event.status,
          failureCode: event.status === 'failed' ? event.failureCode ?? 'provider_failed' : null,
          failureMessage: event.status === 'failed' ? event.failureMessage ?? '支付失败' : null,
          lastEventAt: occurredAt,
          lastAppliedEventId: storedEvent.id,
          resolvedAt: ['succeeded', 'failed', 'canceled'].includes(event.status) ? occurredAt : null,
        } });
        await tx.paymentIntent.update({ where: { id: intent.id }, data: {
          ...intentStateData(event.status, occurredAt), lastAppliedEventId: storedEvent.id,
        } });
        if (event.status === 'succeeded') {
          await createJob(tx as PrismaClient, {
            type: ORDER_RECOVERY_JOB_TYPE,
            ownerUserId: intent.ownerUserId,
            idempotencyKey: intent.id,
            input: { schemaVersion: 'order-recovery.v0', paymentIntentId: intent.id },
            maxAttempts: 5,
          });
        }
      }
      return { duplicate: false as const, paymentIntentId: intent.id };
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (errorCode(error, 'P2002')) {
        const duplicate = await prisma.paymentEvent.findUnique({ where: { providerEventId: event.providerEventId } });
        if (duplicate) {
          if (!duplicateEventMatches(duplicate, event, source)) {
            throw new PaymentConflictError('provider event ID 已被不同身份或 payload 使用');
          }
          return { duplicate: true as const, paymentIntentId: duplicate.paymentIntentId };
        }
      }
      if (isSerializableTransactionConflict(error) && attemptNo < 4) continue;
      if (isSerializableTransactionConflict(error)) throw new PaymentConflictError('支付事件并发处理失败，请重试');
      throw error;
    }
  }
  throw new PaymentConflictError('支付事件并发处理失败，请重试');
}

export async function ingestPaymentEvent({ prisma, provider, rawBody, signature, source = 'webhook' }: {
  prisma: PrismaClient; provider: PaymentProviderPort; rawBody: string; signature: string | null; source?: 'webhook' | 'sandbox_action';
}) {
  await requireTrustedProvider(prisma, provider);
  const verified = await provider.verifyEvent(rawBody, signature);
  const event = ProviderEventSchema.parse(verified.event);
  if (event.provider !== provider.name) throw new PaymentConflictError('支付事件 provider 与当前可信 provider 不一致');
  const applied = await applyVerifiedEvent(prisma, event, source, verified.persistenceProof);
  await ensureOrderForSucceededPayment({ prisma, paymentIntentId: applied.paymentIntentId });
  return applied;
}

export async function reconcilePaymentIntent({ prisma, provider, ownerUserId, paymentIntentId }: {
  prisma: PrismaClient; provider: PaymentProviderPort; ownerUserId: string; paymentIntentId: string;
}) {
  await requireTrustedProvider(prisma, provider);
  const current = await getPaymentIntent({ prisma, ownerUserId, paymentIntentId });
  if (current.attempts.length === 0) throw new PaymentEligibilityError('支付意图缺少渠道尝试');
  for (const attempt of current.attempts) {
    const verified = await provider.queryPayment(attempt.providerPaymentId);
    const queried = verified.payment;
    if (queried.providerPaymentId !== attempt.providerPaymentId) {
      throw new PaymentConflictError('provider 查单结果与被查询的 payment ID 不一致');
    }
    const event = ProviderEventSchema.parse({
      provider: provider.name,
      providerEventId: `query:${fingerprint({
        provider: provider.name,
        providerPaymentId: queried.providerPaymentId,
        status: queried.status,
        amountCent: queried.amountCent,
        currency: queried.currency,
        updatedAt: queried.updatedAt,
      })}`,
      providerPaymentId: queried.providerPaymentId,
      status: queried.status,
      amountCent: queried.amountCent,
      currency: queried.currency,
      occurredAt: queried.updatedAt,
      failureCode: queried.status === 'failed' ? 'sandbox_declined' : null,
      failureMessage: queried.status === 'failed' ? '沙箱支付失败' : null,
    });
    await applyVerifiedEvent(prisma, event, 'query', verified.persistenceProof);
  }
  await ensureOrderForSucceededPayment({ prisma, paymentIntentId });
  return getPaymentIntent({ prisma, ownerUserId, paymentIntentId });
}

export async function simulateSandboxPaymentAction({ prisma, provider, ownerUserId, attemptId, result }: {
  prisma: PrismaClient;
  provider: PaymentProviderPort & { simulate(providerPaymentId: string, status: ProviderEvent['status']): Promise<{ rawBody: string; signature: string }> };
  ownerUserId: string;
  attemptId: string;
  result: 'processing' | 'succeeded' | 'failed' | 'canceled';
}) {
  await requireTrustedProvider(prisma, provider);
  const attempt = await prisma.paymentAttempt.findFirst({
    where: { id: attemptId, paymentIntent: { ownerUserId } },
    select: { providerPaymentId: true },
  });
  if (!attempt) throw new NotFoundError('PaymentAttempt');
  const simulated = await provider.simulate(attempt.providerPaymentId, result);
  const applied = await ingestPaymentEvent({
    prisma, provider, rawBody: simulated.rawBody, signature: simulated.signature, source: 'sandbox_action',
  });
  return getPaymentIntent({ prisma, ownerUserId, paymentIntentId: applied.paymentIntentId });
}
