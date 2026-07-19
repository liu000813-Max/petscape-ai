import { NextResponse } from 'next/server';
import { getSceneConfirmation, NotFoundError } from '@petscape/server/application';
import { SceneApiErrorSchema, SceneConfirmationResponseSchema } from '@petscape/server/contracts/scenes';
import { getWebAuth } from '../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../lib/server-context';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json(SceneApiErrorSchema.parse({ error: 'unauthorized' }), { status: 401 });
    try {
      const result = await getSceneConfirmation({ prisma: getWebServerContext().prisma, ownerUserId: session.user.id, sceneConfirmationId: (await params).id });
      return Object.assign(NextResponse.json(SceneConfirmationResponseSchema.parse(result)), { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) return Object.assign(NextResponse.json(SceneApiErrorSchema.parse({ error: 'not_found' }), { status: 404 }), { _loggedUserId: session.user.id });
      throw error;
    }
  });
}
