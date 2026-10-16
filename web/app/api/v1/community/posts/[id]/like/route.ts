import { NextResponse } from 'next/server';
import { toggleCommunityPostLike, NotFoundError } from '@petscape/server/application';
import { CommunityPostLikeResponseSchema, SetCommunityPostLikeSchema } from '@petscape/server/contracts/community-content';
import { getMiniappAwareSession } from '../../../../../../lib/miniapp-auth';
import { getWebServerContext } from '../../../../../../lib/server-context';
import { withContentApi as withApiLogging } from '../../../../../../lib/content-api';

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  return withApiLogging(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const { id } = await context.params;
    let json: unknown;
    try { json = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
    const parsed = SetCommunityPostLikeSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    try {
      const result = await toggleCommunityPostLike({ prisma: getWebServerContext().prisma, ownerUserId: session.user.id, postId: id, liked: parsed.data.liked });
      const response = NextResponse.json(CommunityPostLikeResponseSchema.parse(result));
      return Object.assign(response, { _loggedUserId: session.user.id });
    } catch (caught) {
      if (caught instanceof NotFoundError) return NextResponse.json({ error: 'not_found' }, { status: 404 });
      throw caught;
    }
  });
}
