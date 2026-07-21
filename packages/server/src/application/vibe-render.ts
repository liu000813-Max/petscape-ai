// application/vibe-render.ts —— vibe 效果图生成用例（WP-G3）。
// spec: docs/plans/g-line-execution-plan.md WP-G3；docs/decisions/0006-3d-generation-pipeline.md。
//
// 两块内容：
//   1. createVibeRenderJob：薄用例——校验项目归属 + 引用的输入 Asset 归属，建
//      vibe_render 持久任务（同 createSampleJob 的模式，业务幂等键由调用方传入）。
//   2. VibeRenderProvider 端口 + prompt 组装：worker handler 依赖端口而非具体引擎
//      （与支付 PaymentProviderPort 同一模式，ADR-0006"provider 端口使首版选型与
//      业务实现解耦"）。真实实现（云雾）在 infra/vendors/yunwu.ts；fixture 实现
//      在 infra/vendors/fixture.ts，CI/回归零外部调用。
//
// 本层不 import @prisma/client（lint 边界）；PrismaClient 类型经 infra/db 转发。
import type { PrismaClient } from '../infra/db/index.ts';
import { createJob } from '../infra/jobs/index.ts';
import { assertOwner, NotFoundError } from '../domain/index.ts';
import {
  VIBE_RENDER_JOB_TYPE,
  type VibeRenderJobInput,
} from '../contracts/renders.ts';

export { NotFoundError };
export { VIBE_RENDER_JOB_TYPE };

export interface CreateVibeRenderJobInput {
  prisma: PrismaClient;
  ownerUserId: string;
  input: VibeRenderJobInput;
  /** 业务幂等键：同一 key 重复请求只成立一个任务，不重复扣费（ADR-0006 约束）。 */
  idempotencyKey: string;
}

export interface CreateVibeRenderJobResult {
  jobId: string;
  status: string;
  /** false = 幂等键命中已有任务，未创建新行。 */
  created: boolean;
}

/**
 * 建一个 vibe_render 任务，归属当前登录用户。
 * - 目标项目必须属于当前用户（否则 NotFoundError → 路由 404）。
 * - 引用的环境照/宠物照 Asset（若提供）必须属于当前用户且是 available 态
 *   （否则 NotFoundError）——把归属校验提前到任务创建，避免任务建成后 worker
 *   执行阶段才发现引用了他人/不存在的资产（同 createSampleJob 的先例）。
 */
export async function createVibeRenderJob({
  prisma,
  ownerUserId,
  input,
  idempotencyKey,
}: CreateVibeRenderJobInput): Promise<CreateVibeRenderJobResult> {
  const project = await prisma.project.findUnique({ where: { id: input.projectId } });
  assertOwner(project, ownerUserId, 'Project');

  for (const assetId of [input.environmentAssetId, input.petAssetId]) {
    if (!assetId) continue;
    const asset = await prisma.asset.findUnique({ where: { id: assetId } });
    // 归属 + 可用 + 属于同一项目：越权/未确认/跨项目引用都拒绝。
    if (
      !asset ||
      asset.ownerUserId !== ownerUserId ||
      asset.status !== 'available' ||
      asset.projectId !== input.projectId
    ) {
      throw new NotFoundError('Asset');
    }
  }

  const { job, created } = await createJob(prisma, {
    type: VIBE_RENDER_JOB_TYPE,
    ownerUserId,
    input,
    idempotencyKey,
  });
  return { jobId: job.id, status: job.status, created };
}

export interface LatestVibeRenderInput {
  prisma: PrismaClient;
  ownerUserId: string;
  projectId: string;
}

export interface LatestVibeRenderResult {
  /** 无任何 vibe_render 任务时 null（前端据此退回纯初始态）。 */
  status: string | null;
  /** 该任务引用的环境照 assetId（用户上传的笼箱照）——供「改造前」卡换签名 URL。 */
  environmentAssetId: string | null;
  /** 成功任务的产物 generated_render assetId——供「改造后」卡换签名 URL。 */
  renderAssetId: string | null;
}

/**
 * 查项目下最新一个 vibe_render 任务的展示态（RenderSection 消费）。
 * 项目必须属于当前用户（否则 NotFoundError → 路由 404）。取最新一行
 * （createdAt desc）：前端「改造前=用户环境照、改造后=产物图」的叙事以最近一次
 * 生成为准。environmentAssetId 从 job.input 读，renderAssetId 从 resultRef 读。
 */
export async function getLatestVibeRender({
  prisma,
  ownerUserId,
  projectId,
}: LatestVibeRenderInput): Promise<LatestVibeRenderResult> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  assertOwner(project, ownerUserId, 'Project');

  const job = await prisma.job.findFirst({
    where: { ownerUserId, type: VIBE_RENDER_JOB_TYPE, input: { path: ['projectId'], equals: projectId } },
    orderBy: { createdAt: 'desc' },
  });
  if (!job) return { status: null, environmentAssetId: null, renderAssetId: null };

  const input = (job.input ?? {}) as { environmentAssetId?: unknown };
  const resultRef = (job.resultRef ?? {}) as { assetId?: unknown };
  return {
    status: job.status,
    environmentAssetId: typeof input.environmentAssetId === 'string' ? input.environmentAssetId : null,
    renderAssetId: typeof resultRef.assetId === 'string' ? resultRef.assetId : null,
  };
}

