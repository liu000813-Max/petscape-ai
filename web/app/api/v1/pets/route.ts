import { NextResponse } from 'next/server';
import { getMiniappAwareSession } from '../../../lib/miniapp-auth';
import { getWebServerContext, withApiLogging } from '../../../lib/server-context';
import { createPet, listPets, InvalidPetCoverError, InvalidPetProfileError } from '@petscape/server/application';
import { CreatePetRequestSchema, PetListResponseSchema, PetResponseSchema } from '@petscape/server/contracts/pets';
import { invalidPetRequest, petApiError, toPetResponse } from '../../../lib/pet-api';

export async function POST(req: Request) {
  return withApiLogging(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) return petApiError(401, { error: 'unauthorized' });

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return petApiError(400, { error: 'invalid_json' }, session.user.id);
    }
    const request = CreatePetRequestSchema.safeParse(json);
    if (!request.success) return invalidPetRequest(request.error, session.user.id);

    const context = getWebServerContext();
    try {
      const pet = await createPet({ prisma: context.prisma, ownerUserId: session.user.id, input: request.data });
      const body = PetResponseSchema.parse(await toPetResponse(pet, session.user.id, context));
      const response = NextResponse.json(body, { status: 201 });
      return Object.assign(response, { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof InvalidPetCoverError) {
        return petApiError(400, { error: 'invalid_cover_asset', detail: error.message }, session.user.id);
      }
      if (error instanceof InvalidPetProfileError) {
        return petApiError(400, { error: 'invalid_request', detail: error.message }, session.user.id);
      }
      throw error;
    }
  });
}

export async function GET(req: Request) {
  return withApiLogging(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) return petApiError(401, { error: 'unauthorized' });

    const context = getWebServerContext();
    const pets = await listPets({ prisma: context.prisma, ownerUserId: session.user.id });
    const body = PetListResponseSchema.parse({
      pets: await Promise.all(pets.map((pet) => toPetResponse(pet, session.user.id, context))),
    });
    const response = NextResponse.json(body);
    return Object.assign(response, { _loggedUserId: session.user.id });
  });
}
