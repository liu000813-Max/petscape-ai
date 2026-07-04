import { NextResponse } from 'next/server';
import { getProject } from '../../../../lib/store/projects';
import { defaultModelConfig, type ModelConfig } from '../../../../lib/types/project';
import { startGate2 } from '../../../../lib/jobs/gate2Job';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/project/[id]/gate2 → body {scaleMm, color, material}
// 门 2：normalize 到 scaleMm → PrusaSlicer 切片 → STL + G-code。重活后台跑，前端轮询 GET。
// ?mock=1：用现成 STL/G-code 当产物。
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (project.model3d?.status !== 'ready') {
    return NextResponse.json({ error: '3D 模型尚未就绪，无法进入门 2' }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as Partial<ModelConfig>;
  const base = project.modelConfig ?? defaultModelConfig();
  const scaleMm = typeof body.scaleMm === 'number' ? Math.max(80, Math.min(160, body.scaleMm)) : base.scaleMm;
  const config: ModelConfig = {
    scaleMm,
    color: typeof body.color === 'string' ? body.color : base.color,
    material: typeof body.material === 'string' ? body.material : base.material,
  };

  const mock = new URL(request.url).searchParams.get('mock') === '1';
  try {
    startGate2(project, config, mock);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
  return NextResponse.json({ ok: true, modelConfig: config }, { status: 202 });
}
