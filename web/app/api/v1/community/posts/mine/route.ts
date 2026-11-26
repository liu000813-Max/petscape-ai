import { NextResponse } from 'next/server';
import { listMyCommunityPosts } from '@petscape/server/application';
import { MyCommunityPostsQuerySchema, MyCommunityPostsResponseSchema } from '@petscape/server/contracts/community-content';
import { withContentApi } from '../../../../../lib/content-api';
import { getMiniappAwareSession } from '../../../../../lib/miniapp-auth';
import { getWebServerContext } from '../../../../../lib/server-context';

export async function GET(req: Request) {
  const response = await withContentApi(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const query = MyCommunityPostsQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!query.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    const result = await listMyCommunityPosts({
      prisma: getWebServerContext().prisma, ownerUserId: session.user.id, query: query.data,
    });
    return Object.assign(NextResponse.json(MyCommunityPostsResponseSchema.parse({ ...result, draftScope: session.user.id })), { _loggedUserId: session.user.id });
  });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
