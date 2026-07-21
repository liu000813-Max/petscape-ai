import { NextResponse } from 'next/server';
import { getWebServerContext, withApiLogging } from '../../../../../lib/server-context';
import { getWebPaymentProvider } from '../../../../../lib/payment-provider';
import { ingestPaymentEvent, PaymentConflictError, PaymentProviderDisabledError, PaymentProviderSignatureError } from '@petscape/server/application';
import { PaymentApiErrorSchema } from '@petscape/server/contracts/payments';

export async function POST(req: Request) {
  return withApiLogging(req, async () => {
    const rawBody = await req.text();
    try {
      const result = await ingestPaymentEvent({
        prisma: getWebServerContext().prisma,
        provider: getWebPaymentProvider(),
        rawBody,
        signature: req.headers.get('x-sandbox-signature'),
      });
      return NextResponse.json({ received: true, duplicate: result.duplicate });
    } catch (error) {
      if (error instanceof PaymentConflictError) return NextResponse.json(PaymentApiErrorSchema.parse({ error: 'conflict', detail: error.message }), { status: 409 });
      if (error instanceof PaymentProviderDisabledError) return NextResponse.json(PaymentApiErrorSchema.parse({ error: 'provider_disabled' }), { status: 409 });
      if (error instanceof PaymentProviderSignatureError) return NextResponse.json(PaymentApiErrorSchema.parse({ error: 'invalid_signature' }), { status: 401 });
      throw error;
    }
  });
}
