// WP-B7-1 — mesh_analysis 与沙箱 Estimate 的进程边界契约。
import { z } from 'zod';
import { SceneConfirmationCommerceInputSchema } from './scene-confirmation-commerce.ts';

export const MESH_ANALYSIS_JOB_SCHEMA_VERSION = 'mesh-analysis-job.v0' as const;
export const MESH_ANALYSIS_RESULT_SCHEMA_VERSION = 'mesh-analysis-result.v0' as const;
export const MESH_ANALYSIS_ALGORITHM_VERSION = 'trimesh-volume.v0' as const;

const idSchema = z.string().trim().min(1).max(191);
const millimetersSchema = z.number().finite().positive().max(10_000);

export const CreateSandboxEstimateRequestSchema = z.strictObject({
  sceneConfirmationId: idSchema,
});

export const MeshAnalysisJobInputSchema = z.strictObject({
  schemaVersion: z.literal(MESH_ANALYSIS_JOB_SCHEMA_VERSION),
  algorithmVersion: z.literal(MESH_ANALYSIS_ALGORITHM_VERSION),
  geometryUnit: z.literal('millimeter'),
  sceneConfirmation: SceneConfirmationCommerceInputSchema,
  _requestId: z.uuid().optional(),
});

export const MeshAnalysisResultSchema = z.strictObject({
  schemaVersion: z.literal(MESH_ANALYSIS_RESULT_SCHEMA_VERSION),
  algorithmVersion: z.literal(MESH_ANALYSIS_ALGORITHM_VERSION),
  geometryUnit: z.literal('millimeter'),
  assetChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  dimensionsMm: z.strictObject({
    x: millimetersSchema,
    y: millimetersSchema,
    z: millimetersSchema,
  }),
  volumeMm3: z.number().finite().positive().max(1_000_000_000_000),
  triangleCount: z.number().int().positive().max(20_000_000),
  // 非闭合网格由分析器 fail-closed，成功结果不允许携带 false。
  watertight: z.literal(true),
});

export const CreateSandboxEstimateResponseSchema = z.strictObject({
  estimateJobId: idSchema,
  status: z.enum(['queued', 'existing']),
  created: z.boolean(),
});

const queuedEstimate = z.strictObject({
  estimateJobId: idSchema,
  status: z.literal('queued'),
});
const failedEstimate = z.strictObject({
  estimateJobId: idSchema,
  status: z.literal('failed'),
  errorCode: z.string().min(1),
  detail: z.string().min(1),
});
const readyEstimate = z.strictObject({
  estimateJobId: idSchema,
  status: z.literal('ready'),
  label: z.literal('沙箱预估（不可支付）'),
  formalQuoteAllowed: z.literal(false),
  productCode: z.literal('cheese-lounge-bed'),
  materialName: z.literal('PETG 奶酪黄（沙箱）'),
  materialVersion: z.literal('petg-cheese-yellow-sandbox-v0'),
  pricingRuleVersion: z.literal('v0-sandbox'),
  analysis: MeshAnalysisResultSchema,
  weightGrams: z.string().min(1),
  materialCostCent: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  baseFeeCent: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  multiplier: z.string().min(1),
  floorPriceCent: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  amountCent: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.literal('CNY'),
  taxMode: z.literal('tax_inclusive'),
  roundingMode: z.literal('ceil_whole_yuan'),
});

export const SandboxEstimateResponseSchema = z.discriminatedUnion('status', [
  queuedEstimate,
  failedEstimate,
  readyEstimate,
]);

export const CommerceEstimateApiErrorSchema = z.strictObject({
  error: z.enum(['unauthorized', 'invalid_json', 'invalid_request', 'not_found']),
  detail: z.string().optional(),
});

export type CreateSandboxEstimateRequest = z.infer<typeof CreateSandboxEstimateRequestSchema>;
export type MeshAnalysisJobInput = z.infer<typeof MeshAnalysisJobInputSchema>;
export type MeshAnalysisResult = z.infer<typeof MeshAnalysisResultSchema>;
export type SandboxEstimateResponse = z.infer<typeof SandboxEstimateResponseSchema>;
