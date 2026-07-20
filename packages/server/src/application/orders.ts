import {
  ConfirmedDeliveryAddressSnapshotSchema,
  type ConfirmedDeliveryAddressSnapshot,
} from '../contracts/delivery-addresses.ts';
import {
  OrderPurchaseSnapshotSchema,
  OrderRecoveryJobInputSchema,
  CancelOrderSchema,
  OrderResponseSchema,
  type OrderPurchaseSnapshot,
  type OrderResponse,
} from '../contracts/orders.ts';
import { NotFoundError } from '../domain/index.ts';
import type { PrismaClient, PrismaInputJsonValue } from '../infra/db/index.ts';
import type { PaymentProviderPort } from './payment-provider.ts';
import { isSerializableTransactionConflict } from './transaction-retry.ts';

export const ORDER_RECOVERY_JOB_TYPE = 'order_recovery';

export class OrderConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'OrderConflictError'; }
}

function errorCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;
}

type OrderRow = Awaited<ReturnType<PrismaClient['order']['findUniqueOrThrow']>> & {
  history: Array<{
    sequence: bigint; fromStatus: string | null; toStatus: string; reason: string; source: string;
    actorUserId: string | null; createdAt: Date;
  }>;
};

function toResponse(row: OrderRow): OrderResponse {
  return OrderResponseSchema.parse({
    id: row.id,
    paymentIntentId: row.paymentIntentId,
    quoteId: row.quoteId,
    requestId: row.requestId,
    status: row.status,
    sandboxOnly: row.sandboxOnly,
    amountCent: row.amountCent,
    currency: row.currency,
    productCode: row.productCode,
    materialName: row.materialName,
    materialVersion: row.materialVersion,
    pricingRuleVersion: row.pricingRuleVersion,
    purchaseSnapshot: row.purchaseSnapshot,
    deliveryAddressSnapshot: row.deliveryAddressSnapshot,
    paidAt: row.paidAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    history: row.history.map((item) => ({
      sequence: item.sequence.toString(),
      fromStatus: item.fromStatus,
      toStatus: item.toStatus,
      reason: item.reason,
      source: item.source,
      actorUserId: item.actorUserId,
      createdAt: item.createdAt.toISOString(),
    })),
    label: '沙箱订单（不会进入真实生产或物流）',
  });
}

async function readOrder(prisma: PrismaClient, id: string) {
  return prisma.order.findUniqueOrThrow({
    where: { id },
    include: { history: { orderBy: { sequence: 'asc' } } },
  }) as unknown as Promise<OrderRow>;
}

function buildPurchaseSnapshot(intent: {
  quote: {
    inputSnapshot: unknown; priceBreakdown: unknown; deliveryEstimate: unknown;
    request: {
      sceneConfirmationId: string; sceneConfirmation: unknown; contactName: string; contactPhone: string;
      usageDescription: string; additionalRequirements: string | null;
    };
    checkRun: {
      id: string; result: string | null; issues: unknown; evidence: unknown; adjustmentSuggestions: unknown;
      note: string | null; checklistVersion: string; ruleVersion: string;
    };
  };
}): OrderPurchaseSnapshot {
  return OrderPurchaseSnapshotSchema.parse({
    schemaVersion: 'order-purchase.v0',
    request: {
      sceneConfirmationId: intent.quote.request.sceneConfirmationId,
      sceneConfirmation: intent.quote.request.sceneConfirmation,
      contactName: intent.quote.request.contactName,
      contactPhone: intent.quote.request.contactPhone,
      usageDescription: intent.quote.request.usageDescription,
      additionalRequirements: intent.quote.request.additionalRequirements,
    },
    review: {
      checkRunId: intent.quote.checkRun.id,
      result: intent.quote.checkRun.result,
      issues: intent.quote.checkRun.issues,
      evidence: intent.quote.checkRun.evidence,
      adjustmentSuggestions: intent.quote.checkRun.adjustmentSuggestions,
      note: intent.quote.checkRun.note,
      checklistVersion: intent.quote.checkRun.checklistVersion,
      ruleVersion: intent.quote.checkRun.ruleVersion,
    },
    quoteInput: intent.quote.inputSnapshot,
    priceBreakdown: intent.quote.priceBreakdown,
    deliveryEstimate: intent.quote.deliveryEstimate,
  });
}

