import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getProject, touch } from '../../../../lib/store/projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const KIND_FIELD = { pet: 'petPhotoUrl', cage: 'cagePhotoUrl' } as const;
type Kind = keyof typeof KIND_FIELD;

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function extFor(file: File) {
  if (file.type && EXT_BY_MIME[file.type]) return EXT_BY_MIME[file.type];
  const fromName = file.name?.split('.').pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,4}$/.test(fromName)) return fromName;
  return 'jpg';
}

// POST /api/project/[id]/upload → multipart form-data { file, kind: 'pet'|'cage' }
// 落 public/uploads/{projectId}/{kind}.{ext}，写回 brief.petPhotoUrl / brief.cagePhotoUrl，返回 {url}。
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: '需要 multipart/form-data' }, { status: 400 });

  const file = form.get('file');
  const kindRaw = form.get('kind');
  if (!(file instanceof File)) return NextResponse.json({ error: '缺少 file' }, { status: 400 });
  if (typeof kindRaw !== 'string' || !(kindRaw in KIND_FIELD)) {
    return NextResponse.json({ error: 'kind 必须是 pet 或 cage' }, { status: 400 });
  }
  const kind = kindRaw as Kind;

  const ext = extFor(file);
  const dir = path.join(process.cwd(), 'public', 'uploads', id);
  await mkdir(dir, { recursive: true });
  const filename = `${kind}.${ext}`;
  const filePath = path.join(dir, filename);
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, bytes);

  const url = `/uploads/${id}/${filename}`;
  const field = KIND_FIELD[kind];
  (project.brief as unknown as Record<string, unknown>)[field] = url;
  touch(project);

  return NextResponse.json({ url, brief: project.brief });
}
