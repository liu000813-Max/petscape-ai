import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { mkdir, copyFile, stat } from 'fs/promises';
import path from 'path';
import { getProject, touch } from '../../../../lib/store/projects';
import { missingRequiredFields, type CanvasItem, type PetScapeProject } from '../../../../lib/types/project';
import { buildScenePrompts, buildRevampPrompts } from '../../../../lib/images/scenePrompt';
import { falGenerateImage, falEditImage, downloadImage, publicImageToAbs, fileToDataUri } from '../../../../lib/images/falClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const workingDirectory = process.cwd();
// mock 模式的占位图（开发期跑通链路用），与真调用同落盘路径、同 generating→ready 状态机。
const MOCK_ASSETS = ['scheme-a-mushroom-v1.jpg', 'scheme-b-rockcave.jpg', 'scheme-c-logstump.jpg'];

// fal 偶发 422/瞬时错误重试一次：失败等 2s 重试，仍失败才向上抛（原始错误保留在 console.error，供排查）。
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[scenes retry] ${label} 首次失败，2s 后重试一次：${err instanceof Error ? err.message : String(err)}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return fn();
  }
}

// POST /api/project/[id]/scenes → 校验必填三项 → 双语义分流：
//   有 cagePhotoUrl → i2i 改造图（笼箱照[+宠物照] → 3 张 After 变体 + 1 张「改造前」ready 卡）
//   无 cagePhotoUrl → t2i 置景图（有 petPhotoUrl 则以宠物照为参考走 falEditImage，否则纯文生图）
// ?mock=1：用 public/mockup-assets 占位跑通链路，不调 fal（开发/回归用）。
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const missing = missingRequiredFields(project.brief);
  if (missing.length > 0) {
    return NextResponse.json({ error: '必填项缺失', missing }, { status: 400 });
  }

  const mock = new URL(request.url).searchParams.get('mock') === '1';
  const hasCage = !!project.brief.cagePhotoUrl;
  const prompts = hasCage ? buildRevampPrompts(project.brief) : buildScenePrompts(project.brief);
  const now = new Date().toISOString();

  const items: CanvasItem[] = [];

  // i2i 分支：先落一张「改造前」ready 卡，图直接是笼箱照本身（无需生成、无需等待）。
  if (hasCage) {
    items.push({
      id: randomUUID(),
      kind: 'scene2d',
      name: '改造前',
      status: 'ready',
      imagePath: project.brief.cagePhotoUrl,
      createdAt: now,
    });
  }

  // 3 个方向的生成卡（generating → 后台跑 → ready/failed）。
  const genItems: CanvasItem[] = prompts.map((p) => ({
    id: randomUUID(),
    kind: 'scene2d',
    name: hasCage ? `改造后 · ${p.name}` : p.name,
    status: 'generating',
    prompt: p.prompt,
    createdAt: now,
  }));
  items.push(...genItems);

  project.canvasItems.push(...items);
  project.userState = 'designing2d';
  project.generating = true;
  touch(project);

  // fire-and-forget 后台生成（sessions/meshy 同款：in-memory 状态机 + 前端轮询）
  void runGeneration(project, genItems, prompts, mock, hasCage);

  return NextResponse.json({ items }, { status: 202 });
}

async function runGeneration(
  project: PetScapeProject,
  items: CanvasItem[],
  prompts: { name: string; prompt: string }[],
  mock: boolean,
  hasCage: boolean,
) {
  const dir = path.join(workingDirectory, 'public', 'generated', project.id);
  await mkdir(dir, { recursive: true });

  // 参考图（i2i / t2i-with-pet-ref 共用）：笼箱照 + 宠物照 转 base64 data URI，一并传 image_urls。
  let referenceDataUris: string[] = [];
  if (!mock) {
    const refs: string[] = [];
    if (hasCage && project.brief.cagePhotoUrl) refs.push(project.brief.cagePhotoUrl);
    if (project.brief.petPhotoUrl) refs.push(project.brief.petPhotoUrl);
    referenceDataUris = await Promise.all(refs.map((rel) => fileToDataUri(publicImageToAbs(rel))));
  }

  await Promise.all(
    items.map(async (item, i) => {
      // 唯一段防覆盖：同 project 重复生成不再覆盖历史文件，canvasItems 各卡各自的 imagePath 指向独立文件。
      const filename = `scene-${Date.now()}-${i + 1}.png`;
      const rel = `/generated/${project.id}/${filename}`;
      const abs = path.join(dir, filename);
      try {
        if (mock) {
          const src = path.join(workingDirectory, 'public', 'mockup-assets', MOCK_ASSETS[i % MOCK_ASSETS.length]);
          await withRetry(`mock copy ${item.name}`, () => copyFile(src, abs));
        } else {
          console.log(`[scenes ${project.id}] fal start ${item.name} → ${rel}`);
          const url =
            referenceDataUris.length > 0
              ? await withRetry(`fal edit ${item.name}`, () => falEditImage(prompts[i].prompt, referenceDataUris))
              : await withRetry(`fal generate ${item.name}`, () => falGenerateImage(prompts[i].prompt));
          await downloadImage(url, abs);
          console.log(`[scenes ${project.id}] fal ready ${item.name} → ${rel}`);
        }
        const info = await stat(abs).catch(() => null);
        if (!info || info.size === 0) throw new Error('生图完成但输出文件为空');
        item.status = 'ready';
        item.imagePath = rel;
      } catch (err) {
        item.status = 'failed';
        item.error = err instanceof Error ? err.message : String(err);
        console.error(`[scenes ${project.id}] failed ${item.name}: ${item.error}`);
      } finally {
        touch(project);
      }
    }),
  );

  project.generating = project.canvasItems.some((it) => it.status === 'generating');
  touch(project);
}
