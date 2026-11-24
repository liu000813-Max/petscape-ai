import { NextResponse } from 'next/server';
import { getMiniappAwareSession } from '../../../../../../lib/miniapp-auth';
import { getWebServerContext } from '../../../../../../lib/server-context';
import { withContentApi } from '../../../../../../lib/content-api';
import { getPet, uploadPetGrowthPhoto, NotFoundError, AssetVerificationError } from '@petscape/server/application';
import { PET_COVER_MAX_BYTES, PET_COVER_MIME_TYPES, PetIdParamsSchema } from '@petscape/server/contracts/pets';
import { PetGrowthPhotoUploadResponseSchema } from '@petscape/server/contracts/pet-growth';
import { invalidPetRequest, petApiError, privatePetApiResponse } from '../../../../../../lib/pet-api';
import { readBoundedBody, BodyTooLargeError } from '../../../../../../lib/bounded-body';

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  return privatePetApiResponse(withContentApi(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) return petApiError(401, { error: 'unauthorized' });
    const pet = PetIdParamsSchema.safeParse(await context.params);
    if (!pet.success) return invalidPetRequest(pet.error, session.user.id);
    const mime = req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
    if (!PET_COVER_MIME_TYPES.includes(mime as typeof PET_COVER_MIME_TYPES[number])) {
      return petApiError(400, { error: 'invalid_growth_photo' }, session.user.id);
    }
    const server = getWebServerContext();
    try {
      await getPet({ prisma: server.prisma, ownerUserId: session.user.id, petId: pet.data.id });
      const bytes = await readBoundedBody(req, PET_COVER_MAX_BYTES);
      const asset = await uploadPetGrowthPhoto({ prisma: server.prisma, get oss() { return server.oss; },
        ownerUserId: session.user.id, petId: pet.data.id, mime, bytes });
      return Object.assign(NextResponse.json(PetGrowthPhotoUploadResponseSchema.parse({ assetId: asset.id }), { status: 201 }), { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) return petApiError(404, { error: 'not_found' }, session.user.id);
      if (error instanceof BodyTooLargeError) return petApiError(413, { error: 'invalid_growth_photo' }, session.user.id);
      if (error instanceof AssetVerificationError) return petApiError(400, { error: 'invalid_growth_photo' }, session.user.id);
      throw error;
    }
  }));
}
