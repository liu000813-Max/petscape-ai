import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../../../lib/server-context';
import { acceptQuote, NotFoundError, QuoteConflictError } from '@petscape/server/application';
import { QuoteApiErrorSchema, QuoteIdParamSchema, QuoteResponseSchema, QuoteTransitionSchema } from '@petscape/server/contracts/quotes';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: RouteContext) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json(QuoteApiErrorSchema.parse({ error: 'unauthorized' }), { status: 401 });
    const params = QuoteIdParamSchema.safeParse(await context.params);
    let json: unknown;
    try { json = await req.json(); } catch { return NextResponse.json(QuoteApiErrorSchema.parse({ error: 'invalid_json' }), { status: 400 }); }
    const body = QuoteTransitionSchema.safeParse(json);
    if (!params.success || !body.success) return NextResponse.json(QuoteApiErrorSchema.parse({ error: 'invalid_request' }), { status: 400 });
    try {
      const quote = await acceptQuote({ prisma: getWebServerContext().prisma, ownerUserId: session.user.id, quoteId: params.data.id, input: body.data });
      const response = NextResponse.json(QuoteResponseSchema.parse(quote));
      return Object.assign(response, { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) return NextResponse.json(QuoteApiErrorSchema.parse({ error: 'not_found' }), { status: 404 });
      if (error instanceof QuoteConflictError) return NextResponse.json(QuoteApiErrorSchema.parse({ error: 'conflict', detail: error.message }), { status: 409 });
      throw error;
    }
  });
}
