import { NextResponse } from 'next/server';
import { getMiniappAwareSession } from '../../../../lib/miniapp-auth';
import { getWebServerContext, withApiLogging } from '../../../../lib/server-context';
import {
  deletePet,
  getPet,
  updatePet,
  InvalidPetCoverError,
  InvalidPetProfileError,
  NotFoundError,
} from '@petscape/server/application';
import {
  DeletePetResponseSchema,
  PetIdParamsSchema,
  PetResponseSchema,
  UpdatePetRequestSchema,
} from '@petscape/server/contracts/pets';
import { invalidPetRequest, petApiError, toPetResponse } from '../../../../lib/pet-api';

type RouteContext = { params: Promise<{ id: string }> };

async function getId(context: RouteContext) {
  return PetIdParamsSchema.parse(await context.params).id;
}

export async function GET(req: Request, routeContext: RouteContext) {
  return withApiLogging(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) return petApiError(401, { error: 'unauthorized' });
    const context = getWebServerContext();
    try {
      const pet = await getPet({ prisma: context.prisma, ownerUserId: session.user.id, petId: await getId(routeContext) });
      const response = NextResponse.json(PetResponseSchema.parse(await toPetResponse(pet, session.user.id, context)));
      return Object.assign(response, { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) return petApiError(404, { error: 'not_found' }, session.user.id);
      throw error;
    }
  });
}

export async function PATCH(req: Request, routeContext: RouteContext) {
  return withApiLogging(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) return petApiError(401, { error: 'unauthorized' });

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return petApiError(400, { error: 'invalid_json' }, session.user.id);
    }
    const request = UpdatePetRequestSchema.safeParse(json);
    if (!request.success) return invalidPetRequest(request.error, session.user.id);

    const context = getWebServerContext();
    try {
      const pet = await updatePet({
        prisma: context.prisma,
        ownerUserId: session.user.id,
        petId: await getId(routeContext),
        input: request.data,
      });
      const response = NextResponse.json(PetResponseSchema.parse(await toPetResponse(pet, session.user.id, context)));
      return Object.assign(response, { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) return petApiError(404, { error: 'not_found' }, session.user.id);
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

export async function DELETE(req: Request, routeContext: RouteContext) {
  return withApiLogging(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) return petApiError(401, { error: 'unauthorized' });
    const { prisma } = getWebServerContext();
    try {
      const result = await deletePet({ prisma, ownerUserId: session.user.id, petId: await getId(routeContext) });
      const response = NextResponse.json(DeletePetResponseSchema.parse(result));
      return Object.assign(response, { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) return petApiError(404, { error: 'not_found' }, session.user.id);
      throw error;
    }
  });
}
