// WP-C2-1 — Quote 进程边界。客户端只能提交可信输入引用，永不提交金额或快照。
import { z } from 'zod';
import { CheckRunRequestSnapshotSchema } from './check-runs.ts';
import { MeshAnalysisJobInputSchema, MeshAnalysisResultSchema } from './commerce-estimates.ts';
import { SceneConfirmationCommerceInputSchema } from './scene-confirmation-commerce.ts';

const idSchema = z.string().trim().min(1).max(191);
const isoDateSchema = z.iso.datetime({ offset: true });

export const QuoteModeSchema = z.enum(['sandbox_test', 'formal_candidate']);
export const QuoteStatusSchema = z.enum(['active', 'accepted', 'expired', 'superseded', 'canceled']);

export const CreateQuoteSchema = z.strictObject({
  requestId: idSchema,
  estimateJobId: idSchema,
  idempotencyKey: z.string().trim().min(8).max(191),
  quoteMode: QuoteModeSchema,
});

export const QuoteTransitionSchema = z.strictObject({ expectedStatus: z.literal('active') });
export const QuoteIdParamSchema = z.strictObject({ id: idSchema });

export const QuoteDeliveryEstimateSchema = z.strictObject({
  status: z.literal('unverified_sandbox'),
  label: z.literal('沙箱交期未验证，不构成履约承诺'),
});

export const QuoteInputSnapshotSchema = z.strictObject({
  schemaVersion: z.literal('quote-input.v0'),
  request: z.strictObject({
    id: idSchema,
    sceneConfirmation: SceneConfirmationCommerceInputSchema,
    productCode: z.literal('cheese-lounge-bed'),
    materialName: z.literal('PETG 奶酪黄（沙箱）'),
    materialVersion: z.literal('petg-cheese-yellow-sandbox-v0'),
    submittedAt: isoDateSchema,
  }),
  review: z.strictObject({
    id: idSchema,
    result: z.literal('approved'),
    requestSnapshot: CheckRunRequestSnapshotSchema,
    checklistVersion: z.literal('fdm-manual-sandbox-v0'),
    ruleVersion: z.literal('b6-manual-review-v0-sandbox'),
    completedAt: isoDateSchema,
  }),
  b7: z.strictObject({
    estimateJobId: idSchema,
    jobInput: MeshAnalysisJobInputSchema,
    analysis: MeshAnalysisResultSchema,
  }),
});

const decimalStringSchema = z.string().regex(/^\d+(?:\.\d+)?$/);
export const QuotePriceBreakdownSchema = z.strictObject({
  schemaVersion: z.literal('quote-price.v0'),
  materialCostCent: z.number().int().nonnegative().max(2_147_483_647),
  weightGrams: decimalStringSchema,
  baseFeeCent: z.number().int().nonnegative().max(2_147_483_647),
  multiplier: decimalStringSchema,
  floorPriceCent: z.number().int().nonnegative().max(2_147_483_647),
  amountBeforeRoundingCent: decimalStringSchema,
  amountCent: z.number().int().positive().max(2_147_483_647),
  formulaVersion: z.literal('material-cent-ceil-plus-base-times-multiplier-v0'),
});

export const QuoteResponseSchema = z.strictObject({
  id: idSchema,
  requestId: idSchema,
  checkRunId: idSchema,
  estimateJobId: idSchema,
  quoteMode: QuoteModeSchema,
  label: z.enum(['沙箱测试报价（不可用于真实交易）', '正式报价候选']),
  sandboxOnly: z.boolean(),
  status: QuoteStatusSchema,
  productCode: z.string().min(1).max(191),
  materialName: z.string().min(1).max(191),
  materialVersion: z.string().min(1).max(191),
  pricingRuleVersion: z.string().min(1).max(191),
  amountCent: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().length(3),
  taxMode: z.string().min(1).max(64),
  roundingMode: z.string().min(1).max(64),
  deliveryEstimate: QuoteDeliveryEstimateSchema,
  validFrom: isoDateSchema,
  expiresAt: isoDateSchema,
  acceptedAt: isoDateSchema.nullable(),
  expiredAt: isoDateSchema.nullable(),
  supersededAt: isoDateSchema.nullable(),
  canceledAt: isoDateSchema.nullable(),
  supersedesQuoteId: idSchema.nullable(),
  createdAt: isoDateSchema,
});

export const QuoteListResponseSchema = z.strictObject({ quotes: z.array(QuoteResponseSchema) });
export const QuoteApiErrorSchema = z.strictObject({
  error: z.enum(['unauthorized', 'invalid_json', 'invalid_request', 'not_found', 'conflict']),
  detail: z.string().optional(),
  issues: z.array(z.strictObject({ path: z.array(z.union([z.string(), z.number()])), message: z.string() })).optional(),
});

export type CreateQuote = z.infer<typeof CreateQuoteSchema>;
export type QuoteTransition = z.infer<typeof QuoteTransitionSchema>;
export type QuoteResponse = z.infer<typeof QuoteResponseSchema>;
