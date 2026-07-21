// application/assets.ts —— 资产上传/下载用例（WP-3.2）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.2；ADR-0005（对象存储）。
//
// 上传流：requestAssetUpload（session 鉴权由调用方保证→kind 必须在服务端
// allowlist 内→建 pending Asset→签发短 TTL PUT 签名 URL）→ 客户端 PUT →
// confirmAssetUpload（服务端 head OSS 对象校验存在+大小与声明一致+真实字节魔数
// 与声明 mime 一致→Asset 置 available 并写入 checksum=OSS ETag；任一不一致则
// 保持 pending 并报错，WP-3.2 验收 3 + QA 修复）。下载：getAssetDownloadUrl
// （owner 校验→短 TTL GET 签名 URL）。
//
// OSS key 规则（ADR-0005 + 本包补充决定）：
//   uploads/raw/{ownerUserId}/{assetId}/{safe-filename}
// assetId 是不可猜测标识（cuid，由数据库生成，先建 Asset 行拿到 id 再构造 key）；
// 客户端文件名清洗后仅作末段展示名，不作信任元数据。客户端声明的 mime/size 只是
// 建 pending Asset 时的占位值，confirm 阶段服务端据真实字节裁定：大小与 OSS 对象
// 一致、mime 与真实字节魔数一致，两者皆通过才置 available；kind 完全不接受客户端
// 输入，只能是服务端 allowlist 内的值（QA 修复：ADR-0005"客户端提交的文件名和
// MIME 类型不能直接成为可信元数据"+ g-line §一 G0a"客户端不得注入产物字段"）。
import type { PrismaClient } from '../infra/db/index.ts';
import type { OssStorage } from '../infra/oss/index.ts';
import { assertOwner, NotFoundError } from '../domain/index.ts';

export { NotFoundError };

// 用户上传入口允许的 Asset.kind（QA 修复：g-line §一 G0a 契约"客户端不得注入
// 产物字段"——generated_render/extracted_item/generated_model 等产物 kind 只能
// 由服务端 worker/任务流水线在各自用例内部指定，不属于 requestAssetUpload 这个
// 「用户直传原图」入口的合法取值；调用方传入不在此列表中的 kind 视为编程错误，
// 直接拒绝而不是原样建 Asset——防止路由层疏忽把客户端 body 里的 kind 字段透传
// 进来时静默放行）。
const ALLOWED_UPLOAD_KINDS = ['upload_raw', 'pet_cover'] as const;

export class InvalidAssetKindError extends Error {
  constructor(kind: string) {
    super(`kind "${kind}" 不在允许的上传入口 kind 列表中（${ALLOWED_UPLOAD_KINDS.join(', ')}）`);
    this.name = 'InvalidAssetKindError';
  }
}

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

// 魔数嗅探所需的最大字节数（各类型魔数都在头 12 字节内；多留一些余量给 WebP 的
// RIFF....WEBP 结构，共 16 字节即够）。
const MIME_SNIFF_BYTES = 16;

/**
 * 按文件真实字节魔数裁定 mime（QA 修复：ADR-0005"客户端提交的文件名和 MIME
 * 类型不能直接成为可信元数据"——此前只在建 Asset 行时写入客户端声明的 mime，
 * 从未与真实字节核对。返回 null 表示无法从已支持的魔数中识别出类型（未知/
 * 不支持格式，调用方视为不一致处理，不放行）。
 */
function sniffMimeFromBytes(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 6 && bytes.subarray(0, 6).toString('ascii') === 'GIF87a') return 'image/gif';
  if (bytes.length >= 6 && bytes.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  // HEIC/HEIF：ISO base media file format，ftyp box 从偏移 4 开始，brand 在偏移 8。
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = bytes.subarray(8, 12).toString('ascii');
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'].includes(brand)) {
      return 'image/heic';
    }
  }
  return null;
}

/**
 * 声明的 mime 是否与嗅探结果兼容——JPEG 有 image/jpeg 与 image/jpg 两种常见
 * 声明值，两者都应视为与 image/jpeg 嗅探结果一致，其余类型要求完全相等。
 */
