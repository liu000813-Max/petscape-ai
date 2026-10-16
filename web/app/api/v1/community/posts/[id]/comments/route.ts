import { NextResponse } from 'next/server';
import { createCommunityComment, listCommunityComments } from '@petscape/server/application';
import { CommunityCommentListResponseSchema, CreateCommunityCommentSchema, CommentSubmissionResponseSchema } from '@petscape/server/contracts/community-content';
import { getMiniappAwareSession } from '../../../../../../lib/miniapp-auth';
import { getWebServerContext } from '../../../../../../lib/server-context';
import { withContentApi as withApiLogging } from '../../../../../../lib/content-api';

async function postId(context: { params: Promise<{ id: string }> }) { return (await context.params).id; }

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  return withApiLogging(req, async () => {
    const comments = await listCommunityComments({ prisma: getWebServerContext().prisma, postId: await postId(context) });
    return NextResponse.json(CommunityCommentListResponseSchema.parse({ comments }));
  });
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  return withApiLogging(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    let json: unknown;
    try { json = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
    const parsed = CreateCommunityCommentSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: 'invalid_request', detail: parsed.error.issues[0]?.message }, { status: 400 });
    const result = await createCommunityComment({ prisma: getWebServerContext().prisma, ownerUserId: session.user.id, postId: await postId(context), input: parsed.data });
    const response = NextResponse.json(CommentSubmissionResponseSchema.parse(result), { status: 201 });
    return Object.assign(response, { _loggedUserId: session.user.id });
  });
}
