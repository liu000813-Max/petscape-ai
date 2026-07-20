import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../lib/server-context';
import { AdminRequiredError, listAdminPaymentAttention } from '@petscape/server/application';
import { AdminPaymentAttentionListResponseSchema, PaymentApiErrorSchema } from '@petscape/server/contracts/payments';

export async function GET(req: Request) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json(PaymentApiErrorSchema.parse({ error: 'unauthorized' }), { status: 401 });
    try {
      const items = await listAdminPaymentAttention({
        prisma: getWebServerContext().prisma,
        actorUserId: session.user.id,
      });
      const response = NextResponse.json(AdminPaymentAttentionListResponseSchema.parse({ items }));
      return Object.assign(response, { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof AdminRequiredError) {
        return Object.assign(
          NextResponse.json(PaymentApiErrorSchema.parse({ error: 'forbidden' }), { status: 403 }),
          { _loggedUserId: session.user.id },
        );
      }
      throw error;
    }
  });
}
