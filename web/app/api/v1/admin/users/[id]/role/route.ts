import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../../../lib/server-context';
import { AdminRequiredError, CheckRunConflictError, changeUserRole, NotFoundError } from '@petscape/server/application';
import { ChangeUserRoleSchema, CheckRunApiErrorSchema, CheckRunIdParamSchema, UserRoleResponseSchema } from '@petscape/server/contracts/check-runs';

type Context = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: Context) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json(CheckRunApiErrorSchema.parse({ error: 'unauthorized' }), { status: 401 });
    const params = CheckRunIdParamSchema.safeParse(await context.params);
    if (!params.success) return NextResponse.json(CheckRunApiErrorSchema.parse({ error: 'not_found' }), { status: 404 });
    let json: unknown;
    try { json = await req.json(); } catch { return NextResponse.json(CheckRunApiErrorSchema.parse({ error: 'invalid_json' }), { status: 400 }); }
    const parsed = ChangeUserRoleSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json(CheckRunApiErrorSchema.parse({ error: 'invalid_request', detail: parsed.error.issues[0]?.message }), { status: 400 });
    try {
      const changed = await changeUserRole({ prisma: getWebServerContext().prisma, actorUserId: session.user.id, targetUserId: params.data.id, input: parsed.data });
      const response = NextResponse.json(UserRoleResponseSchema.parse(changed));
      return Object.assign(response, { _loggedUserId: session.user.id });
    } catch (caught) {
      if (caught instanceof AdminRequiredError) return NextResponse.json(CheckRunApiErrorSchema.parse({ error: 'forbidden' }), { status: 403 });
      if (caught instanceof NotFoundError) return NextResponse.json(CheckRunApiErrorSchema.parse({ error: 'not_found' }), { status: 404 });
      if (caught instanceof CheckRunConflictError) return NextResponse.json(CheckRunApiErrorSchema.parse({ error: 'conflict', detail: caught.message }), { status: 409 });
      throw caught;
    }
  });
}
