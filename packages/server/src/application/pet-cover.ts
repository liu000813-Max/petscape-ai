import type { PrismaClient } from '../infra/db/index.ts';
import type { OssStorage } from '../infra/oss/index.ts';
import { PetCoverUploadRequestSchema } from '../contracts/pets.ts';
import { getPet } from './pets.ts';
import { requestAssetUpload, confirmAssetUpload, sniffMimeFromBytes, AssetVerificationError } from './assets.ts';

/** Native uploads use the existing API origin; private storage credentials stay on the server. */
export async function uploadPetCover(input: {
  prisma: PrismaClient; oss: OssStorage; ownerUserId: string; petId: string; mime: string; bytes: Buffer;
}) {
  const { prisma, oss, ownerUserId, petId, mime, bytes } = input;
  await getPet({ prisma, ownerUserId, petId });
  const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
  const request = PetCoverUploadRequestSchema.parse({ filename: `pet-avatar.${extension}`, mime, size: bytes.length });
  if (sniffMimeFromBytes(bytes) !== mime) throw new AssetVerificationError('image_type_mismatch');
  const result = await requestAssetUpload({ prisma, oss, ownerUserId, ...request, kind: 'pet_cover' });
  await oss.put(result.asset.ossKey, bytes);
  return confirmAssetUpload({ prisma, oss, ownerUserId, assetId: result.asset.id, declaredSize: bytes.length });
}
