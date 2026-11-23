import type { PrismaClient } from '../infra/db/index.ts';
import type { OssStorage } from '../infra/oss/index.ts';
import { NotFoundError } from '../domain/index.ts';
import { UpdateMiniappProfileSchema, type UpdateMiniappProfile } from '../contracts/miniapp-profile.ts';
import { PET_COVER_MAX_BYTES, PET_COVER_MIME_TYPES } from '../contracts/pets.ts';
import { requestAssetUpload, confirmAssetUpload, sniffMimeFromBytes, AssetVerificationError } from './assets.ts';

export class InvalidProfileAvatarError extends Error {}

export async function getMiniappProfile({ prisma, userId }: { prisma: PrismaClient; userId: string }) {
  const profile = await prisma.miniappProfile.findUnique({ where: { userId } });
  return { nickname: profile?.nickname || '', avatarAssetId: profile?.avatarAssetId || null };
}

export async function updateMiniappProfile({ prisma, userId, input }: { prisma: PrismaClient; userId: string; input: UpdateMiniappProfile }) {
  const parsed = UpdateMiniappProfileSchema.parse(input);
  if (parsed.avatarAssetId) {
    const asset = await prisma.asset.findUnique({ where: { id: parsed.avatarAssetId } });
    if (!asset || asset.ownerUserId !== userId || asset.status !== 'available' || asset.kind !== 'user_avatar'
        || !PET_COVER_MIME_TYPES.includes(asset.mime as typeof PET_COVER_MIME_TYPES[number])) throw new InvalidProfileAvatarError();
  }
  const profile = await prisma.miniappProfile.upsert({ where: { userId }, create: { userId, ...parsed }, update: parsed });
  return { nickname: profile.nickname, avatarAssetId: profile.avatarAssetId };
}

export async function uploadProfileAvatar({ prisma, oss, userId, mime, bytes }: { prisma: PrismaClient; oss: OssStorage; userId: string; mime: string; bytes: Buffer }) {
  if (!await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })) throw new NotFoundError('User');
  if (!bytes.length || bytes.length > PET_COVER_MAX_BYTES || !PET_COVER_MIME_TYPES.includes(mime as typeof PET_COVER_MIME_TYPES[number]) || sniffMimeFromBytes(bytes) !== mime) throw new AssetVerificationError('invalid_avatar_image');
  const extension = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp';
  const result = await requestAssetUpload({ prisma, oss, ownerUserId: userId, filename: `owner-avatar.${extension}`, mime, size: bytes.length, kind: 'user_avatar' });
  await oss.put(result.asset.ossKey, bytes);
  return confirmAssetUpload({ prisma, oss, ownerUserId: userId, assetId: result.asset.id, declaredSize: bytes.length });
}
