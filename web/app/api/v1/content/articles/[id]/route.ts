import { NextResponse } from 'next/server';
import { getContentArticle } from '@petscape/server/application';
import { ContentArticleResponseSchema } from '@petscape/server/contracts/community-content';
import { getWebServerContext } from '../../../../../lib/server-context';
import { withContentApi } from '../../../../../lib/content-api';

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  return withContentApi(req, async () => {
    const article = await getContentArticle({ prisma: getWebServerContext().prisma, articleId: (await context.params).id });
    return NextResponse.json(ContentArticleResponseSchema.parse(article));
  });
}
