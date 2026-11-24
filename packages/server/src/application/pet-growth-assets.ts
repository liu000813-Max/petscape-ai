import type { PrismaClient } from '../infra/db/index.ts';
import type { OssStorage } from '../infra/oss/index.ts';
import { NotFoundError } from '../domain/index.ts';
import { PET_COVER_MAX_BYTES, PET_COVER_MIME_TYPES } from '../contracts/pets.ts';
import { PetGrowthPhotoUploadSchema } from '../contracts/pet-growth.ts';
import { confirmAssetUpload, requestAssetUpload, sniffMimeFromBytes, AssetVerificationError } from './assets.ts';

export async function uploadPetGrowthPhoto(input: {
  prisma: PrismaClient; oss: OssStorage; ownerUserId: string; petId: string; mime: string; bytes: Buffer;
}) {
  const { prisma, ownerUserId, petId, mime, bytes } = input;
  const pet = await prisma.pet.findFirst({ where: { id: petId, ownerUserId, deletedAt: null }, select: { id: true } });
  if (!pet) throw new NotFoundError('Pet');
  if (!bytes.length || bytes.length > PET_COVER_MAX_BYTES
      || !PET_COVER_MIME_TYPES.includes(mime as typeof PET_COVER_MIME_TYPES[number])
      || sniffMimeFromBytes(bytes) !== mime) {
    throw new AssetVerificationError('invalid_growth_photo');
  }
  const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
  const metadata = PetGrowthPhotoUploadSchema.parse({ filename: `growth-photo.${extension}`, mime, size: bytes.length });
  const { oss } = input;
  const result = await requestAssetUpload({ prisma, oss, ownerUserId,
    filename: metadata.filename, mime: metadata.mime, size: metadata.size, kind: 'growth_photo' });
  await oss.put(result.asset.ossKey, bytes);
  return confirmAssetUpload({ prisma, oss, ownerUserId, assetId: result.asset.id, declaredSize: bytes.length });
}
