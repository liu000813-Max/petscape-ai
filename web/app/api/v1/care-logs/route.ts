import { NextResponse } from 'next/server';
import { createCareLog, listCareLogs } from '@petscape/server/application';
import { CareLogListResponseSchema, CareLogResponseSchema, CreateCareLogSchema } from '@petscape/server/contracts/community-content';
import { getMiniappAwareSession } from '../../../lib/miniapp-auth';
import { getWebServerContext } from '../../../lib/server-context';
import { withContentApi as withApiLogging } from '../../../lib/content-api';

export async function GET(req: Request) {
  return withApiLogging(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const url = new URL(req.url);
    const logs = await listCareLogs({ prisma: getWebServerContext().prisma, ownerUserId: session.user.id, query: Object.fromEntries(url.searchParams.entries()) });
    const response = NextResponse.json(CareLogListResponseSchema.parse({ logs }));
    return Object.assign(response, { _loggedUserId: session.user.id });
  });
}

export async function POST(req: Request) {
  return withApiLogging(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    let json: unknown;
    try { json = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
    const parsed = CreateCareLogSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: 'invalid_request', detail: parsed.error.issues[0]?.message }, { status: 400 });
    const result = await createCareLog({ prisma: getWebServerContext().prisma, ownerUserId: session.user.id, input: parsed.data });
    const response = NextResponse.json(CareLogResponseSchema.parse(result), { status: 201 });
    return Object.assign(response, { _loggedUserId: session.user.id });
  });
}
