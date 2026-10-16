import { NextResponse } from 'next/server';
import { completeCareReminder } from '@petscape/server/application';
import { CareReminderResponseSchema, CompleteCareReminderSchema } from '@petscape/server/contracts/community-content';
import { getMiniappAwareSession } from '../../../../lib/miniapp-auth';
import { getWebServerContext } from '../../../../lib/server-context';
import { withContentApi } from '../../../../lib/content-api';

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  return withContentApi(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    CompleteCareReminderSchema.parse(await req.json());
    const result = await completeCareReminder({ prisma: getWebServerContext().prisma, ownerUserId: session.user.id, reminderId: (await context.params).id });
    return Object.assign(NextResponse.json(CareReminderResponseSchema.parse(result)), { _loggedUserId: session.user.id });
  });
}
