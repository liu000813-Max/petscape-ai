import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../lib/server-context';
import {
  DeliveryAddressConflictError,
  DeliveryAddressEligibilityError,
  NotFoundError,
  listDeliveryAddresses,
  saveDeliveryAddress,
} from '@petscape/server/application';
import {
  DeliveryAddressApiErrorSchema,
  DeliveryAddressListResponseSchema,
  DeliveryAddressResponseSchema,
  SaveDeliveryAddressSchema,
} from '@petscape/server/contracts/delivery-addresses';

function errorResponse(status: number, payload: Parameters<typeof DeliveryAddressApiErrorSchema.parse>[0], userId?: string) {
  const response = NextResponse.json(DeliveryAddressApiErrorSchema.parse(payload), { status });
  return Object.assign(response, userId ? { _loggedUserId: userId } : {});
}

export async function GET(req: Request) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return errorResponse(401, { error: 'unauthorized' });
    const deliveryAddresses = await listDeliveryAddresses({
      prisma: getWebServerContext().prisma,
      ownerUserId: session.user.id,
    });
    const response = NextResponse.json(DeliveryAddressListResponseSchema.parse({ deliveryAddresses }));
    return Object.assign(response, { _loggedUserId: session.user.id });
  });
}

export async function POST(req: Request) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return errorResponse(401, { error: 'unauthorized' });
    let json: unknown;
    try { json = await req.json(); } catch { return errorResponse(400, { error: 'invalid_json' }, session.user.id); }
    const parsed = SaveDeliveryAddressSchema.safeParse(json);
    if (!parsed.success) return errorResponse(400, {
      error: 'invalid_request',
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map((part) => typeof part === 'symbol' ? part.description ?? '' : part),
        message: issue.message,
      })),
    }, session.user.id);
    try {
      const result = await saveDeliveryAddress({
        prisma: getWebServerContext().prisma,
        ownerUserId: session.user.id,
        input: parsed.data,
      });
      const response = NextResponse.json(DeliveryAddressResponseSchema.parse(result.deliveryAddress), {
        status: result.created ? 201 : 200,
      });
      return Object.assign(response, { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) return errorResponse(404, { error: 'not_found' }, session.user.id);
      if (error instanceof DeliveryAddressEligibilityError || error instanceof DeliveryAddressConflictError) {
        return errorResponse(409, { error: 'conflict', detail: error.message }, session.user.id);
      }
      throw error;
    }
  });
}
