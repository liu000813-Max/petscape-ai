import { NextResponse } from 'next/server';
import { getProject, touch } from '../../../../../lib/store/projects';
import { missingRequiredFields } from '../../../../../lib/types/project';
import { runExtractAgent } from '../../../../../lib/agents/extract/agent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/project/[id]/agent/extract → 右栏 Chat 一句话，LLM 抽取结构化字段直接落 brief。
// body: {message: string}；返回 {patched, missing, reply}。
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { message?: string };
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 });

  const { patch, reply } = await runExtractAgent(message, project.brief);

  const target = project.brief as unknown as Record<string, unknown>;
  const patched: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      target[key] = value;
      patched[key] = value;
    } else if (typeof value === 'string' && value.trim()) {
      target[key] = value;
      patched[key] = value;
    }
  }
  if (Object.keys(patched).length > 0) touch(project);

  return NextResponse.json({
    patched,
    missing: missingRequiredFields(project.brief),
    reply,
  });
}
