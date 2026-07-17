import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { mkdir, stat, copyFile } from 'fs/promises';
import path from 'path';
import { getProject, touch } from '../../../../../../lib/store/projects';
import type { CanvasItem, PetScapeProject } from '../../../../../../lib/types/project';
import { falEditImage, downloadImage } from '../../../../../../lib/images/falClient';
import { withTimeout, JOB_TIMEOUT_MS } from '../../../../../../lib/jobs/timeouts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; sceneId: string }> };

const workingDirectory = process.cwd();
// mock 模式的占位结果图（spec §T2）：不调 fal，跑通 generating→ready + parentId + 派生连线全链路。
const MOCK_REVISE_ASSET = 'scheme-a-mushroom-v2.jpg';

// 从父卡名派生下一版本名："方案 A · 贴合风格" → "方案 A · v2"；"方案 A · v2" → "方案 A · v3"。
function nextVersionName(parentName: string): string {
  const base = parentName.split('·')[0].trim() || parentName;
  const match = parentName.match(/·\s*v(\d+)\s*$/);
  const nextVersion = match ? Number(match[1]) + 1 : 2;
  return `${base} · v${nextVersion}`;
}

// POST /api/project/[id]/scenes/[sceneId]/revise
// body: { annotatedImageDataUri, note } → falEditImage → 新 scene2d，parentId 指向源。
// ?mock=1：跳过 fal，用 public/mockup-assets/scheme-a-mushroom-v2.jpg 当结果（开发/回归用）。
export async function POST(request: Request, ctx: Ctx) {
  const { id, sceneId } = await ctx.params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const source = project.canvasItems.find((it) => it.id === sceneId);
  if (!source) return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
  if (source.kind !== 'scene2d' || source.status !== 'ready' || !source.imagePath) {
    return NextResponse.json({ error: '源场景尚未就绪，无法按标注修改' }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    annotatedImageDataUri?: string;
    note?: string;
  };
  if (!body.annotatedImageDataUri || !body.annotatedImageDataUri.startsWith('data:')) {
    return NextResponse.json({ error: '缺少标注合成图 annotatedImageDataUri' }, { status: 400 });
  }
  const note = (body.note ?? '').trim();
  if (!note) {
    return NextResponse.json({ error: '缺少标注文字 note，请先在标注上写字' }, { status: 400 });
  }

  const mock = new URL(request.url).searchParams.get('mock') === '1';
  const now = new Date().toISOString();

  const item: CanvasItem = {
    id: randomUUID(),
    kind: 'scene2d',
    name: nextVersionName(source.name),
    status: 'generating',
    parentId: source.id,
    createdAt: now,
  };
  project.canvasItems.push(item);
  project.generating = true;
  touch(project);

  void runRevise(project, item, body.annotatedImageDataUri, note, mock);

  return NextResponse.json({ item }, { status: 202 });
}

async function runRevise(
  project: PetScapeProject,
  item: CanvasItem,
  annotatedImageDataUri: string,
  note: string,
  mock: boolean,
) {
  const dir = path.join(workingDirectory, 'public', 'generated', project.id);
  await mkdir(dir, { recursive: true });
  const filename = `revise-${item.id}.png`;
  const rel = `/generated/${project.id}/${filename}`;
  const abs = path.join(dir, filename);

  try {
    if (mock) {
      const src = path.join(workingDirectory, 'public', 'mockup-assets', MOCK_REVISE_ASSET);
      await copyFile(src, abs);
    } else {
      const prompt = `按照图上的红色手绘箭头标注和文字说明修改这张宠物造景场景图。标注说明：${note}。只按标注要求做局部修改，其余部分尽量保持原样、风格一致、光照一致。不要出现文字、水印、人手、尺子。`;
      console.log(`[revise ${project.id}] fal start scene=${item.parentId} note="${note}" → ${rel}`);
      const url = await withTimeout('revise', JOB_TIMEOUT_MS.revise, (signal) =>
        falEditImage(prompt, [annotatedImageDataUri], signal),
      );
      await downloadImage(url, abs);
      console.log(`[revise ${project.id}] fal ready → ${rel}`);
    }
    const info = await stat(abs).catch(() => null);
    if (!info || info.size === 0) throw new Error('改图完成但输出文件为空');
    item.status = 'ready';
    item.imagePath = rel;
  } catch (err) {
    item.status = 'failed';
    item.error = err instanceof Error ? err.message : String(err);
    console.error(`[revise ${project.id}] failed: ${item.error}`);
  } finally {
    project.generating = project.canvasItems.some((it) => it.status === 'generating');
    touch(project);
  }
}