export async function ensureOrderForSucceededPayment({ prisma, paymentIntentId }: {
  prisma: PrismaClient; paymentIntentId: string;
}): Promise<{ order: OrderResponse | null; created: boolean }> {
  for (let retryNo = 0; retryNo < 5; retryNo += 1) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "payment_intent" WHERE "id"=${paymentIntentId} FOR UPDATE
        `;
        if (locked.length !== 1) throw new NotFoundError('PaymentIntent');
        const existing = await tx.order.findUnique({ where: { paymentIntentId } });
        if (existing) return { id: existing.id, created: false as const };
        const intent = await tx.paymentIntent.findUniqueOrThrow({
          where: { id: paymentIntentId },
          include: { quote: { include: { request: true, checkRun: true } } },
        });
        if (intent.status !== 'succeeded' || !intent.succeededAt) return { id: null, created: false as const };
        const addressSnapshot: ConfirmedDeliveryAddressSnapshot = ConfirmedDeliveryAddressSnapshotSchema.parse(intent.deliveryAddressSnapshot);
        const purchaseSnapshot = buildPurchaseSnapshot(intent);
        const created = await tx.order.create({ data: {
          ownerUserId: intent.ownerUserId,
          paymentIntentId: intent.id,
          quoteId: intent.quote.id,
          requestId: intent.quote.requestId,
          checkRunId: intent.quote.checkRunId,
          status: 'paid',
          sandboxOnly: true,
          amountCent: intent.amountCent,
          currency: intent.currency,
          productCode: intent.quote.productCode,
          materialName: intent.quote.materialName,
          materialVersion: intent.quote.materialVersion,
          pricingRuleVersion: intent.quote.pricingRuleVersion,
          purchaseSnapshot: purchaseSnapshot as PrismaInputJsonValue,
          deliveryAddressSnapshot: addressSnapshot as PrismaInputJsonValue,
          paidAt: intent.succeededAt,
        } });
        return { id: created.id, created: true as const };
      }, { isolationLevel: 'Serializable' });
      if (!result.id) return { order: null, created: false };
      return { order: toResponse(await readOrder(prisma, result.id)), created: result.created };
    } catch (error) {
      if (isSerializableTransactionConflict(error) && retryNo < 4) continue;
      if (errorCode(error, 'P2002')) {
        const existing = await prisma.order.findUnique({ where: { paymentIntentId } });
        if (existing) return { order: toResponse(await readOrder(prisma, existing.id)), created: false };
      }
      throw error;
    }
  }
  throw new Error('订单并发恢复失败');
}

export async function listOrders({ prisma, ownerUserId }: { prisma: PrismaClient; ownerUserId: string }) {
  const rows = await prisma.order.findMany({
    where: { ownerUserId },
    include: { history: { orderBy: { sequence: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((row) => toResponse(row as unknown as OrderRow));
}

export async function getOrder({ prisma, ownerUserId, orderId }: {
  prisma: PrismaClient; ownerUserId: string; orderId: string;
}) {
  const row = await prisma.order.findFirst({
    where: { id: orderId, ownerUserId },
    include: { history: { orderBy: { sequence: 'asc' } } },
  });
  if (!row) throw new NotFoundError('Order');
  return toResponse(row as unknown as OrderRow);
}

export async function cancelOrder({ prisma, provider, ownerUserId, orderId, input: untrusted }: {
  prisma: PrismaClient; provider: PaymentProviderPort; ownerUserId: string; orderId: string; input: unknown;
}) {
  CancelOrderSchema.parse(untrusted);
  const candidate = await prisma.order.findFirst({
    where: { id: orderId, ownerUserId },
    include: { paymentIntent: { include: { attempts: { orderBy: { attemptNo: 'desc' }, take: 1 } } } },
  });
  if (!candidate) throw new NotFoundError('Order');
  if (candidate.paymentIntent.provider !== provider.name ||
      candidate.paymentIntent.verificationKeyHash !== provider.verificationKeyHash) {
    throw new OrderConflictError('订单支付 provider 与可信配置不匹配');
  }
  const attempt = candidate.paymentIntent.attempts[0];
  if (!attempt) throw new OrderConflictError('订单缺少支付尝试');
  const verified = await provider.queryPayment(attempt.providerPaymentId);
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "order" WHERE "id"=${orderId} AND "ownerUserId"=${ownerUserId} FOR UPDATE
    `;
    if (locked.length !== 1) throw new NotFoundError('Order');
    const current = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (current.status !== 'paid') throw new OrderConflictError('只有 paid 沙箱订单可以取消');
    await tx.$queryRaw<Array<{ set_config: string }>>`
      SELECT set_config('petscape.order_cancel_proof', ${verified.persistenceProof}, true)
    `;
    await tx.$queryRaw<Array<{ set_config: string }>>`
      SELECT set_config('petscape.order_cancel_actor', ${ownerUserId}, true)
    `;
    await tx.order.update({ where: { id: orderId }, data: { status: 'canceled' } });
    return toResponse(await readOrder(tx as PrismaClient, orderId));
  }, { isolationLevel: 'Serializable' });
}

export async function processOrderRecoveryJob({ prisma, ownerUserId, input: untrusted }: {
  prisma: PrismaClient; ownerUserId: string; input: unknown;
}) {
  const input = OrderRecoveryJobInputSchema.parse(untrusted);
  const intent = await prisma.paymentIntent.findFirst({
    where: { id: input.paymentIntentId, ownerUserId }, select: { id: true },
  });
  if (!intent) throw new NotFoundError('PaymentIntent');
  const recovered = await ensureOrderForSucceededPayment({ prisma, paymentIntentId: intent.id });
  if (!recovered.order) throw new OrderConflictError('支付尚未 succeeded，不能补单');
  return { schemaVersion: 'order-recovery-result.v0', orderId: recovered.order.id } as const;
}
