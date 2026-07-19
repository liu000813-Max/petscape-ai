import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../lib/server-context';
import { AdminRequiredError, CheckRunConflictError, createCheckRun, listAdminReviewCandidates, NotFoundError } from '@petscape/server/application';
import { AdminReviewCandidateListSchema, CheckRunApiErrorSchema, CheckRunResponseSchema, CreateCheckRunSchema } from '@petscape/server/contracts/check-runs';

function error(status: number, code: 'unauthorized' | 'forbidden' | 'invalid_json' | 'invalid_request' | 'not_found' | 'conflict', detail?: string, userId?: string) {
  const response = NextResponse.json(CheckRunApiErrorSchema.parse({ error: code, ...(detail ? { detail } : {}) }), { status });
  return Object.assign(response, userId ? { _loggedUserId: userId } : {});
}

export async function GET(req: Request) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return error(401, 'unauthorized');
    try {
      const candidates = await listAdminReviewCandidates({ prisma: getWebServerContext().prisma, actorUserId: session.user.id });
      const response = NextResponse.json(AdminReviewCandidateListSchema.parse({ candidates }));
      return Object.assign(response, { _loggedUserId: session.user.id });
    } catch (caught) {
      if (caught instanceof AdminRequiredError) return error(403, 'forbidden', undefined, session.user.id);
      throw caught;
    }
  });
}

export async function POST(req: Request) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return error(401, 'unauthorized');
    let json: unknown;
    try { json = await req.json(); } catch { return error(400, 'invalid_json', undefined, session.user.id); }
    const parsed = CreateCheckRunSchema.safeParse(json);
    if (!parsed.success) return error(400, 'invalid_request', parsed.error.issues[0]?.message, session.user.id);
    try {
      const result = await createCheckRun({ prisma: getWebServerContext().prisma, actorUserId: session.user.id, input: parsed.data });
      const response = NextResponse.json(CheckRunResponseSchema.parse(result.checkRun), { status: result.created ? 201 : 200 });
      return Object.assign(response, { _loggedUserId: session.user.id });
    } catch (caught) {
      if (caught instanceof AdminRequiredError) return error(403, 'forbidden', undefined, session.user.id);
      if (caught instanceof NotFoundError) return error(404, 'not_found', undefined, session.user.id);
      if (caught instanceof CheckRunConflictError) return error(409, 'conflict', caught.message, session.user.id);
      throw caught;
    }
  });
}
