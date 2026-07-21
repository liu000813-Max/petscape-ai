import { NextResponse } from 'next/server';
import { getOrCreateProject } from '../../../../lib/store/projects';
import { startVibeJob } from '../../../../lib/jobs/vibeJob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/project/[id]/vibe → body { vibe?: string }
// 批次2（F36-F39）：cage 照（已通过 /upload kind=cage 传）+ 宠物照（brief.petPhotoUrl 自动带入）+ vibe 文字
// → fal edit 改造后效果图。重活后台跑，project.vibeRender 状态机供前端轮询 GET /api/project/[id]。
// ?mock=1：用现成占位图，延时 1s 跑通链路，不调 fal。
//
// WP-G1：id 现在是 v1 Project.id（真实身份已在 Postgres），本路由的内存态是
// 「未迁段状态缓存」，惰性建镜像而非要求先经旧 POST /api/project（已退役）。
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const project = getOrCreateProject(id);

  const body = (await request.json().catch(() => ({}))) as { vibe?: string };
  const vibeText = body.vibe?.trim() ?? '';

  const mock = new URL(request.url).searchParams.get('mock') === '1';
  try {
    startVibeJob(project, vibeText, mock);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
  return NextResponse.json({ ok: true, vibeRender: project.vibeRender }, { status: 202 });
}
