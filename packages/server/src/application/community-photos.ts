import type { PrismaClient } from '../infra/db/index.ts';
import type { OssStorage } from '../infra/oss/index.ts';
import { NotFoundError } from '../domain/index.ts';
import { PET_COVER_MAX_BYTES, PET_COVER_MIME_TYPES } from '../contracts/pets.ts';
import { confirmAssetUpload, requestAssetUpload, sniffMimeFromBytes, AssetVerificationError } from './assets.ts';

const PHOTO_KIND = 'community_photo';
export function isCommunityImage(mime: string): boolean {
  return PET_COVER_MIME_TYPES.some(allowed => allowed === mime);
}

export async function uploadCommunityPhoto(input: {
  prisma: PrismaClient; oss: OssStorage; ownerUserId: string; mime: string; bytes: Buffer;
}) {
  const { prisma, ownerUserId, mime, bytes } = input;
  if (!bytes.length || bytes.length > PET_COVER_MAX_BYTES || !isCommunityImage(mime) || sniffMimeFromBytes(bytes) !== mime) {
    throw new AssetVerificationError('invalid_community_photo');
  }
  const { oss } = input;
  const extension = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
  const { asset } = await requestAssetUpload({ prisma, oss, ownerUserId,
    filename: `community-photo.${extension}`, mime, size: bytes.length, kind: PHOTO_KIND });
  await oss.put(asset.ossKey, bytes);
  return confirmAssetUpload({ prisma, oss, ownerUserId, assetId: asset.id, declaredSize: bytes.length });
}

export async function findCommunityPhoto({ prisma, postId, assetId, userId }: {
  prisma: PrismaClient; postId: string; assetId: string; userId?: string;
}) {
  const row = await prisma.communityPostPhoto.findUnique({
    where: { postId_assetId: { postId, assetId } },
    select: { asset: true, post: { select: { status: true, ownerUserId: true } } },
  });
  if (!row || row.asset.ownerUserId !== row.post.ownerUserId || row.asset.status !== 'available'
      || !isCommunityImage(row.asset.mime) || ![PHOTO_KIND, 'growth_photo'].includes(row.asset.kind)) throw new NotFoundError('CommunityPostPhoto');
  if (row.post.status !== 'published' && userId !== row.post.ownerUserId) {
    const actor = userId && await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!actor || actor.role !== 'admin') throw new NotFoundError('CommunityPostPhoto');
  }
  return row.asset;
}

export async function readCommunityPhoto(input: {
  prisma: PrismaClient; oss: OssStorage; postId: string; assetId: string; userId?: string;
}) {
  const asset = await findCommunityPhoto(input);
  const { oss } = input;
  const head = await oss.head(asset.ossKey);
  if (!head.exists || !head.etag || (asset.checksum && head.etag !== asset.checksum)
      || head.size !== asset.size || asset.size > PET_COVER_MAX_BYTES) throw new NotFoundError('CommunityPostPhoto');
  const bytes = await oss.getVerifiedBuffer({ key: asset.ossKey, etag: head.etag, expectedBytes: asset.size, maxBytes: PET_COVER_MAX_BYTES });
  if (sniffMimeFromBytes(bytes) !== asset.mime) throw new NotFoundError('CommunityPostPhoto');
  return { bytes, mime: asset.mime };
}
