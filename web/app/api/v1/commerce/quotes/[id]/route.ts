import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../../lib/server-context';
import { getQuote, NotFoundError } from '@petscape/server/application';
import { QuoteApiErrorSchema, QuoteIdParamSchema, QuoteResponseSchema } from '@petscape/server/contracts/quotes';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: RouteContext) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json(QuoteApiErrorSchema.parse({ error: 'unauthorized' }), { status: 401 });
    const params = QuoteIdParamSchema.safeParse(await context.params);
    if (!params.success) return NextResponse.json(QuoteApiErrorSchema.parse({ error: 'not_found' }), { status: 404 });
    try {
      const quote = await getQuote({ prisma: getWebServerContext().prisma, ownerUserId: session.user.id, quoteId: params.data.id });
      const response = NextResponse.json(QuoteResponseSchema.parse(quote));
      return Object.assign(response, { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) return NextResponse.json(QuoteApiErrorSchema.parse({ error: 'not_found' }), { status: 404 });
      throw error;
    }
  });
}
