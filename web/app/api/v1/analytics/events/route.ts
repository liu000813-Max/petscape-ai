import { NextResponse } from 'next/server';
import { recordAnalyticsEvent } from '@petscape/server/application';
import { AnalyticsEventResponseSchema, AnalyticsEventSchema } from '@petscape/server/contracts/community-content';
import { getMiniappAwareSession } from '../../../../lib/miniapp-auth';
import { getWebServerContext } from '../../../../lib/server-context';
import { withContentApi as withApiLogging } from '../../../../lib/content-api';

export async function POST(req: Request) {
  return withApiLogging(req, async () => {
    let json: unknown;
    try { json = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
    const parsed = AnalyticsEventSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    const session = await getMiniappAwareSession(req);
    const result = await recordAnalyticsEvent({ prisma: getWebServerContext().prisma, userId: session?.user.id, input: parsed.data });
    return NextResponse.json(AnalyticsEventResponseSchema.parse(result), { status: 202 });
  });
}
