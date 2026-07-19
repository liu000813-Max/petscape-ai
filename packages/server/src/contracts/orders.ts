// WP-C4-1 — 订单读取边界。客户端不能提交金额、状态或快照。
import { z } from 'zod';
import { ConfirmedDeliveryAddressSnapshotSchema } from './delivery-addresses.ts';
import { CheckRunEvidenceSchema } from './check-runs.ts';
import { QuoteDeliveryEstimateSchema, QuoteInputSnapshotSchema, QuotePriceBreakdownSchema } from './quotes.ts';
import { SceneConfirmationCommerceInputSchema } from './scene-confirmation-commerce.ts';

const idSchema = z.string().trim().min(1).max(191);

export const OrderStatusSchema = z.enum(['paid', 'canceled']);
export const OrderIdParamSchema = z.strictObject({ id: idSchema });
export const CancelOrderSchema = z.strictObject({ expectedStatus: z.literal('paid') });
export const OrderRecoveryJobInputSchema = z.strictObject({
  schemaVersion: z.literal('order-recovery.v0'),
  paymentIntentId: idSchema,
});

export const OrderPurchaseSnapshotSchema = z.strictObject({
  schemaVersion: z.literal('order-purchase.v0'),
  request: z.strictObject({
    sceneConfirmationId: idSchema,
    sceneConfirmation: SceneConfirmationCommerceInputSchema,
    contactName: z.string().trim().min(1).max(80),
    contactPhone: z.string().trim().min(1).max(32),
    usageDescription: z.string().trim().min(1).max(2000),
    additionalRequirements: z.string().max(2000).nullable(),
  }),
  review: z.strictObject({
    checkRunId: idSchema,
    result: z.literal('approved'),
    issues: z.array(z.string().trim().min(1).max(1000)).max(100),
    evidence: z.array(CheckRunEvidenceSchema).min(1).max(100),
    adjustmentSuggestions: z.array(z.string().trim().min(1).max(1000)).max(100),
    note: z.string().trim().min(1).max(4000).nullable(),
    checklistVersion: z.literal('fdm-manual-sandbox-v0'),
    ruleVersion: z.literal('b6-manual-review-v0-sandbox'),
  }),
  quoteInput: QuoteInputSnapshotSchema,
  priceBreakdown: QuotePriceBreakdownSchema,
  deliveryEstimate: QuoteDeliveryEstimateSchema,
});

export const OrderStatusHistoryResponseSchema = z.strictObject({
  sequence: z.string().regex(/^\d+$/),
  fromStatus: OrderStatusSchema.nullable(),
  toStatus: OrderStatusSchema,
  reason: z.string().trim().min(1).max(191),
  source: z.enum(['system', 'owner']),
  actorUserId: idSchema.nullable(),
  createdAt: z.iso.datetime(),
});

export const OrderResponseSchema = z.strictObject({
  id: idSchema,
  paymentIntentId: idSchema,
  quoteId: idSchema,
  requestId: idSchema,
  status: OrderStatusSchema,
  sandboxOnly: z.literal(true),
  amountCent: z.number().int().positive().max(2_147_483_647),
  currency: z.literal('CNY'),
  productCode: z.string().trim().min(1).max(191),
  materialName: z.string().trim().min(1).max(191),
  materialVersion: z.string().trim().min(1).max(191),
  pricingRuleVersion: z.string().trim().min(1).max(191),
  purchaseSnapshot: OrderPurchaseSnapshotSchema,
  deliveryAddressSnapshot: ConfirmedDeliveryAddressSnapshotSchema.extend({ sandboxOnly: z.literal(true) }),
  paidAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  history: z.array(OrderStatusHistoryResponseSchema),
  label: z.literal('沙箱订单（不会进入真实生产或物流）'),
});

export const OrderListResponseSchema = z.strictObject({ orders: z.array(OrderResponseSchema) });
export const OrderApiErrorSchema = z.strictObject({
  error: z.enum(['unauthorized', 'invalid_json', 'invalid_request', 'not_found', 'conflict']),
  detail: z.string().optional(),
});

export type OrderResponse = z.infer<typeof OrderResponseSchema>;
export type OrderPurchaseSnapshot = z.infer<typeof OrderPurchaseSnapshotSchema>;
export type CancelOrder = z.infer<typeof CancelOrderSchema>;
