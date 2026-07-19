import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../../../lib/server-context';
import { getWebPaymentProvider } from '../../../../../../lib/payment-provider';
import { NotFoundError, PaymentConflictError, PaymentProviderDisabledError, retryPaymentIntent } from '@petscape/server/application';
import { PaymentApiErrorSchema, PaymentIntentIdParamSchema, PaymentIntentResponseSchema, RetryPaymentIntentSchema } from '@petscape/server/contracts/payments';
type RouteContext = { params: Promise<{ id: string }> };
export async function POST(req: Request, context: RouteContext) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json(PaymentApiErrorSchema.parse({ error: 'unauthorized' }), { status: 401 });
    const params = PaymentIntentIdParamSchema.safeParse(await context.params);
    let json: unknown; try { json = await req.json(); } catch { return NextResponse.json(PaymentApiErrorSchema.parse({ error: 'invalid_json' }), { status: 400 }); }
    const body = RetryPaymentIntentSchema.safeParse(json);
    if (!params.success || !body.success) return NextResponse.json(PaymentApiErrorSchema.parse({ error: 'invalid_request' }), { status: 400 });
    try {
      const value = await retryPaymentIntent({ prisma: getWebServerContext().prisma, provider: getWebPaymentProvider(), ownerUserId: session.user.id, paymentIntentId: params.data.id, input: body.data });
      return Object.assign(NextResponse.json(PaymentIntentResponseSchema.parse(value)), { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof PaymentProviderDisabledError) return NextResponse.json(PaymentApiErrorSchema.parse({ error: 'provider_disabled', detail: error.message }), { status: 409 });
      if (error instanceof NotFoundError) return NextResponse.json(PaymentApiErrorSchema.parse({ error: 'not_found' }), { status: 404 });
      if (error instanceof PaymentConflictError) return NextResponse.json(PaymentApiErrorSchema.parse({ error: 'conflict', detail: error.message }), { status: 409 });
      throw error;
    }
  });
}
