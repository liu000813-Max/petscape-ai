import { NextResponse } from 'next/server';
import { getQueuePosition } from '../../../lib/jobs/executor';
import { getSession } from '../../../lib/store/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  const pendingJob = session.pendingJob
    ? { ...session.pendingJob, queuePosition: getQueuePosition(id) }
    : undefined;
  const readyToRender = Boolean(session.brief.species && session.brief.petSize && session.brief.style && session.brief.item);
  return NextResponse.json({
    id: session.id,
    stage: session.stage,
    messages: session.messages,
    brief: session.brief,
    constraints: session.constraints,
    renderRounds: session.renderRounds,
    sceneImages: session.sceneImages,
    cleanItemImage: session.cleanItemImage,
    selection: session.selection,
    meshy: session.meshy,
    slice: session.slice,
    pendingJob,
    readyToRender,
  });
}
