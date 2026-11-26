import { NextResponse } from 'next/server';
import { AssetVerificationError, isCommunityImage, uploadCommunityPhoto } from '@petscape/server/application';
import { PET_COVER_MAX_BYTES } from '@petscape/server/contracts/pets';
import { getMiniappAwareSession } from '../../../../../lib/miniapp-auth';
import { getWebServerContext } from '../../../../../lib/server-context';
import { withContentApi } from '../../../../../lib/content-api';
import { BodyTooLargeError, readBoundedBody } from '../../../../../lib/bounded-body';

export async function POST(req: Request) {
  return withContentApi(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const mime = req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
    if (!isCommunityImage(mime)) return NextResponse.json({ error: 'invalid_community_photo' }, { status: 400 });
    const context = getWebServerContext();
    try {
      const bytes = await readBoundedBody(req, PET_COVER_MAX_BYTES);
      const asset = await uploadCommunityPhoto({ prisma: context.prisma, get oss() { return context.oss; },
        ownerUserId: session.user.id, mime, bytes });
      const response = NextResponse.json({ assetId: asset.id }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
      return Object.assign(response, { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof BodyTooLargeError) return NextResponse.json({ error: 'invalid_community_photo' }, { status: 413 });
      if (error instanceof AssetVerificationError) return NextResponse.json({ error: 'invalid_community_photo' }, { status: 400 });
      throw error;
    }
  });
}
