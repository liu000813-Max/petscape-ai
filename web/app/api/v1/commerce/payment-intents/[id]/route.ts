import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../../lib/server-context';
import { getPaymentIntent, NotFoundError } from '@petscape/server/application';
import { PaymentApiErrorSchema, PaymentIntentIdParamSchema, PaymentIntentResponseSchema } from '@petscape/server/contracts/payments';

type RouteContext = { params: Promise<{ id: string }> };
export async function GET(req: Request, context: RouteContext) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json(PaymentApiErrorSchema.parse({ error: 'unauthorized' }), { status: 401 });
    const params = PaymentIntentIdParamSchema.safeParse(await context.params);
    if (!params.success) return NextResponse.json(PaymentApiErrorSchema.parse({ error: 'invalid_request' }), { status: 400 });
    try {
      const value = await getPaymentIntent({ prisma: getWebServerContext().prisma, ownerUserId: session.user.id, paymentIntentId: params.data.id });
      return Object.assign(NextResponse.json(PaymentIntentResponseSchema.parse(value)), { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) return NextResponse.json(PaymentApiErrorSchema.parse({ error: 'not_found' }), { status: 404 });
      throw error;
    }
  });
}
