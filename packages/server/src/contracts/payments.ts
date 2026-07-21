import { z } from 'zod';

export const PAYMENT_PROVIDER = 'sandbox' as const;
export const PAYMENT_MODE = 'sandbox_test' as const;

const idSchema = z.string().trim().min(1).max(191);
const moneySchema = z.number().int().positive().max(2_147_483_647);

export const PaymentIntentStatusSchema = z.enum([
  'requires_action', 'processing', 'succeeded', 'failed', 'canceled', 'needs_attention',
]);
export const PaymentAttentionCodeSchema = z.enum([
  'amount_mismatch', 'stale_succeeded_attempt', 'provider_state_conflict', 'unspecified',
]);
export const PaymentRecoveryActionSchema = z.enum([
  'complete_payment', 'wait', 'retry_payment', 'view_order', 'contact_support',
]);
export const OrderRecoveryStatusSchema = z.enum([
  'not_succeeded', 'recovering', 'order_created', 'failed', 'needs_attention',
]);
export const PaymentAttemptStatusSchema = z.enum([
  'requires_action', 'processing', 'succeeded', 'failed', 'canceled',
]);
export const ProviderPaymentStatusSchema = PaymentAttemptStatusSchema;

export const CreatePaymentIntentSchema = z.strictObject({
  quoteId: idSchema,
  idempotencyKey: z.string().trim().min(8).max(191),
});

export const RetryPaymentIntentSchema = z.strictObject({
  expectedStatus: z.enum(['failed', 'canceled']),
});

export const PaymentIntentIdParamSchema = z.strictObject({ id: idSchema });

export const PaymentAttemptResponseSchema = z.strictObject({
  id: idSchema,
  attemptNo: z.number().int().positive(),
  provider: idSchema,
  providerPaymentId: idSchema,
  status: PaymentAttemptStatusSchema,
  actionUrl: z.string().startsWith('/sandbox-pay/'),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
});

export const PaymentIntentResponseSchema = z.strictObject({
  id: idSchema,
  quoteId: idSchema,
  deliveryAddressId: idSchema,
  deliveryAddressVersion: z.number().int().positive(),
  amountCent: moneySchema,
  currency: z.literal('CNY'),
  mode: z.literal(PAYMENT_MODE),
  provider: idSchema,
  sandboxOnly: z.literal(true),
  status: PaymentIntentStatusSchema,
  attentionCode: PaymentAttentionCodeSchema.nullable(),
  recoveryAction: PaymentRecoveryActionSchema,
  orderRecoveryStatus: OrderRecoveryStatusSchema,
  label: z.literal('沙箱支付（不会发生真实扣款或成交）'),
  attempts: z.array(PaymentAttemptResponseSchema),
  succeededAt: z.iso.datetime().nullable(),
  failedAt: z.iso.datetime().nullable(),
  canceledAt: z.iso.datetime().nullable(),
  needsAttentionAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const PaymentIntentListResponseSchema = z.strictObject({
  paymentIntents: z.array(PaymentIntentResponseSchema),
});

export const AdminPaymentAttentionItemSchema = z.strictObject({
  ownerUserId: idSchema,
  paymentIntent: PaymentIntentResponseSchema,
  recoveryJob: z.strictObject({
    id: idSchema,
    status: z.enum(['pending', 'running', 'succeeded', 'failed', 'canceled', 'needs_attention']),
    attemptCount: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive(),
    errorClass: z.enum(['retryable', 'permanent', 'canceled', 'manual']).nullable(),
    errorCode: idSchema.nullable(),
    errorSummary: z.string().trim().min(1).max(120).nullable(),
    updatedAt: z.iso.datetime(),
  }).nullable(),
});
export const AdminPaymentAttentionListResponseSchema = z.strictObject({
  items: z.array(AdminPaymentAttentionItemSchema),
});

export const SandboxPaymentActionSchema = z.strictObject({
  result: z.enum(['processing', 'succeeded', 'failed', 'canceled']),
});

export const ProviderEventSchema = z.strictObject({
  provider: idSchema,
  providerEventId: idSchema,
  providerPaymentId: idSchema,
  status: ProviderPaymentStatusSchema,
  amountCent: moneySchema,
  currency: z.literal('CNY'),
  occurredAt: z.iso.datetime(),
  failureCode: z.string().trim().min(1).max(80).nullable(),
  failureMessage: z.string().trim().min(1).max(300).nullable(),
});

export const PaymentApiErrorSchema = z.strictObject({
  error: z.enum(['unauthorized', 'forbidden', 'invalid_json', 'invalid_request', 'not_found', 'conflict', 'provider_disabled', 'invalid_signature']),
  detail: z.string().optional(),
  issues: z.array(z.strictObject({
    path: z.array(z.union([z.string(), z.number()])),
    message: z.string(),
  })).optional(),
});

export type CreatePaymentIntent = z.infer<typeof CreatePaymentIntentSchema>;
export type RetryPaymentIntent = z.infer<typeof RetryPaymentIntentSchema>;
export type PaymentIntentResponse = z.infer<typeof PaymentIntentResponseSchema>;
export type PaymentAttemptResponse = z.infer<typeof PaymentAttemptResponseSchema>;
export type AdminPaymentAttentionItem = z.infer<typeof AdminPaymentAttentionItemSchema>;
export type ProviderEvent = z.infer<typeof ProviderEventSchema>;
