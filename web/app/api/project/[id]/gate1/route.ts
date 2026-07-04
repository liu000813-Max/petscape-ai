import { NextResponse } from 'next/server';
import { getProject } from '../../../../lib/store/projects';
import { startGate1 } from '../../../../lib/jobs/gate1Job';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/project/[id]/gate1 → body {sceneId, itemName}
// 门 1：从选中场景卡抠白底物品图 → 提交 3D 生成 → userState=tuning3d。重活后台跑，前端轮询 GET。
// ?mock=1：白底图用占位、3D 用现成 GLB，全链零成本。
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { sceneId?: string; itemName?: string };
  const sceneId = body.sceneId?.trim();
  const itemName = body.itemName?.trim();
  if (!sceneId) return NextResponse.json({ error: '缺少 sceneId' }, { status: 400 });
  if (!itemName) return NextResponse.json({ error: '请填写要做成 3D 的物品名' }, { status: 400 });

  const mock = new URL(request.url).searchParams.get('mock') === '1';
  try {
    startGate1(project, sceneId, itemName, mock);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
  return NextResponse.json({ ok: true, userState: project.userState }, { status: 202 });
}
