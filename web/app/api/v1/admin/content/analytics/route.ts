import { NextResponse } from 'next/server';
import { getContentAnalytics } from '@petscape/server/application';
import { AnalyticsSummaryResponseSchema } from '@petscape/server/contracts/community-content';
import { getWebAuth } from '../../../../../lib/auth';
import { getWebServerContext } from '../../../../../lib/server-context';
import { withContentApi } from '../../../../../lib/content-api';

export async function GET(req: Request) {
  return withContentApi(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const result = await getContentAnalytics({ prisma: getWebServerContext().prisma, actorUserId: session.user.id });
    return NextResponse.json(AnalyticsSummaryResponseSchema.parse(result));
  });
}
