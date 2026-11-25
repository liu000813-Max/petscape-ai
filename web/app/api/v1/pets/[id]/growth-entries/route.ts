import { NextResponse } from 'next/server';
import { getMiniappAwareSession } from '../../../../../lib/miniapp-auth';
import { getWebServerContext } from '../../../../../lib/server-context';
import { withContentApi } from '../../../../../lib/content-api';
import { createPetGrowthEntry, GrowthEntrySaveConflictError, listPetGrowthEntries, NotFoundError } from '@petscape/server/application';
import {
  CreatePetGrowthEntrySchema,
  ListPetGrowthEntriesQuerySchema,
  ListPetGrowthEntriesResponseSchema,
  PetGrowthEntryResponseSchema,
} from '@petscape/server/contracts/pet-growth';
import { invalidPetRequest, petApiError, privatePetApiResponse } from '../../../../../lib/pet-api';
import { PetIdParamsSchema } from '@petscape/server/contracts/pets';

type Context = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: Context) {
  return privatePetApiResponse(withContentApi(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) return petApiError(401, { error: 'unauthorized' });
    const parsedPet = PetIdParamsSchema.safeParse(await context.params);
    if (!parsedPet.success) return invalidPetRequest(parsedPet.error, session.user.id);
    const query = ListPetGrowthEntriesQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams.entries()));
    if (!query.success) return invalidPetRequest(query.error, session.user.id);
    const server = getWebServerContext();
    try {
      const result = await listPetGrowthEntries({ prisma: server.prisma, get oss() { return server.oss; },
        ownerUserId: session.user.id, petId: parsedPet.data.id, query: query.data });
      return Object.assign(NextResponse.json(ListPetGrowthEntriesResponseSchema.parse(result)), { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) return petApiError(404, { error: 'not_found' }, session.user.id);
      throw error;
    }
  }));
}

export async function POST(req: Request, context: Context) {
  return privatePetApiResponse(withContentApi(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) return petApiError(401, { error: 'unauthorized' });
    const parsedPet = PetIdParamsSchema.safeParse(await context.params);
    if (!parsedPet.success) return invalidPetRequest(parsedPet.error, session.user.id);
    let body: unknown;
    try { body = await req.json(); }
    catch { return petApiError(400, { error: 'invalid_json' }, session.user.id); }
    const parsed = CreatePetGrowthEntrySchema.safeParse(body);
    if (!parsed.success) return invalidPetRequest(parsed.error, session.user.id);
    const server = getWebServerContext();
    try {
      const entry = await createPetGrowthEntry({ prisma: server.prisma, get oss() { return server.oss; },
        ownerUserId: session.user.id, petId: parsedPet.data.id, input: parsed.data });
      return Object.assign(NextResponse.json(PetGrowthEntryResponseSchema.parse(entry), { status: 201 }), { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) return petApiError(404, { error: 'not_found' }, session.user.id);
      if (error instanceof GrowthEntrySaveConflictError) return NextResponse.json({ error: 'conflict' }, { status: 409 });
      throw error;
    }
  }));
}
