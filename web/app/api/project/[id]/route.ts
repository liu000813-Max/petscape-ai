import { NextResponse } from 'next/server';
import { getProject } from '../../../lib/store/projects';
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
