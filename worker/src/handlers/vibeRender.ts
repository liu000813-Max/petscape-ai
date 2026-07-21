// worker/src/handlers/vibeRender.ts —— vibe_render job handler（WP-G3）。
// spec: docs/plans/g-line-execution-plan.md WP-G3；docs/decisions/0006-3d-generation-pipeline.md。
//
// 输入：{ projectId, vibeText, environmentAssetId?, petAssetId? }（assetId→OSS，
//   G2→G3 断链修复：照片从 Asset 读，真实入图）。
// 产物：generated_render Asset（owned，uploads/generated/{owner}/{jobId}/render.png）。
//
// 幂等（ADR-0006 升格为 ADR 级约束——云雾断连仍扣费）：
//   1. 断连重试：provider 内部用同一 idempotencyKey 去重（见 infra/vendors/yunwu）。
//   2. 任务级恢复：worker 中断后同一 job 重跑，先查是否已存在本 job 的
//      generated_render Asset；存在则直接复用，不再调用 provider（不重复扣费）。
//   handler 抛 RetryableError → main.ts 归 retryable（可重试）；其余错误 → permanent。
import {
  buildVibeRenderPrompt,
  VibeRenderJobInputSchema,
  YunwuPermanentError,
  type VibeRenderJobInput,
  type VibeRenderReferenceImage,
} from '@petscape/server/worker-api';
import type { JobHandler } from './types.ts';
import { RetryableError } from './types.ts';

const GENERATED_RENDER_KIND = 'generated_render';
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024; // 与上传上限一致（contracts/assets）。

/** completeJob 的 resultRef 形状（与 contracts/renders VibeRenderResultRefSchema 一致）。 */
interface VibeRenderResultRef {
  assetId: string;
  ossKey: string;
  engine: string;
}

/** 读取一张 owner 校验过的参考图字节 + mime。资产不可验证 → 永久错误（越权/未确认）。 */
async function loadReference(
  assetId: string,
  ownerUserId: string,
  projectId: string,
  ctx: Parameters<JobHandler>[1],
): Promise<VibeRenderReferenceImage> {
  const asset = await ctx.server.prisma.asset.findUnique({ where: { id: assetId } });
  if (
    !asset ||
    asset.ownerUserId !== ownerUserId ||
    asset.projectId !== projectId ||
    asset.status !== 'available'
  ) {
    throw new Error(`参考图 Asset 不可验证（归属/项目/状态）: ${assetId}`);
  }
  let head: Awaited<ReturnType<typeof ctx.server.oss.head>>;
  try {
    head = await ctx.server.oss.head(asset.ossKey);
  } catch (error) {
    throw new RetryableError(`读取参考图 OSS 元数据失败: ${String(error)}`);
  }
  if (!head.exists || head.size === undefined || !head.etag) {
    throw new RetryableError('参考图 OSS 对象暂时不可用或缺少大小/ETag');
  }
  if (head.size <= 0 || head.size > MAX_REFERENCE_BYTES) {
    throw new Error(`参考图大小非法（${head.size} 字节）: ${assetId}`);
  }
  let bytes: Buffer;
  try {
    bytes = await ctx.server.oss.getVerifiedBuffer({
      key: asset.ossKey,
      etag: head.etag,
      expectedBytes: head.size,
      maxBytes: MAX_REFERENCE_BYTES,
    });
  } catch (error) {
    throw new RetryableError(`下载参考图字节失败: ${String(error)}`);
  }
  return { bytes, mime: asset.mime };
}

export const vibeRenderHandler: JobHandler = async (job, ctx) => {
  const input: VibeRenderJobInput = VibeRenderJobInputSchema.parse(job.input);
  const { prisma, oss, vibeRenderProvider } = ctx.server;

  const ossKey = `uploads/generated/${job.ownerUserId}/${job.id}/render.png`;

  // ── 任务级幂等恢复：本 job 已产出过 generated_render Asset 则直接复用 ──────────
  // worker 在「provider 已扣费出图 + Asset 已落地」之后、completeJob 之前中断，
  // 重跑时不得再次调用 provider（重复扣费）。以 ossKey 唯一定位本 job 的产物。
  const existing = await prisma.asset.findUnique({ where: { ossKey } });
  if (existing && existing.status === 'available') {
    const resultRef: VibeRenderResultRef = {
      assetId: existing.id,
      ossKey,
      engine: (job.input as { _engine?: string })._engine ?? 'unknown',
    };
    return resultRef;
  }

  // ── 组装参考图（环境照 → i2i 改造；宠物照 → 外观一致）────────────────────────
  const references: VibeRenderReferenceImage[] = [];
  if (input.environmentAssetId) {
    references.push(
      await loadReference(input.environmentAssetId, job.ownerUserId, input.projectId, ctx),
    );
  }
  if (input.petAssetId) {
    references.push(await loadReference(input.petAssetId, job.ownerUserId, input.projectId, ctx));
  }

  ctx.reportProgress({ stage: 'generating', hasReferences: references.length });

  const prompt = buildVibeRenderPrompt({
    vibeText: input.vibeText,
    hasPetPhoto: Boolean(input.petAssetId),
    hasEnvironmentImage: Boolean(input.environmentAssetId),
  });

  // ── 调用 provider（幂等键 = job.id：断连重试用同一 key，不重复计费）───────────
  let result: Awaited<ReturnType<typeof vibeRenderProvider.generate>>;
  try {
    result = await vibeRenderProvider.generate({
      prompt,
      references,
      idempotencyKey: job.id,
    });
  } catch (error) {
    // 云雾业务永久错误（4xx/无图）→ permanent；网络层重试耗尽的错误也上抛，
    // 由 main.ts 归 permanent（provider 已在内部做网络层重试；到这里说明重试
    // 耗尽或是永久错误，不再由 handler 二次重试烧钱）。
    if (error instanceof YunwuPermanentError) throw error;
    throw error;
  }

  if (!result.imageBytes || result.imageBytes.length === 0) {
    throw new Error('生图完成但产物字节为空');
  }

  // ── 产物落 OSS + 登记 generated_render Asset（owned）─────────────────────────
  await oss.put(ossKey, result.imageBytes);

  const asset = await prisma.asset.create({
    data: {
      ownerUserId: job.ownerUserId,
      projectId: input.projectId,
      kind: GENERATED_RENDER_KIND,
      mime: result.mime,
      size: result.imageBytes.length,
      ossKey,
      status: 'available',
    },
  });

  const resultRef: VibeRenderResultRef = {
    assetId: asset.id,
    ossKey,
    engine: result.engine,
  };
  return resultRef;
};
