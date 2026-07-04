import { NextResponse } from 'next/server';
import { getProject } from '../../../../lib/store/projects';
import { startAvatarSlice, sizeToScaleMm } from '../../../../lib/jobs/avatarJob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/project/[id]/avatar-slice → body { petSize?: 1-5 } 或 { scaleMm?: number }
// 换体型档重切：前端 1s 防抖调用；同 mm 已有产物直接返回（job 内幂等）。
// avatar done 后 avatarJob 会自动触发一次首切；本路由供用户换档后手动重切。
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (!project.avatar?.modelUrl) {
    return NextResponse.json({ error: 'avatar 模型未就绪，无法切片' }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { petSize?: number; scaleMm?: number };
  const scaleMm = typeof body.scaleMm === 'number' ? Math.round(body.scaleMm) : sizeToScaleMm(body.petSize);
  const mock = new URL(request.url).searchParams.get('mock') === '1';

  try {
    startAvatarSlice(project, scaleMm, mock);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
  return NextResponse.json({ ok: true, scaleMm, avatarSlice: project.avatarSlice }, { status: 202 });
}
