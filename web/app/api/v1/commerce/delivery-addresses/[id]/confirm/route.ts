import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../../../lib/server-context';
import {
  DeliveryAddressConflictError,
  DeliveryAddressEligibilityError,
  NotFoundError,
  confirmDeliveryAddress,
} from '@petscape/server/application';
import {
  ConfirmDeliveryAddressSchema,
  DeliveryAddressApiErrorSchema,
  DeliveryAddressIdParamSchema,
  DeliveryAddressResponseSchema,
} from '@petscape/server/contracts/delivery-addresses';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: RouteContext) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json(DeliveryAddressApiErrorSchema.parse({ error: 'unauthorized' }), { status: 401 });
    const params = DeliveryAddressIdParamSchema.safeParse(await context.params);
    let json: unknown;
    try { json = await req.json(); } catch {
      return NextResponse.json(DeliveryAddressApiErrorSchema.parse({ error: 'invalid_json' }), { status: 400 });
    }
    const body = ConfirmDeliveryAddressSchema.safeParse(json);
    if (!params.success || !body.success) {
      return NextResponse.json(DeliveryAddressApiErrorSchema.parse({ error: 'invalid_request' }), { status: 400 });
    }
    try {
      const address = await confirmDeliveryAddress({
        prisma: getWebServerContext().prisma,
        ownerUserId: session.user.id,
        addressId: params.data.id,
        input: body.data,
      });
      const response = NextResponse.json(DeliveryAddressResponseSchema.parse(address));
      return Object.assign(response, { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return NextResponse.json(DeliveryAddressApiErrorSchema.parse({ error: 'not_found' }), { status: 404 });
      }
      if (error instanceof DeliveryAddressEligibilityError || error instanceof DeliveryAddressConflictError) {
        return NextResponse.json(DeliveryAddressApiErrorSchema.parse({ error: 'conflict', detail: error.message }), { status: 409 });
      }
      throw error;
    }
  });
}
