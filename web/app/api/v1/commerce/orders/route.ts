import { NextResponse } from 'next/server';
import { getMiniappAwareSession } from '../../../../lib/miniapp-auth';
import { getWebServerContext, withApiLogging } from '../../../../lib/server-context';
import { listOrders } from '@petscape/server/application';
import { OrderApiErrorSchema, OrderListResponseSchema } from '@petscape/server/contracts/orders';

export async function GET(req: Request) {
  return withApiLogging(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) return NextResponse.json(OrderApiErrorSchema.parse({ error: 'unauthorized' }), { status: 401 });
    const orders = await listOrders({ prisma: getWebServerContext().prisma, ownerUserId: session.user.id });
    return Object.assign(NextResponse.json(OrderListResponseSchema.parse({ orders })), { _loggedUserId: session.user.id });
  });
}
