import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../lib/server-context';
import {
  createSandboxEstimateJob,
  NotFoundError,
} from '@petscape/server/application';
import {
  CommerceEstimateApiErrorSchema,
  CreateSandboxEstimateRequestSchema,
  CreateSandboxEstimateResponseSchema,
} from '@petscape/server/contracts/commerce-estimates';

function errorResponse(
  status: number,
  payload: { error: 'unauthorized' | 'invalid_json' | 'invalid_request' | 'not_found'; detail?: string },
  userId?: string,
) {
  const response = NextResponse.json(CommerceEstimateApiErrorSchema.parse(payload), { status });
  return Object.assign(response, userId ? { _loggedUserId: userId } : {});
}

export async function POST(req: Request) {
  return withApiLogging(req, async ({ requestId }) => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return errorResponse(401, { error: 'unauthorized' });

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return errorResponse(400, { error: 'invalid_json' }, session.user.id);
    }
    const request = CreateSandboxEstimateRequestSchema.safeParse(json);
    if (!request.success) {
      return errorResponse(
        400,
        { error: 'invalid_request', detail: request.error.issues[0]?.message },
        session.user.id,
      );
    }

    try {
      const result = await createSandboxEstimateJob({
        prisma: getWebServerContext().prisma,
        ownerUserId: session.user.id,
        sceneConfirmationId: request.data.sceneConfirmationId,
        requestId,
      });
      const response = NextResponse.json(CreateSandboxEstimateResponseSchema.parse(result), {
        status: result.created ? 201 : 200,
      });
      return Object.assign(response, { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return errorResponse(404, { error: 'not_found' }, session.user.id);
      }
      throw error;
    }
  });
}
