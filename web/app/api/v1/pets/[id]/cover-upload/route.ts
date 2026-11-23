import { NextResponse } from 'next/server';
import { getMiniappAwareSession } from '../../../../../lib/miniapp-auth';
import { getWebServerContext, withApiLogging } from '../../../../../lib/server-context';
import { getPet, requestAssetUpload, uploadPetCover, AssetVerificationError, NotFoundError } from '@petscape/server/application';
import {
  PetCoverUploadRequestSchema,
  PetCoverUploadResponseSchema,
  PetIdParamsSchema,
  PET_COVER_MAX_BYTES,
  PetCoverStoredResponseSchema,
} from '@petscape/server/contracts/pets';
import { invalidPetRequest, petApiError } from '../../../../../lib/pet-api';
import { readBoundedBody, BodyTooLargeError } from '../../../../../lib/bounded-body';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiLogging(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) return petApiError(401, { error: 'unauthorized' });

    const contentType = req.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (contentType?.startsWith('image/')) {
      const context = getWebServerContext();
      const parsedId = PetIdParamsSchema.safeParse(await params);
      if (!parsedId.success) return invalidPetRequest(parsedId.error, session.user.id);
      const metadata = PetCoverUploadRequestSchema.safeParse({ filename: 'avatar', mime: contentType, size: 1 });
      if (!metadata.success) return invalidPetRequest(metadata.error, session.user.id);
      try {
        // Check ownership before reading bytes or initializing object storage.
        await getPet({ prisma: context.prisma, ownerUserId: session.user.id, petId: parsedId.data.id });
        const bytes = await readBoundedBody(req, PET_COVER_MAX_BYTES);
        if (!bytes.length) return petApiError(400, { error: 'invalid_request' }, session.user.id);
        const asset = await uploadPetCover({ prisma: context.prisma, oss: context.oss,
          ownerUserId: session.user.id, petId: parsedId.data.id, mime: metadata.data.mime, bytes });
        return Object.assign(NextResponse.json(PetCoverStoredResponseSchema.parse({ assetId: asset.id }), { status: 201 }), { _loggedUserId: session.user.id });
      } catch (error) {
        if (error instanceof NotFoundError) return petApiError(404, { error: 'not_found' }, session.user.id);
        if (error instanceof BodyTooLargeError) return petApiError(413, { error: 'invalid_request' }, session.user.id);
        if (error instanceof AssetVerificationError) return petApiError(400, { error: 'invalid_cover_asset' }, session.user.id);
        throw error;
      }
    }

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