// ── Provider 端口（ADR-0006）───────────────────────────────────────────────────

/** 一张参考图（环境照/宠物照）解析后的字节 + mime，供 provider 组 data-URI。 */
export interface VibeRenderReferenceImage {
  bytes: Buffer;
  mime: string;
}

export interface VibeRenderProviderInput {
  /** 已组装好的完整生图 prompt（见 buildVibeRenderPrompt）。 */
  prompt: string;
  /** 参考图（0..2 张）：有环境照 → i2i 改造；有宠物照 → 外观一致约束。 */
  references: VibeRenderReferenceImage[];
  /**
   * 幂等键：断连仍扣费（ADR-0006）——provider 内部重试必须用同一 key，
   * 让「已扣费的那次」结果可被复用/去重，重试不重复触发计费调用。
   */
  idempotencyKey: string;
  /** 中止信号（worker 心跳丢失/关停时取消在途请求）。 */
  signal?: AbortSignal;
}

export interface VibeRenderProviderResult {
  /** 生成的效果图字节（provider 已从 data-URI 抽取解码）。 */
  imageBytes: Buffer;
  /** 图片 mime（如 image/png）。 */
  mime: string;
  /** 引擎标识（模型名），写入 resultRef.engine 供审计。 */
  engine: string;
}

/**
 * 图像生成 provider 端口。真实实现（云雾）与 fixture 实现都满足本接口；
 * worker handler 只依赖此端口，换引擎不改 handler（ADR-0006）。
 *
 * 幂等契约（ADR-0006 升格为 ADR 级约束）：实现必须保证——对同一 idempotencyKey，
 * 网络断连后的内部重试不产生第二次计费调用（provider 侧去重或结果缓存）。
 */
export interface VibeRenderProvider {
  generate(input: VibeRenderProviderInput): Promise<VibeRenderProviderResult>;
}

// ── prompt 组装 ────────────────────────────────────────────────────────────────
// 从原型 web/app/lib/images/scenePrompt.ts 的 buildVibePrompt 收编而来（vibe 段）：
// 有环境照做保结构改造，无环境照从描述生成完整造景图。宠物出现要求按是否有宠物照
// 分支。风格后缀含「不要文字/水印」硬约束（ADR-0006 终审约束 2 的同源要求）。

const COMMON_STYLE_SUFFIX =
  '温暖柔和的自然光，森林绿与原木色调，自然手机拍摄视角，真实宠物用品摄影质感，干净背景。不要出现文字、水印、字母、标签、人手、尺子。';

export interface BuildVibeRenderPromptInput {
  vibeText: string;
  species?: string;
  hasPetPhoto: boolean;
  hasEnvironmentImage: boolean;
}

function petPresenceLine(species: string | undefined, hasPetPhoto: boolean): string {
  if (hasPetPhoto) {
    return '画面中必须出现这只宠物本体，外观（毛色/花纹/体态）需与提供的宠物参考照保持一致，宠物在造景中自然活动。';
  }
  return `画面中必须出现一只真实的${species || '小宠'}，在造景中自然活动，姿态生动、比例真实。`;
}

/** 组装 vibe 效果图 prompt（与 handler 解耦，便于单测；收编自原型 scenePrompt）。 */
export function buildVibeRenderPrompt({
  vibeText,
  species,
  hasPetPhoto,
  hasEnvironmentImage,
}: BuildVibeRenderPromptInput): string {
  const presence = petPresenceLine(species, hasPetPhoto);
  const trimmedVibe = vibeText.trim();
  if (!hasEnvironmentImage) {
    return (
      `请根据以下氛围描述，为宠物从零设计一个完整的小家造景效果图：${trimmedVibe}。` +
      `${presence} ` +
      `真实宠物用品摄影、手机实拍感、真实玻璃箱/木质/垫材材质。` +
      `空间需要有清晰层次，包含可钻洞口、觅食层板、休息角落和适合宠物活动的动线，比例真实，像可落地制作的宠物小家。` +
      `主体（造景+宠物）必须居中构图，四周保留充足留白，不要贴边裁切，便于后续做 3:4 中心裁切。` +
      `${COMMON_STYLE_SUFFIX}`
    );
  }

  return (
    `这是用户宠物现有笼箱的实拍照片，请在**不改变原笼箱结构、尺寸、材质、位置**的前提下，` +
    `按照以下氛围描述为其改造装饰、光影与整体氛围：${trimmedVibe}。` +
    `${presence} ` +
    `主体（笼箱+宠物）必须居中构图，四周保留充足留白，不要贴边裁切，便于后续做 3:4 中心裁切。` +
    `造景改造需与原笼箱结构协调、比例合身，看起来像是在原笼箱基础上完成的氛围改造。` +
    `${COMMON_STYLE_SUFFIX}`
  );
}
