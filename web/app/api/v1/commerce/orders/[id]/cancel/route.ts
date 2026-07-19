import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../../../lib/server-context';
import { getWebPaymentProvider } from '../../../../../../lib/payment-provider';
import { cancelOrder, NotFoundError, OrderConflictError } from '@petscape/server/application';
import { CancelOrderSchema, OrderApiErrorSchema, OrderIdParamSchema, OrderResponseSchema } from '@petscape/server/contracts/orders';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: RouteContext) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json(OrderApiErrorSchema.parse({ error: 'unauthorized' }), { status: 401 });
    const params = OrderIdParamSchema.safeParse(await context.params);
    let json: unknown;
    try { json = await req.json(); } catch { return NextResponse.json(OrderApiErrorSchema.parse({ error: 'invalid_json' }), { status: 400 }); }
    const body = CancelOrderSchema.safeParse(json);
    if (!params.success || !body.success) return NextResponse.json(OrderApiErrorSchema.parse({ error: 'invalid_request' }), { status: 400 });
    try {
      const order = await cancelOrder({
        prisma: getWebServerContext().prisma, provider: getWebPaymentProvider(),
        ownerUserId: session.user.id, orderId: params.data.id, input: body.data,
      });
      return Object.assign(NextResponse.json(OrderResponseSchema.parse(order)), { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) return NextResponse.json(OrderApiErrorSchema.parse({ error: 'not_found' }), { status: 404 });
      if (error instanceof OrderConflictError) return NextResponse.json(OrderApiErrorSchema.parse({ error: 'conflict', detail: error.message }), { status: 409 });
      throw error;
    }
  });
}
