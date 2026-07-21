import { NextResponse } from 'next/server';
import { getOrCreateProject } from '../../../../lib/store/projects';
import { startAvatar } from '../../../../lib/jobs/avatarJob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/project/[id]/avatar → body { species?, wearableIds?, petSize? }
// 批次1：照片 → 风格化立绘 → 3D 引擎（Meshy 默认 / Tripo 备切）→ 自动切片。
// 重活后台跑，前端轮询 GET /api/project/[id] 看 avatar.stage / avatarSlice.status。
// ?mock=1：全链走预置资产，零成本。
//
// WP-G1：id 现在是 v1 Project.id，本路由的内存态是「未迁段状态缓存」，惰性建镜像。
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const project = getOrCreateProject(id);

  const body = (await request.json().catch(() => ({}))) as {
    species?: string;
    wearableIds?: string[];
    petSize?: number;
  };
  const mock = new URL(request.url).searchParams.get('mock') === '1';

  try {
    startAvatar(project, { species: body.species, wearableIds: body.wearableIds, petSize: body.petSize }, mock);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
  return NextResponse.json({ ok: true, avatar: project.avatar }, { status: 202 });
}
