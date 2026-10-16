import { NextResponse } from 'next/server';
import { listCareReminders, createCareReminder } from '@petscape/server/application';
import { CareReminderListResponseSchema, CareReminderResponseSchema } from '@petscape/server/contracts/community-content';
import { getMiniappAwareSession } from '../../../lib/miniapp-auth';
import { getWebServerContext } from '../../../lib/server-context';
import { withContentApi } from '../../../lib/content-api';

export async function GET(req: Request) {
  return withContentApi(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const reminders = await listCareReminders({ prisma: getWebServerContext().prisma, ownerUserId: session.user.id, query: Object.fromEntries(new URL(req.url).searchParams) });
    return Object.assign(NextResponse.json(CareReminderListResponseSchema.parse({ reminders })), { _loggedUserId: session.user.id });
  });
}

export async function POST(req: Request) {
  return withContentApi(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const result = await createCareReminder({ prisma: getWebServerContext().prisma, ownerUserId: session.user.id, input: await req.json() });
    return Object.assign(NextResponse.json(CareReminderResponseSchema.parse(result), { status: 201 }), { _loggedUserId: session.user.id });
  });
}
