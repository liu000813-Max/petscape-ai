import { NextResponse } from 'next/server';
import { getMiniappAwareSession } from '../../../../lib/miniapp-auth';
import { getWebServerContext, withApiLogging } from '../../../../lib/server-context';
import { uploadProfileAvatar, AssetVerificationError } from '@petscape/server/application';
import { PET_COVER_MAX_BYTES, PET_COVER_MIME_TYPES, PetCoverStoredResponseSchema } from '@petscape/server/contracts/pets';
import { petApiError } from '../../../../lib/pet-api';
import { readBoundedBody, BodyTooLargeError } from '../../../../lib/bounded-body';

export async function POST(req: Request) {
  return withApiLogging(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) return petApiError(401, { error: 'unauthorized' });
    const mime = req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
    if (!PET_COVER_MIME_TYPES.includes(mime as typeof PET_COVER_MIME_TYPES[number])) return petApiError(400, { error: 'invalid_request' }, session.user.id);
    try {
      const bytes = await readBoundedBody(req, PET_COVER_MAX_BYTES);
      if (!bytes.length) return petApiError(400, { error: 'invalid_request' }, session.user.id);
      const context = getWebServerContext();
      const asset = await uploadProfileAvatar({ prisma: context.prisma, oss: context.oss, userId: session.user.id, mime, bytes });
      return Object.assign(NextResponse.json(PetCoverStoredResponseSchema.parse({ assetId: asset.id }), { status: 201, headers: { 'Cache-Control': 'private, no-store' } }), { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof BodyTooLargeError) return petApiError(413, { error: 'invalid_request' }, session.user.id);
      if (error instanceof AssetVerificationError) return petApiError(400, { error: 'invalid_cover_asset' }, session.user.id);
      throw error;
    }
  });
}
