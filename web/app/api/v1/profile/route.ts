import { getMiniappAwareSession } from '../../../lib/miniapp-auth';
import { getWebServerContext, withApiLogging } from '../../../lib/server-context';
import { getMiniappProfile, updateMiniappProfile, InvalidProfileAvatarError } from '@petscape/server/application';
import { UpdateMiniappProfileSchema } from '@petscape/server/contracts/miniapp-profile';
import { invalidPetRequest, petApiError } from '../../../lib/pet-api';
import { profileResponse } from '../../../lib/miniapp-profile-api';

export async function GET(req: Request) {
  return withApiLogging(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) return petApiError(401, { error: 'unauthorized' });
    const context = getWebServerContext();
    return profileResponse(await getMiniappProfile({ prisma: context.prisma, userId: session.user.id }), session.user.id, context);
  });
}

export async function PATCH(req: Request) {
  return withApiLogging(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) return petApiError(401, { error: 'unauthorized' });
    let json: unknown;
    try { json = await req.json(); } catch { return petApiError(400, { error: 'invalid_json' }, session.user.id); }
    const request = UpdateMiniappProfileSchema.safeParse(json);
    if (!request.success) return invalidPetRequest(request.error, session.user.id);
    const context = getWebServerContext();
    try {
      return profileResponse(await updateMiniappProfile({ prisma: context.prisma, userId: session.user.id, input: request.data }), session.user.id, context);
    } catch (error) {
      if (error instanceof InvalidProfileAvatarError) return petApiError(400, { error: 'invalid_cover_asset' }, session.user.id);
      throw error;
    }
  });
}
