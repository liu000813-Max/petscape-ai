import { NextResponse } from 'next/server';
import { getMiniappAwareSession } from '../../../../../../lib/miniapp-auth';
import { getWebServerContext } from '../../../../../../lib/server-context';
import { withContentApi } from '../../../../../../lib/content-api';
import { deletePetGrowthEntry, InvalidPetGrowthEntryError, NotFoundError, updatePetGrowthEntry } from '@petscape/server/application';
import { DeletePetGrowthEntryResponseSchema, PetGrowthEntryParamsSchema, UpdatePetGrowthEntrySchema, PetGrowthEntryResponseSchema } from '@petscape/server/contracts/pet-growth';
import { invalidPetRequest, petApiError, privatePetApiResponse } from '../../../../../../lib/pet-api';

type Context = { params: Promise<{ id: string; entryId: string }> };

export async function PATCH(req: Request, context: Context) {
  return privatePetApiResponse(withContentApi(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) return petApiError(401, { error: 'unauthorized' });
    const params = PetGrowthEntryParamsSchema.safeParse(await context.params);
    if (!params.success) return invalidPetRequest(params.error, session.user.id);
    let body: unknown;
    try { body = await req.json(); }
    catch { return petApiError(400, { error: 'invalid_json' }, session.user.id); }
    const parsed = UpdatePetGrowthEntrySchema.safeParse(body);
    if (!parsed.success) return invalidPetRequest(parsed.error, session.user.id);
    const server = getWebServerContext();
    try {
      const result = await updatePetGrowthEntry({ prisma: server.prisma, get oss() { return server.oss; }, ownerUserId: session.user.id,
        petId: params.data.id, entryId: params.data.entryId, input: parsed.data });
      return Object.assign(NextResponse.json(PetGrowthEntryResponseSchema.parse(result)), { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) return petApiError(404, { error: 'not_found' }, session.user.id);
      if (error instanceof InvalidPetGrowthEntryError) return petApiError(400, { error: 'invalid_request', detail: error.message }, session.user.id);
      throw error;
    }
  }));
}

export async function DELETE(req: Request, context: Context) {
  return privatePetApiResponse(withContentApi(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) return petApiError(401, { error: 'unauthorized' });
    const params = PetGrowthEntryParamsSchema.safeParse(await context.params);
    if (!params.success) return invalidPetRequest(params.error, session.user.id);
    try {
      const result = await deletePetGrowthEntry({ prisma: getWebServerContext().prisma, ownerUserId: session.user.id,
        petId: params.data.id, entryId: params.data.entryId });
      return Object.assign(NextResponse.json(DeletePetGrowthEntryResponseSchema.parse(result)), { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) return petApiError(404, { error: 'not_found' }, session.user.id);
      throw error;
    }
  }));
}
