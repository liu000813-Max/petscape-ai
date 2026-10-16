import { NextResponse } from 'next/server';
import { listContentArticles } from '@petscape/server/application';
import { ContentArticleListResponseSchema } from '@petscape/server/contracts/community-content';
import { getWebServerContext } from '../../../../lib/server-context';
import { withContentApi as withApiLogging } from '../../../../lib/content-api';

export async function GET(req: Request) {
  return withApiLogging(req, async () => {
    const url = new URL(req.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const articles = await listContentArticles({ prisma: getWebServerContext().prisma, query });
    return NextResponse.json(ContentArticleListResponseSchema.parse({ articles }));
  });
}
