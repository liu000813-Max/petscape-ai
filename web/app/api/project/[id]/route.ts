import { NextResponse } from 'next/server';
import { getProject, touch } from '../../../lib/store/projects';
import { recoverProjectFromDisk } from '../../../lib/store/recoverProject';
import { missingRequiredFields } from '../../../lib/types/project';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/project/[id] → 全量状态（含 canvasItems、生成进度、缺哪些必填）
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const project = getProject(id) ?? await recoverProjectFromDisk(id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  return NextResponse.json({ ...project, missing: missingRequiredFields(project.brief) });
}

// PATCH /api/project/[id] → 更新画布视图快照（tldraw snapshot，仅布局）。
// 表单字段走独立的 /brief 路由；此处只收 canvasSnapshot（刷新恢复布局用）。
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { canvasSnapshot?: unknown };
  if ('canvasSnapshot' in body) project.canvasSnapshot = body.canvasSnapshot;
  touch(project);

  return NextResponse.json({ ok: true });
}
