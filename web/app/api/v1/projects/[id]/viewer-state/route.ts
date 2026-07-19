import { NextResponse } from 'next/server';
import { getViewerState, NotFoundError } from '@petscape/server/application';
import { SceneApiErrorSchema, ViewerStateResponseSchema } from '@petscape/server/contracts/scenes';
import { getWebAuth } from '../../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../../lib/server-context';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json(SceneApiErrorSchema.parse({ error: 'unauthorized' }), { status: 401 });
    try {
      const state = await getViewerState({ prisma: getWebServerContext().prisma, ownerUserId: session.user.id, projectId: (await params).id });
      return Object.assign(NextResponse.json(ViewerStateResponseSchema.parse(state)), { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) return Object.assign(NextResponse.json(SceneApiErrorSchema.parse({ error: 'not_found' }), { status: 404 }), { _loggedUserId: session.user.id });
      throw error;
    }
  });
}
