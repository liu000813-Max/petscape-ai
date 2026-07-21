// web/app/lib/vibeRender.js —— landing vibe 效果图走 v1 持久任务链（WP-G3）。
// spec: docs/plans/g-line-execution-plan.md WP-G3。
//
// 旧链（POST /api/project/:id/vibe → 内存状态机 → 轮询 GET /api/project/:id）已退役。
// 新链：POST /api/v1/projects/:id/renders 建 vibe_render 任务 → 轮询 GET
// /api/v1/jobs/:id 直到 succeeded/failed → 从 job.resultRef.assetId 换签名下载 URL。
// 产物是 owned generated_render Asset，进程重启不丢（持久任务 + OSS + 数据库）。

/** 建 vibe_render 任务。assetId 引用 G2 已上传的环境照/宠物照（照片真实入图）。 */
export async function startVibeRender(projectId, { vibeText, environmentAssetId, petAssetId, idempotencyKey }) {
  const res = await fetch(`/api/v1/projects/${projectId}/renders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vibeText,
      ...(environmentAssetId ? { environmentAssetId } : {}),
      ...(petAssetId ? { petAssetId } : {}),
      idempotencyKey,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || '生成任务创建失败');
  }
  const { job } = await res.json();
  return job; // { id, type, status }
}

/** 拿单个 Asset 的短 TTL 签名下载 URL（同 assetUpload 的换 URL 手法）。 */
export async function getRenderDownloadUrl(assetId) {
  const res = await fetch(`/api/v1/assets/${assetId}/download`);
  if (!res.ok) throw new Error('获取效果图地址失败');
  const { downloadUrl } = await res.json();
  return downloadUrl;
}

/**
 * 轮询任务直到终态；成功后返回产物效果图的签名下载 URL。
 * onStatus(status) 供 UI 反映 running/failed。pollMs 默认 1500（图像生成较慢）。
 */
export async function pollVibeRender(jobId, { onStatus, signal, pollMs = 1500 } = {}) {
  for (;;) {
    if (signal?.aborted) return null;
    const res = await fetch(`/api/v1/jobs/${jobId}`);
    if (res.ok) {
      const job = await res.json();
      onStatus?.(job.status);
      if (job.status === 'succeeded') {
        const assetId = job.resultRef?.assetId;
        if (!assetId) throw new Error('任务成功但缺产物引用');
        return getRenderDownloadUrl(assetId);
      }
      if (job.status === 'failed' || job.status === 'canceled' || job.status === 'needs_attention') {
        const detail = job.errorDetail?.message || '生成失败';
        throw new Error(detail);
      }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/**
 * 项目下最新 vibe_render 任务的展示态（RenderSection 消费）：
 *   { status, beforeUrl, afterUrl } —— beforeUrl=用户环境照签名 URL（有环境照的 job），
 *   afterUrl=产物效果图签名 URL（任务成功后）。任一 assetId 缺失时对应 URL 为 null，
 *   前端退回示例图 + 「示例」标签（与 main 生成前初始态语义一致）。
 * 用 GET /api/v1/projects/:id/renders 拿 job 引用的 assetId，再走既有下载端点换签名 URL。
 */
export async function fetchLatestRenderState(projectId) {
  const res = await fetch(`/api/v1/projects/${projectId}/renders`);
  if (!res.ok) return { status: null, beforeUrl: null, afterUrl: null };
  const { status, environmentAssetId, renderAssetId } = await res.json();
  const [beforeUrl, afterUrl] = await Promise.all([
    environmentAssetId ? getRenderDownloadUrl(environmentAssetId).catch(() => null) : Promise.resolve(null),
    renderAssetId ? getRenderDownloadUrl(renderAssetId).catch(() => null) : Promise.resolve(null),
  ]);
  return { status, beforeUrl, afterUrl };
}
