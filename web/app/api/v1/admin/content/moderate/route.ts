import { NextResponse } from 'next/server';
import { AdminRequiredError, moderateContent, NotFoundError } from '@petscape/server/application';
import { ModerateContentResponseSchema, ModerateContentSchema } from '@petscape/server/contracts/community-content';
import { getWebAuth } from '../../../../../lib/auth';
import { getWebServerContext } from '../../../../../lib/server-context';
import { withContentApi as withApiLogging } from '../../../../../lib/content-api';

export async function POST(req: Request) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    let json: unknown;
    try { json = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
    const parsed = ModerateContentSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: 'invalid_request', detail: parsed.error.issues[0]?.message }, { status: 400 });
    try {
      const result = await moderateContent({ prisma: getWebServerContext().prisma, actorUserId: session.user.id, input: parsed.data });
      const response = NextResponse.json(ModerateContentResponseSchema.parse(result));
      return Object.assign(response, { _loggedUserId: session.user.id });
    } catch (caught) {
      if (caught instanceof AdminRequiredError) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      if (caught instanceof NotFoundError) return NextResponse.json({ error: 'not_found' }, { status: 404 });
      throw caught;
    }
  });
}
