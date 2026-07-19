// WP-B7-1 — mesh_analysis 应用层共享逻辑。
import { createHash } from 'node:crypto';
import {
  SceneConfirmationCommerceInputSchema,
  type SceneConfirmationCommerceInput,
} from '../contracts/scene-confirmation-commerce.ts';
import {
  MESH_ANALYSIS_ALGORITHM_VERSION,
  MESH_ANALYSIS_JOB_SCHEMA_VERSION,
  MeshAnalysisResultSchema,
  SandboxEstimateResponseSchema,
  type SandboxEstimateResponse,
} from '../contracts/commerce-estimates.ts';
import type { PrismaClient } from '../infra/db/index.ts';
import { createJob, reopenRetryableJob } from '../infra/jobs/index.ts';
import { getJob } from './jobs.ts';
import { calculateSandboxPrice } from '../domain/pricing.ts';
import { NotFoundError } from '../domain/index.ts';
import {
  B7_SANDBOX_SCENE_CONFIRMATION_ID,
  b7SandboxSceneConfirmationFixture,
} from './commerce-sandbox-fixtures.ts';

const MICROMETERS_PER_MILLIMETER = 1_000;
const MICRORADIANS_PER_RADIAN = 1_000_000;
const SCALE_PARTS_PER_MILLION = 1_000_000;

/**
 * 任务幂等键绑定不可变资产 checksum 与规范化后的最终变换。
 * 不直接拼接 JS 浮点字符串，避免 180 与 180.0000000001 产生重复任务。
 */
export function buildMeshAnalysisIdempotencyKey(
  untrusted: SceneConfirmationCommerceInput,
): string {
  const scene = SceneConfirmationCommerceInputSchema.parse(untrusted);
  const canonical = {
    algorithm: 'trimesh-volume.v0',
    checksum: scene.assetRef.sha256,
    dimensionsMicrometer: {
      x: Math.round(scene.dimensionsMm.x * MICROMETERS_PER_MILLIMETER),
      y: Math.round(scene.dimensionsMm.y * MICROMETERS_PER_MILLIMETER),
      z: Math.round(scene.dimensionsMm.z * MICROMETERS_PER_MILLIMETER),
    },
    rotationYMicrorad: Math.round(scene.rotationYRad * MICRORADIANS_PER_RADIAN),
    uniformScalePpm: Math.round(scene.uniformScale * SCALE_PARTS_PER_MILLION),
  };
  const digest = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  return `mesh-analysis:v0:${digest}`;
}

export const MESH_ANALYSIS_JOB_TYPE = 'mesh_analysis';

export function resolveSandboxSceneConfirmation(
  sceneConfirmationId: string,
): SceneConfirmationCommerceInput {
  if (sceneConfirmationId !== B7_SANDBOX_SCENE_CONFIRMATION_ID) {
    throw new NotFoundError('SceneConfirmation');
  }
  return SceneConfirmationCommerceInputSchema.parse(b7SandboxSceneConfirmationFixture);
}

export async function createSandboxEstimateJob({
  prisma,
  ownerUserId,
  sceneConfirmationId,
  requestId,
}: {
  prisma: PrismaClient;
  ownerUserId: string;
  sceneConfirmationId: string;
  requestId?: string;
}) {
  const sceneConfirmation = resolveSandboxSceneConfirmation(sceneConfirmationId);
  if (sceneConfirmation.eligibility !== 'sandbox_only') {
    throw new Error('WP-B7-1 只允许 sandbox_only SceneConfirmation');
  }
  const idempotencyKey = buildMeshAnalysisIdempotencyKey(sceneConfirmation);
  const { job, created } = await createJob(prisma, {
    type: MESH_ANALYSIS_JOB_TYPE,
    ownerUserId,
    idempotencyKey,
    input: {
      schemaVersion: MESH_ANALYSIS_JOB_SCHEMA_VERSION,
      algorithmVersion: MESH_ANALYSIS_ALGORITHM_VERSION,
      geometryUnit: 'millimeter',
      sceneConfirmation,
      ...(requestId ? { _requestId: requestId } : {}),
    },
  });
  if (!created && job.status === 'failed' && job.errorClass === 'retryable') {
    // exhausted retryable 任务允许用户安全重开同一 canonical job。条件更新保证并发
    // POST 只有一个赢得重开；targetVersion +1 阻止旧 worker 的迟到完成覆盖新代次。
    if (await reopenRetryableJob(prisma, job.id)) {
      return { estimateJobId: job.id, status: 'queued' as const, created: false };
    }
  }
  return {
    estimateJobId: job.id,
    status: created ? ('queued' as const) : ('existing' as const),
    created,
  };
}

export async function getSandboxEstimate({
  prisma,
  ownerUserId,
  estimateJobId,
}: {
  prisma: PrismaClient;
  ownerUserId: string;
  estimateJobId: string;
}): Promise<SandboxEstimateResponse> {
  const job = await getJob({ prisma, jobId: estimateJobId, currentUserId: ownerUserId });
  if (job.type !== MESH_ANALYSIS_JOB_TYPE) throw new NotFoundError('Estimate');

  if (job.status === 'pending' || job.status === 'running') {
    return SandboxEstimateResponseSchema.parse({ estimateJobId, status: 'queued' });
  }
  if (job.status !== 'succeeded') {
    const errorDetail = job.errorDetail as { code?: unknown; message?: unknown } | null;
    return SandboxEstimateResponseSchema.parse({
      estimateJobId,
      status: 'failed',
      errorCode:
        typeof errorDetail?.code === 'string'
          ? errorDetail.code
          : (job.errorClass ?? job.status),
      detail:
        typeof errorDetail?.message === 'string'
          ? errorDetail.message
          : '网格分析未成功，请检查资产或稍后重试',
    });
  }

  const analysis = MeshAnalysisResultSchema.parse(job.resultRef);
  const [material, rule] = await Promise.all([
    prisma.material.findUniqueOrThrow({
      where: { versionCode: 'petg-cheese-yellow-sandbox-v0' },
    }),
    prisma.pricingRule.findUniqueOrThrow({ where: { versionCode: 'v0-sandbox' } }),
  ]);
  if (rule.materialId !== material.id || material.isSellable || rule.isSellable) {
    throw new Error('沙箱材料/定价 seed 不满足不可售约束');
  }

  const price = calculateSandboxPrice({
    volumeMm3: analysis.volumeMm3.toString(),
    material,
    rule: { ...rule, multiplier: rule.multiplier.toString() },
  });
  return SandboxEstimateResponseSchema.parse({
    estimateJobId,
    status: 'ready',
    label: '沙箱预估（不可支付）',
    formalQuoteAllowed: false,
    productCode: 'cheese-lounge-bed',
    materialName: material.displayName,
    materialVersion: material.versionCode,
    pricingRuleVersion: rule.versionCode,
    analysis,
    weightGrams: price.weightGrams,
    materialCostCent: price.materialCostCent,
    baseFeeCent: rule.baseFeeCent,
    multiplier: rule.multiplier.toString(),
    floorPriceCent: rule.floorPriceCent,
    amountCent: price.amountCent,
    currency: price.currency,
    taxMode: price.taxMode,
    roundingMode: price.roundingMode,
  });
}
