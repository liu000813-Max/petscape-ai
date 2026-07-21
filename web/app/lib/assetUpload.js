// web/app/lib/assetUpload.js —— landing 上传组件走 v1 Asset 链（WP-G2）。
// spec: docs/plans/g-line-execution-plan.md WP-G2；ADR-0005（对象存储）。
//
// 三段式：POST /api/v1/projects/{projectId}/assets（建 pending Asset + 签名 PUT URL）
//   → PUT 签名 URL（客户端直传，不经 Web 服务器带宽）
//   → POST /api/v1/assets/{assetId}/confirm（服务端 HEAD OSS 校验后置 available）。
// 客户端提交的 filename/mime/size 只是声明，服务端在 confirm 阶段核对真实对象
// 大小是否一致（ADR-0005 口径："客户端提交的文件名和 MIME 类型不能直接成为可信元数据"）。
//
// 返回 { assetId, downloadUrl }：assetId 是持久引用，downloadUrl 是短 TTL 签名 URL，
// 调用方只把 downloadUrl 用于当前会话内 <img src> 展示，不做长期持久化假设
// （同 pets.ts coverAssetId 模式：持久化的是 id，URL 按需签发）。
export async function uploadProjectImageAsset(projectId, file) {
  if (!projectId) throw new Error('项目还在初始化，请稍后再试');

  const requestRes = await fetch(`/api/v1/projects/${projectId}/assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, mime: file.type, size: file.size }),
  });
  if (!requestRes.ok) {
    const data = await requestRes.json().catch(() => ({}));
    throw new Error(data.error || '上传初始化失败');
  }
  const { asset, uploadUrl } = await requestRes.json();

  // 服务端签名 URL 已把 file.type 预先纳入签名（infra/oss signPutUrl），客户端
  // PUT 必须携带完全相同的 Content-Type，否则 OSS 会以 SignatureDoesNotMatch
  // 拒绝——真实浏览器 fetch(url, { body: File }) 本就会自动附加该 header，这里
  // 显式声明是为了保证与服务端签名时使用的 mime 值逐字节一致。
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!putRes.ok) throw new Error('上传到对象存储失败');

  const confirmRes = await fetch(`/api/v1/assets/${asset.id}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ size: file.size }),
  });
  if (!confirmRes.ok) {
    const data = await confirmRes.json().catch(() => ({}));
    throw new Error(data.error || '上传校验失败');
  }
  const downloadRes = await fetch(`/api/v1/assets/${asset.id}/download`);
  if (!downloadRes.ok) throw new Error('获取图片地址失败');
  const { downloadUrl } = await downloadRes.json();

  return { assetId: asset.id, downloadUrl };
}
