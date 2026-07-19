import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../../lib/server-context';
import { getSandboxEstimate, NotFoundError } from '@petscape/server/application';
import {
  CommerceEstimateApiErrorSchema,
  SandboxEstimateResponseSchema,
} from '@petscape/server/contracts/commerce-estimates';

type RouteContext = { params: Promise<{ id: string }> };

function errorResponse(status: number, error: 'unauthorized' | 'not_found', userId?: string) {
  const response = NextResponse.json(CommerceEstimateApiErrorSchema.parse({ error }), { status });
  return Object.assign(response, userId ? { _loggedUserId: userId } : {});
}

export async function GET(req: Request, routeContext: RouteContext) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return errorResponse(401, 'unauthorized');
    const { id } = await routeContext.params;

    try {
      const result = await getSandboxEstimate({
        prisma: getWebServerContext().prisma,
        ownerUserId: session.user.id,
        estimateJobId: id,
      });
      const response = NextResponse.json(SandboxEstimateResponseSchema.parse(result));
      return Object.assign(response, { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) return errorResponse(404, 'not_found', session.user.id);
      throw error;
    }
  });
}
