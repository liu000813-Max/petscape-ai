import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../../lib/server-context';
import { getCustomizationRequest, NotFoundError } from '@petscape/server/application';
import {
  CustomizationRequestApiErrorSchema,
  CustomizationRequestIdParamSchema,
  CustomizationRequestResponseSchema,
} from '@petscape/server/contracts/customization-requests';

type RouteContext = { params: Promise<{ id: string }> };

function errorResponse(status: number, error: 'unauthorized' | 'not_found', userId?: string) {
  const response = NextResponse.json(CustomizationRequestApiErrorSchema.parse({ error }), { status });
  return Object.assign(response, userId ? { _loggedUserId: userId } : {});
}

export async function GET(req: Request, routeContext: RouteContext) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return errorResponse(401, 'unauthorized');
    const parsedParams = CustomizationRequestIdParamSchema.safeParse(await routeContext.params);
    if (!parsedParams.success) return errorResponse(404, 'not_found', session.user.id);
    try {
      const request = await getCustomizationRequest({
        prisma: getWebServerContext().prisma,
        ownerUserId: session.user.id,
        requestId: parsedParams.data.id,
      });
      const response = NextResponse.json(CustomizationRequestResponseSchema.parse(request));
      return Object.assign(response, { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) return errorResponse(404, 'not_found', session.user.id);
      throw error;
    }
  });
}
