// contracts/renders.ts —— WP-G3 vibe 效果图生成 HTTP + job 契约正本。
// spec: docs/plans/g-line-execution-plan.md WP-G3 + §一 G0a（vibe_render job type、
// generated_render kind、renders 端点）；docs/decisions/0006-3d-generation-pipeline.md。
//
// 客户端只提交「输入意图」——vibe 文字 + 引用已上传的 Asset（assetId）。产物字段
// （eff果图 assetId、ossKey、金额、kind 等）一律由服务端 worker 流水线裁定，
// 客户端不得注入（g-line §一 G0a"客户端不得注入产物字段"；沿用 C 线 contract 口径）。
// 环境照/宠物照经 assetId 引用（G2→G3 断链修复：vibe 输入从 Asset→OSS 读，
// 不再依赖内存 brief 里的本地路径）。
import { z } from 'zod';

/** vibe_render 持久任务类型标识（ADR-0003 机制；§一 G0a job type 表）。 */
export const VIBE_RENDER_JOB_TYPE = 'vibe_render';

/** generated_render Asset kind（§一 Asset.kind 扩展表；OSS 前缀 uploads/generated/）。 */
export const GENERATED_RENDER_KIND = 'generated_render';

// ── HTTP 请求契约：POST /api/v1/projects/:id/renders ──────────────────────────
// strictObject = 拒绝未知字段；客户端只能提供 vibe 文字与输入 Asset 引用，
// 任何产物字段（assetId 产物、ossKey、金额、kind）出现在 body 即被 strict 拒绝。
export const CreateRenderRequestSchema = z.strictObject({
  /** vibe 氛围描述（前端已 sanitize，服务端再兜底裁剪）。 */
  vibeText: z.string().trim().min(1).max(400),
  /** 可选环境照（笼箱实拍）Asset id——有则做保结构 i2i 改造，无则 t2i 从零生成。 */
  environmentAssetId: z.string().min(1).optional(),
  /** 可选宠物照 Asset id——有则要求效果图内宠物外观与参考照一致。 */
  petAssetId: z.string().min(1).optional(),
  /** 业务幂等键：同一 (owner, vibe_render, key) 只成立一个任务，重复请求不重复扣费。 */
  idempotencyKey: z.string().min(1).max(200),
});

export type CreateRenderRequest = z.infer<typeof CreateRenderRequestSchema>;

// ── job input（worker 侧消费；与 application/vibe-render.ts 是同一契约两端）──────
// 客户端提交的 vibe/assetId 经路由校验后进入本形状；_requestId 由 web 侧透传
// （沿用 sample.echo 的 requestId 关联约定，不改 Job schema）。
export const VibeRenderJobInputSchema = z.object({
  projectId: z.string().min(1),
  vibeText: z.string().min(1),
  environmentAssetId: z.string().min(1).optional(),
  petAssetId: z.string().min(1).optional(),
  _requestId: z.string().optional(),
});

export type VibeRenderJobInput = z.infer<typeof VibeRenderJobInputSchema>;

// ── job resultRef（worker 完成后写回；产物 Asset 引用）────────────────────────
export const VibeRenderResultRefSchema = z.object({
  /** 产出的 generated_render Asset id（owned，可经签名 URL 下载）。 */
  assetId: z.string().min(1),
  ossKey: z.string().min(1),
  /** 生成引擎标识（可观测/审计：哪个模型出的图）。 */
  engine: z.string().min(1),
});

export type VibeRenderResultRef = z.infer<typeof VibeRenderResultRefSchema>;

// ── 响应契约：建任务返回 job 摘要（与 jobs 端点同形）+ created 标志 ────────────
export const CreateRenderResponseSchema = z.strictObject({
  job: z.object({
    id: z.string().min(1),
    type: z.literal(VIBE_RENDER_JOB_TYPE),
    status: z.enum(['pending', 'running', 'succeeded', 'failed', 'canceled', 'needs_attention']),
  }),
  created: z.boolean(),
});

export type CreateRenderResponse = z.infer<typeof CreateRenderResponseSchema>;

// ── 响应契约：GET 最新 vibe_render 展示态（RenderSection 消费）────────────────
// 服务端裁定的展示引用：环境照 assetId（用户上传，「改造前」）+ 产物 assetId
// （generated_render，「改造后」）+ 任务状态。前端凭 assetId 经既有下载端点换签名
// URL，不注入任何 URL/产物字段。无任务时三字段皆 null。
export const LatestRenderResponseSchema = z.strictObject({
  status: z
    .enum(['pending', 'running', 'succeeded', 'failed', 'canceled', 'needs_attention'])
    .nullable(),
  environmentAssetId: z.string().min(1).nullable(),
  renderAssetId: z.string().min(1).nullable(),
});

export type LatestRenderResponse = z.infer<typeof LatestRenderResponseSchema>;

export const RenderApiErrorSchema = z.strictObject({
  error: z.enum(['unauthorized', 'invalid_json', 'invalid_request', 'not_found']),
  detail: z.string().optional(),
  issues: z
    .array(
      z.strictObject({
        path: z.array(z.union([z.string(), z.number()])),
        message: z.string(),
      }),
    )
    .optional(),
});

export type RenderApiError = z.infer<typeof RenderApiErrorSchema>;
