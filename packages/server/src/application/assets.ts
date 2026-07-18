// application/assets.ts —— 资产上传/下载用例（WP-3.2）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.2；ADR-0005（对象存储）。
//
// 上传流：requestAssetUpload（session 鉴权由调用方保证→建 pending Asset→签发短
// TTL PUT 签名 URL）→ 客户端 PUT → confirmAssetUpload（服务端 head OSS 对象校验
// 存在+大小与声明一致→Asset 置 available；不一致则保持 pending 并报错，WP-3.2
// 验收 3）。下载：getAssetDownloadUrl（owner 校验→短 TTL GET 签名 URL）。
//
// OSS key 规则（ADR-0005 + 本包补充决定）：
//   uploads/raw/{ownerUserId}/{assetId}/{safe-filename}
// assetId 是不可猜测标识（cuid，由数据库生成，先建 Asset 行拿到 id 再构造 key）；
// 客户端文件名清洗后仅作末段展示名，不作信任元数据（大小/mime/checksum 均以服务端
// 事后校验或客户端声明+confirm 校验为准，不信任文件名本身携带的信息）。
import type { PrismaClient } from '../infra/db/index.ts';
import type { OssStorage } from '../infra/oss/index.ts';
import { assertOwner, NotFoundError } from '../domain/index.ts';

export { NotFoundError };

const PUT_URL_TTL_SECONDS = 5 * 60; // 5 分钟：小文件直传足够，最小化签名 URL 暴露窗口（ADR-0005）。
const GET_URL_TTL_SECONDS = 5 * 60;

export interface AssetSummary {
  id: string;
  ownerUserId: string;
  projectId: string | null;
  kind: string;
  mime: string;
  size: number;
  checksum: string | null;
  ossKey: string;
  status: 'pending' | 'available';
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 清洗客户端提供的文件名，仅保留安全字符作展示用途；不作为信任元数据消费
 * （ADR-0005："客户端提交的文件名和 MIME 类型不能直接成为可信元数据"）。
 */
function sanitizeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
  return cleaned.length > 0 ? cleaned : 'file';
}

function buildOssKey(ownerUserId: string, assetId: string, filename: string): string {
  return `uploads/raw/${ownerUserId}/${assetId}/${sanitizeFilename(filename)}`;
}

export interface RequestAssetUploadInput {
  prisma: PrismaClient;
  oss: OssStorage;
  ownerUserId: string;
  /** 可选业务引用；Asset 的权限根始终是 ownerUserId。 */
  projectId?: string | null;
  filename: string;
  mime: string;
  size: number;
  kind?: string;
}

export interface RequestAssetUploadResult {
  asset: AssetSummary;
  uploadUrl: string;
  expiresInSeconds: number;
}

/**
 * 建 pending Asset + 签发短 TTL PUT 签名 URL。若提供 projectId，项目必须属于当前
 * 用户（否则 404）；不提供时生成 User-owned Asset，供 Pet 封面等前置业务使用。
 */
export async function requestAssetUpload({
  prisma,
  oss,
  ownerUserId,
  projectId,
  filename,
  mime,
  size,
  kind = 'upload_raw',
}: RequestAssetUploadInput): Promise<RequestAssetUploadResult> {
  if (projectId) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    assertOwner(project, ownerUserId, 'Project');
  }

  // 先建行拿到 cuid（assetId 是 OSS key 的不可猜测段），ossKey 随后一次 update 写入。
  // Prisma 的 @default(cuid()) 只能通过 create 后读回 id 获取，故分两步。
  const created = await prisma.asset.create({
    data: {
      ownerUserId,
      projectId: projectId ?? null,
      kind,
      mime,
      size,
      status: 'pending',
      // ossKey 唯一约束不允许留空——先用占位值占住行，紧接着以真实 id 更新，
      // 两次写入在同一请求内完成，不会被其他请求观察到占位态。
      ossKey: `uploads/raw/${ownerUserId}/__pending__/${Date.now()}`,
    },
  });

  const ossKey = buildOssKey(ownerUserId, created.id, filename);
  const asset = await prisma.asset.update({
    where: { id: created.id },
    data: { ossKey },
  });

  const uploadUrl = await oss.signPutUrl(ossKey, PUT_URL_TTL_SECONDS);

  return {
    asset: toSummary(asset),
    uploadUrl,
    expiresInSeconds: PUT_URL_TTL_SECONDS,
  };
}

export interface ConfirmAssetUploadInput {
  prisma: PrismaClient;
  oss: OssStorage;
  ownerUserId: string;
  assetId: string;
  /** 客户端声明的最终大小，用于与 OSS 实际对象大小核对（WP-3.2 验收 3）。 */
  declaredSize?: number;
}

export class AssetVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetVerificationError';
  }
}

/**
 * 服务端 HEAD OSS 对象校验存在 + 大小与 Asset 记录声明一致，一致则置 available；
 * 不一致（对象不存在、大小不符）则保持 pending 并抛 AssetVerificationError
 * （WP-3.2 验收 3："伪造 key/尺寸不符时 Asset 不进入可用态"）。
 */
export async function confirmAssetUpload({
  prisma,
  oss,
  ownerUserId,
  assetId,
  declaredSize,
}: ConfirmAssetUploadInput): Promise<AssetSummary> {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  assertOwner(asset, ownerUserId, 'Asset');

  const head = await oss.head(asset.ossKey);
  if (!head.exists) {
    throw new AssetVerificationError(
      `OSS 对象不存在（key=${asset.ossKey}），Asset 保持 pending。`,
    );
  }

  const expectedSize = declaredSize ?? asset.size;
  if (head.size !== expectedSize) {
    throw new AssetVerificationError(
      `OSS 对象大小（${head.size}）与声明大小（${expectedSize}）不一致，Asset 保持 pending。`,
    );
  }

  const updated = await prisma.asset.update({
    where: { id: assetId },
    data: { status: 'available' },
  });
  return toSummary(updated);
}

export interface GetAssetDownloadUrlInput {
  prisma: PrismaClient;
  oss: OssStorage;
  ownerUserId: string;
  assetId: string;
}

export interface GetAssetDownloadUrlResult {
  asset: AssetSummary;
  downloadUrl: string;
  expiresInSeconds: number;
}

/** owner 校验（非 owner 404）→ 短 TTL GET 签名 URL。 */
export async function getAssetDownloadUrl({
  prisma,
  oss,
  ownerUserId,
  assetId,
}: GetAssetDownloadUrlInput): Promise<GetAssetDownloadUrlResult> {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  assertOwner(asset, ownerUserId, 'Asset');

  const downloadUrl = await oss.signGetUrl(asset.ossKey, GET_URL_TTL_SECONDS);
  return {
    asset: toSummary(asset),
    downloadUrl,
    expiresInSeconds: GET_URL_TTL_SECONDS,
  };
}

function toSummary(asset: {
  id: string;
  ownerUserId: string;
  projectId: string | null;
  kind: string;
  mime: string;
  size: number;
  checksum: string | null;
  ossKey: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): AssetSummary {
  return {
    id: asset.id,
    ownerUserId: asset.ownerUserId,
    projectId: asset.projectId,
    kind: asset.kind,
    mime: asset.mime,
    size: asset.size,
    checksum: asset.checksum,
    ossKey: asset.ossKey,
    status: asset.status as 'pending' | 'available',
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}
