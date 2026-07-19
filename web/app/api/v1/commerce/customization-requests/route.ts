import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../lib/server-context';
import {
  createCustomizationRequest,
  CustomizationRequestConflictError,
  listCustomizationRequests,
  NotFoundError,
} from '@petscape/server/application';
import {
  CreateCustomizationRequestSchema,
  CustomizationRequestApiErrorSchema,
  CustomizationRequestListResponseSchema,
  CustomizationRequestResponseSchema,
} from '@petscape/server/contracts/customization-requests';

type ApiError = 'unauthorized' | 'invalid_json' | 'invalid_request' | 'not_found' | 'conflict';

function errorResponse(
  status: number,
  payload: { error: ApiError; detail?: string; issues?: { path: (string | number)[]; message: string }[] },
  userId?: string,
) {
  const response = NextResponse.json(CustomizationRequestApiErrorSchema.parse(payload), { status });
  return Object.assign(response, userId ? { _loggedUserId: userId } : {});
}

export async function GET(req: Request) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return errorResponse(401, { error: 'unauthorized' });
    const requests = await listCustomizationRequests({
      prisma: getWebServerContext().prisma,
      ownerUserId: session.user.id,
    });
    const response = NextResponse.json(CustomizationRequestListResponseSchema.parse({ requests }));
    return Object.assign(response, { _loggedUserId: session.user.id });
  });
}

export async function POST(req: Request) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return errorResponse(401, { error: 'unauthorized' });

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return errorResponse(400, { error: 'invalid_json' }, session.user.id);
    }
    const parsed = CreateCustomizationRequestSchema.safeParse(json);
    if (!parsed.success) {
      return errorResponse(
        400,
        {
          error: 'invalid_request',
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.map((part) => (typeof part === 'symbol' ? part.description ?? '' : part)),
            message: issue.message,
          })),
        },
        session.user.id,
      );
    }

    try {
      const result = await createCustomizationRequest({
        prisma: getWebServerContext().prisma,
        ownerUserId: session.user.id,
        input: parsed.data,
      });
      const response = NextResponse.json(CustomizationRequestResponseSchema.parse(result.request), {
        status: result.created ? 201 : 200,
      });
      return Object.assign(response, { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return errorResponse(404, { error: 'not_found' }, session.user.id);
      }
      if (error instanceof CustomizationRequestConflictError) {
        return errorResponse(409, { error: 'conflict', detail: error.message }, session.user.id);
      }
      throw error;
    }
  });
}
