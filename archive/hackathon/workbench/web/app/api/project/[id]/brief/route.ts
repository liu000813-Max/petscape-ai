import { NextResponse } from 'next/server';
import { getProject, touch } from '../../../../lib/store/projects';
import { missingRequiredFields, type Brief } from '../../../../lib/types/project';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const FIELD_KEYS = [
  'species',
  'petSize',
  'style',
  'item',
  'scene',
  'photoPath',
  'petName',
  'vibe',
  'petPhotoUrl',
  'cagePhotoUrl',
] as const;

// PATCH /api/project/[id]/brief → 更新表单字段（表单是真相源，前端字段即时 PATCH）。
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Partial<Brief>;
  const target = project.brief as unknown as Record<string, unknown>;
  for (const key of FIELD_KEYS) {
    if (typeof body[key] === 'string') target[key] = body[key];
  }
  if (Array.isArray(body.taboos)) project.brief.taboos = body.taboos.filter((t) => typeof t === 'string');
  if (Array.isArray(body.traits)) project.brief.traits = body.traits.filter((t) => typeof t === 'string');
  touch(project);

  return NextResponse.json({ brief: project.brief, missing: missingRequiredFields(project.brief) });
}
