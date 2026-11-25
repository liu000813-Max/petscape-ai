import { NextResponse } from 'next/server';
import { deleteCareLog, updateCareLog } from '@petscape/server/application';
import { CareLogParamsSchema, CareLogResponseSchema, UpdateCareLogSchema } from '@petscape/server/contracts/community-content';
import { getMiniappAwareSession } from '../../../../lib/miniapp-auth';
import { getWebServerContext } from '../../../../lib/server-context';
import { withContentApi } from '../../../../lib/content-api';
import { invalidPetRequest, petApiError, privatePetApiResponse } from '../../../../lib/pet-api';

type Context = { params: Promise<{ id: string }> };

function mutate(req: Request, context: Context, remove: boolean) {
  return privatePetApiResponse(withContentApi(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) return petApiError(401, { error: 'unauthorized' });
    const ownerUserId = session.user.id;
    const params = CareLogParamsSchema.safeParse(await context.params);
    if (!params.success) return invalidPetRequest(params.error, ownerUserId);
    const id = params.data.id;
    const prisma = getWebServerContext().prisma;
    if (remove) {
      const result = await deleteCareLog({ prisma, ownerUserId, id });
      return Object.assign(NextResponse.json(CareLogParamsSchema.parse(result)), { _loggedUserId: ownerUserId });
    }
    let json: unknown;
    try { json = await req.json(); }
    catch { return petApiError(400, { error: 'invalid_json' }, ownerUserId); }
    const parsed = UpdateCareLogSchema.safeParse(json);
    if (!parsed.success) return invalidPetRequest(parsed.error, ownerUserId);
    const result = await updateCareLog({ prisma, ownerUserId, id, input: parsed.data });
    return Object.assign(NextResponse.json(CareLogResponseSchema.parse(result)), { _loggedUserId: ownerUserId });
  }));
}

export function PATCH(req: Request, context: Context) { return mutate(req, context, false); }
export function DELETE(req: Request, context: Context) { return mutate(req, context, true); }
