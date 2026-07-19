import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../../../lib/server-context';
import { AdminRequiredError, CheckRunConflictError, startCheckRun } from '@petscape/server/application';
import { CheckRunApiErrorSchema, CheckRunIdParamSchema, CheckRunResponseSchema } from '@petscape/server/contracts/check-runs';

type Context = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: Context) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json(CheckRunApiErrorSchema.parse({ error: 'unauthorized' }), { status: 401 });
    const params = CheckRunIdParamSchema.safeParse(await context.params);
    if (!params.success) return NextResponse.json(CheckRunApiErrorSchema.parse({ error: 'not_found' }), { status: 404 });
    try {
      const checkRun = await startCheckRun({ prisma: getWebServerContext().prisma, actorUserId: session.user.id, checkRunId: params.data.id });
      const response = NextResponse.json(CheckRunResponseSchema.parse(checkRun));
      return Object.assign(response, { _loggedUserId: session.user.id });
    } catch (caught) {
      if (caught instanceof AdminRequiredError) return NextResponse.json(CheckRunApiErrorSchema.parse({ error: 'forbidden' }), { status: 403 });
      if (caught instanceof CheckRunConflictError) return NextResponse.json(CheckRunApiErrorSchema.parse({ error: 'conflict', detail: caught.message }), { status: 409 });
      throw caught;
    }
  });
}
