import { NextResponse } from 'next/server';
import { getAssetDownloadUrl, type ServerContext } from '@petscape/server/application';
import { MiniappProfileResponseSchema } from '@petscape/server/contracts/miniapp-profile';

export async function profileResponse(profile: { nickname: string; avatarAssetId: string | null }, userId: string, context: ServerContext) {
  const avatarUrl = profile.avatarAssetId ? (await getAssetDownloadUrl({ prisma: context.prisma, oss: context.oss, ownerUserId: userId, assetId: profile.avatarAssetId })).downloadUrl : null;
  return Object.assign(NextResponse.json(MiniappProfileResponseSchema.parse({ ...profile, avatarUrl }), { headers: { 'Cache-Control': 'private, no-store' } }), { _loggedUserId: userId });
}
