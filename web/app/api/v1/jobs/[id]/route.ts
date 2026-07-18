// web/app/api/v1/jobs/[id]/route.ts —— 任务状态查询（WP-3.4）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.4。owner 校验 → 状态 + resultRef。
import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../lib/server-context';
import { getJob, NotFoundError } from '@petscape/server/application';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const { id: jobId } = await params;
    const { prisma } = getWebServerContext();
    try {
      const job = await getJob({ prisma, jobId, currentUserId: session.user.id });
      const res = NextResponse.json(job);
      return Object.assign(res, { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) {
        const res = NextResponse.json({ error: 'not_found' }, { status: 404 });
        return Object.assign(res, { _loggedUserId: session.user.id });
      }
      throw error;
    }
  });
}
