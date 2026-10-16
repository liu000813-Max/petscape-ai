import { NextResponse } from 'next/server';
import { getCommunityPost } from '@petscape/server/application';
import { CommunityPostDetailResponseSchema } from '@petscape/server/contracts/community-content';
import { getWebServerContext } from '../../../../../lib/server-context';
import { withContentApi } from '../../../../../lib/content-api';

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  return withContentApi(req, async () => {
    const post = await getCommunityPost({ prisma: getWebServerContext().prisma, postId: (await context.params).id });
    return NextResponse.json(CommunityPostDetailResponseSchema.parse(post));
  });
}
