import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../lib/server-context';
import { listOwnerCheckRuns } from '@petscape/server/application';
import { CheckRunApiErrorSchema, CheckRunListResponseSchema } from '@petscape/server/contracts/check-runs';

export async function GET(req: Request) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json(CheckRunApiErrorSchema.parse({ error: 'unauthorized' }), { status: 401 });
    const checkRuns = await listOwnerCheckRuns({ prisma: getWebServerContext().prisma, ownerUserId: session.user.id });
    const response = NextResponse.json(CheckRunListResponseSchema.parse({ checkRuns }));
    return Object.assign(response, { _loggedUserId: session.user.id });
  });
}
