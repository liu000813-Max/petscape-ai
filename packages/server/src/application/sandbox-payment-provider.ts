import { createHmac, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { ProviderEventSchema, type ProviderEvent } from '../contracts/payments.ts';
import {
  PaymentProviderDisabledError,
  PaymentProviderSignatureError,
  type CreateProviderPaymentInput,
  type PaymentProviderPort,
  type ProviderPayment,
} from './payment-provider.ts';
import type { PrismaClient } from '../infra/db/index.ts';

export type SandboxPaymentStateStore = {
  read(providerPaymentId: string): Promise<ProviderPayment | null>;
  write(providerPaymentId: string, status: ProviderEvent['status'], updatedAt: string, persistenceProof: string): Promise<boolean>;
};

export function createPrismaSandboxPaymentStateStore(prisma: PrismaClient): SandboxPaymentStateStore {
  return {
    async read(providerPaymentId) {
      const row = await prisma.paymentAttempt.findUnique({
        where: { providerPaymentId },
        include: { paymentIntent: { select: { amountCent: true, currency: true } } },
      });
      if (!row) return null;
      return {
        providerPaymentId,
        status: row.providerObservedStatus as ProviderEvent['status'],
        amountCent: row.paymentIntent.amountCent,
        currency: row.paymentIntent.currency as 'CNY',
        updatedAt: row.providerObservedAt.toISOString(),
      };
    },
    async write(providerPaymentId, status, updatedAt, persistenceProof) {
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw<Array<{ set_config: string }>>`
          SELECT set_config('petscape.payment_provider_state_proof', ${persistenceProof}, true)
        `;
        const result = await tx.paymentAttempt.updateMany({
          where: { providerPaymentId, providerObservedAt: { lt: new Date(updatedAt) } },
          data: { providerObservedStatus: status, providerObservedAt: new Date(updatedAt) },
        });
        if (result.count === 1) return true;
        const exists = await tx.paymentAttempt.findUnique({ where: { providerPaymentId }, select: { id: true } });
        if (!exists) throw new Error('sandbox provider payment not found');
        return false;
      });
    },
  };
}

export type SandboxPaymentProvider = PaymentProviderPort & {
  simulate(providerPaymentId: string, status: ProviderEvent['status'], options?: { amountCent?: number; occurredAt?: Date }): Promise<{ rawBody: string; signature: string; event: ProviderEvent }>;
};

export function createSandboxPaymentProvider(options: {
  secret: string;
  environment: 'development' | 'test' | 'production';
  stateStore?: SandboxPaymentStateStore;
}): SandboxPaymentProvider {
  if (options.environment === 'production') {
    throw new PaymentProviderDisabledError('生产环境禁止启用 sandbox payment provider');
  }
  if (options.secret.length < 32) throw new PaymentProviderDisabledError('sandbox payment secret 长度不足');
  const verificationKeyHash = createHash('sha256').update(options.secret).digest('hex');
  const byMerchantId = new Map<string, ProviderPayment>();
  const byProviderId = new Map<string, ProviderPayment>();

  function sign(rawBody: string) {
    return createHmac('sha256', options.secret).update(rawBody).digest('hex');
  }

  function providerId(merchantPaymentId: string) {
    return `sandbox_${createHash('sha256').update(merchantPaymentId).digest('hex').slice(0, 32)}`;
  }

  return {
    name: 'sandbox',
    verificationKeyHash,
    async createPayment(input: CreateProviderPaymentInput) {
      const existing = byMerchantId.get(input.merchantPaymentId);
      if (existing) {
        if (existing.amountCent !== input.amountCent || existing.currency !== input.currency) {
          throw new Error('sandbox provider idempotency conflict');
        }
        return { payment: { ...existing }, persistenceProof: options.secret };
      }
      const restored = await options.stateStore?.read(providerId(input.merchantPaymentId));
      if (restored) {
        if (restored.amountCent !== input.amountCent || restored.currency !== input.currency) {
          throw new Error('sandbox provider idempotency conflict');
        }
        byMerchantId.set(input.merchantPaymentId, restored);
        byProviderId.set(restored.providerPaymentId, restored);
        return { payment: { ...restored }, persistenceProof: options.secret };
      }
      const payment: ProviderPayment = {
        providerPaymentId: providerId(input.merchantPaymentId),
        status: 'requires_action',
        amountCent: input.amountCent,
        currency: input.currency,
        updatedAt: new Date().toISOString(),
      };
      byMerchantId.set(input.merchantPaymentId, payment);
      byProviderId.set(payment.providerPaymentId, payment);
      return { payment: { ...payment }, persistenceProof: options.secret };
    },
    async verifyEvent(rawBody, signature) {
      if (!signature || !/^[0-9a-f]{64}$/.test(signature)) throw new PaymentProviderSignatureError('sandbox event signature 缺失或非法');
      const expected = sign(rawBody);
      if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) {
        throw new PaymentProviderSignatureError('sandbox event signature 验证失败');
      }
      let parsed: unknown;
      try { parsed = JSON.parse(rawBody); } catch { throw new PaymentProviderSignatureError('sandbox event JSON 非法'); }
      return { event: ProviderEventSchema.parse(parsed), persistenceProof: options.secret };
    },
    async queryPayment(providerPaymentId) {
      const payment = await options.stateStore?.read(providerPaymentId) ?? byProviderId.get(providerPaymentId);
      if (!payment) throw new Error('sandbox provider payment not found');
      return { payment: { ...payment }, persistenceProof: options.secret };
    },
    async simulate(providerPaymentId, status, simulateOptions = {}) {
      const payment = await options.stateStore?.read(providerPaymentId) ?? byProviderId.get(providerPaymentId);
      if (!payment) throw new Error('sandbox provider payment not found');
      const occurredAt = simulateOptions.occurredAt ?? new Date();
      const observedAt = occurredAt.toISOString();
      const applied = await options.stateStore?.write(providerPaymentId, status, observedAt, options.secret)
        ?? (occurredAt > new Date(payment.updatedAt));
      if (applied) {
        payment.status = status;
        payment.updatedAt = observedAt;
        byProviderId.set(providerPaymentId, payment);
      }
      const event = ProviderEventSchema.parse({
        provider: 'sandbox',
        providerEventId: `sandbox_evt_${randomUUID()}`,
        providerPaymentId,
        status,
        amountCent: simulateOptions.amountCent ?? payment.amountCent,
        currency: payment.currency,
        occurredAt: observedAt,
        failureCode: status === 'failed' ? 'sandbox_declined' : null,
        failureMessage: status === 'failed' ? '沙箱支付失败' : null,
      });
      const rawBody = JSON.stringify(event);
      return { rawBody, signature: sign(rawBody), event };
    },
  };
}
