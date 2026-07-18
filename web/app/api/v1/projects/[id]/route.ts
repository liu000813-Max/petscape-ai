// web/app/api/v1/projects/[id]/route.ts —— 单个项目读取（WP-3.2）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.2 验收 1：非 owner 访问 404。
import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../lib/auth';
import { getWebServerContext } from '../../../../lib/server-context';
import { getProject, NotFoundError } from '@petscape/server/application';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getWebAuth().api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const { prisma } = getWebServerContext();
  try {
    const project = await getProject({ prisma, projectId: id, currentUserId: session.user.id });
    return NextResponse.json(project);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    throw error;
  }
}
