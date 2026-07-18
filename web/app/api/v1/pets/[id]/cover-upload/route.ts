import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../../lib/server-context';
import { getPet, requestAssetUpload, NotFoundError } from '@petscape/server/application';
import {
  PetCoverUploadRequestSchema,
  PetCoverUploadResponseSchema,
  PetIdParamsSchema,
} from '@petscape/server/contracts/pets';
import { invalidPetRequest, petApiError } from '../../../../../lib/pet-api';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return petApiError(401, { error: 'unauthorized' });

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return petApiError(400, { error: 'invalid_json' }, session.user.id);
    }
    const request = PetCoverUploadRequestSchema.safeParse(json);
    if (!request.success) return invalidPetRequest(request.error, session.user.id);

    const context = getWebServerContext();
    const petId = PetIdParamsSchema.parse(await params).id;
    try {
      await getPet({ prisma: context.prisma, ownerUserId: session.user.id, petId });
      const result = await requestAssetUpload({
        prisma: context.prisma,
        oss: context.oss,
        ownerUserId: session.user.id,
        filename: request.data.filename,
        mime: request.data.mime,
        size: request.data.size,
        kind: 'pet_cover',
      });
      const body = PetCoverUploadResponseSchema.parse({
        assetId: result.asset.id,
        uploadUrl: result.uploadUrl,
        expiresInSeconds: result.expiresInSeconds,
      });
      const response = NextResponse.json(body, { status: 201 });
      return Object.assign(response, { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) return petApiError(404, { error: 'not_found' }, session.user.id);
      throw error;
    }
  });
}
