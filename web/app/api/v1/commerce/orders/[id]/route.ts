import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../../lib/server-context';
import { getOrder, NotFoundError } from '@petscape/server/application';
import { OrderApiErrorSchema, OrderIdParamSchema, OrderResponseSchema } from '@petscape/server/contracts/orders';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: RouteContext) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json(OrderApiErrorSchema.parse({ error: 'unauthorized' }), { status: 401 });
    const params = OrderIdParamSchema.safeParse(await context.params);
    if (!params.success) return NextResponse.json(OrderApiErrorSchema.parse({ error: 'invalid_request' }), { status: 400 });
    try {
      const order = await getOrder({ prisma: getWebServerContext().prisma, ownerUserId: session.user.id, orderId: params.data.id });
      return Object.assign(NextResponse.json(OrderResponseSchema.parse(order)), { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) return NextResponse.json(OrderApiErrorSchema.parse({ error: 'not_found' }), { status: 404 });
      throw error;
    }
  });
}