function mimeMatchesSniffedType(declaredMime: string, sniffedMime: string): boolean {
  if (sniffedMime === 'image/jpeg') return declaredMime === 'image/jpeg' || declaredMime === 'image/jpg';
  return declaredMime === sniffedMime;
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
  if (!(ALLOWED_UPLOAD_KINDS as readonly string[]).includes(kind)) {
    throw new InvalidAssetKindError(kind);
  }

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

  // mime 预声明进签名（见 infra/oss signPutUrl 注释）：客户端 PUT 必须携带同一
  // Content-Type，真实浏览器上传 File/Blob 时会自动附加该 header，两边必须一致。
  const uploadUrl = await oss.signPutUrl(ossKey, PUT_URL_TTL_SECONDS, mime);

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
 * 服务端 HEAD OSS 对象校验存在 + 大小与 Asset 记录声明一致 + 真实字节魔数与声明
 * mime 一致，全部通过才置 available、写入 checksum（OSS ETag）；任一不一致则
 * 保持 pending 并抛 AssetVerificationError（WP-3.2 验收 3 + QA 修复：伪造
 * key/尺寸/mime 时 Asset 均不进入可用态，checksum 不写入）。
 *
 * mime 嗅探（QA 修复，ADR-0005"客户端提交的文件名和 MIME 类型不能直接成为可信
 * 元数据"）：只对已支持的图片魔数做识别（PNG/JPEG/GIF/WebP/HEIC）；嗅探不出
 * 已知类型时同样拒绝——不支持格式不应该悄悄放行成使用者未预期的 mime。
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

  // mime 嗅探只强校验声明为图片类型（image/*）的资产——这是本 WP 覆盖的宠物照/
  // 环境照场景，且图片格式有可靠魔数可核对；声明为其他类型（如
  // application/octet-stream，3D 资产等未来种类）目前没有对应的可靠嗅探规则，
  // 不在此处强行拒绝。声明 image/* 但嗅探不出已知图片魔数（包括嗅探为其他不同
  // 图片类型）一律视为不一致——不支持格式不应该悄悄放行成使用者未预期的 mime。
  if (asset.mime.startsWith('image/')) {
    const headBytes = await oss.readHeadBytes(asset.ossKey, MIME_SNIFF_BYTES);
    const sniffedMime = sniffMimeFromBytes(headBytes);
    if (!sniffedMime || !mimeMatchesSniffedType(asset.mime, sniffedMime)) {
      throw new AssetVerificationError(
        `声明 mime（${asset.mime}）与对象真实字节魔数${sniffedMime ? `（嗅探为 ${sniffedMime}）` : '（无法识别为已支持的图片格式）'}不一致，Asset 保持 pending。`,
      );
    }
  }

  const updated = await prisma.asset.update({
    where: { id: assetId },
    data: { status: 'available', checksum: head.etag ?? null },
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

export interface ListProjectAssetsInput {
  prisma: PrismaClient;
  oss: OssStorage;
  ownerUserId: string;
  projectId: string;
}

export interface ProjectAssetSummary extends AssetSummary {
  downloadUrl: string;
}

/**
 * 列出项目下当前用户拥有的 available 资产（含短 TTL 下载签名 URL）。
 * pending 资产（未完成上传确认）不返回——WP-G2「重启后图仍可见」验收的核心机制：
 * 内存态清零后，assetId 仍能凭数据库 + OSS（唯一持久层）换到有效签名 URL，不依赖
 * 进程内存缓存的 URL 字符串（同 pets.ts 的 coverAssetId 模式：持久化的是 assetId，
 * 签名 URL 按需签发）。
 */
export async function listProjectAssets({
  prisma,
  oss,
  ownerUserId,
  projectId,
}: ListProjectAssetsInput): Promise<ProjectAssetSummary[]> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  assertOwner(project, ownerUserId, 'Project');

  const assets = await prisma.asset.findMany({
    where: { projectId, ownerUserId, status: 'available' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

  return Promise.all(
    assets.map(async (asset) => ({
      ...toSummary(asset),
      downloadUrl: await oss.signGetUrl(asset.ossKey, GET_URL_TTL_SECONDS),
    })),
  );
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
