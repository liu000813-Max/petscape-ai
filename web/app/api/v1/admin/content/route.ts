import { NextResponse } from 'next/server';
import { listAdminContent, saveAdminContent } from '@petscape/server/application';
import { AdminContentListResponseSchema, SavedContentResponseSchema } from '@petscape/server/contracts/community-content';
import { getWebAuth } from '../../../../lib/auth';
import { getWebServerContext } from '../../../../lib/server-context';
import { withContentApi } from '../../../../lib/content-api';

export async function GET(req: Request) {
  return withContentApi(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const items = await listAdminContent({ prisma: getWebServerContext().prisma, actorUserId: session.user.id, query: Object.fromEntries(new URL(req.url).searchParams) });
    return Object.assign(NextResponse.json(AdminContentListResponseSchema.parse({ items })), { _loggedUserId: session.user.id });
  });
}

export async function POST(req: Request) {
  return withContentApi(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const result = await saveAdminContent({ prisma: getWebServerContext().prisma, actorUserId: session.user.id, input: await req.json() });
    return Object.assign(NextResponse.json(SavedContentResponseSchema.parse(result), { status: 201 }), { _loggedUserId: session.user.id });
  });
}
