import { copyFile, mkdir, stat } from 'fs/promises';
import path from 'path';
import { getProject, touch } from '../store/projects';
import type { PetScapeProject } from '../types/project';
import { buildVibePrompt } from '../images/scenePrompt';
import { falEditImage, falGenerateImage, downloadImage, fileToDataUri, publicImageToAbs } from '../images/falClient';

// 批次2 vibe 效果图 job（F36-F39）：有 cage 照则改造原环境；无 cage 照则按 vibe 生成完整造景图。
// 沿用 scenes route 的 in-memory 状态机 + 前端轮询模式；?mock=1 用现成占位图零成本跑通。

const workingDir = process.cwd();
const MOCK_AFTER_ASSET = 'scheme-b-rockcave.jpg';

function projectDir(id: string) {
  return path.join(workingDir, 'public', 'generated', id, 'vibe');
}

// fal 偶发瞬时错误重试一次：失败等 2s 重试，仍失败才向上抛。
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[vibeJob retry] ${label} 首次失败，2s 后重试一次：${err instanceof Error ? err.message : String(err)}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return fn();
  }
}

// 入口：同步置 vibeRender=running；有 cage 原图时 beforeUrl 直用，否则只生成 afterUrl。
export function startVibeJob(project: PetScapeProject, vibeText: string, mock: boolean) {
  const cagePhotoUrl = project.brief.cagePhotoUrl;

  project.vibeRender = { status: 'running', ...(cagePhotoUrl ? { beforeUrl: cagePhotoUrl } : {}) };
  touch(project);

  void runVibeJob(project.id, cagePhotoUrl, project.brief.petPhotoUrl, vibeText, mock).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const p = getProject(project.id);
    if (!p) return;
    p.vibeRender = { ...(p.vibeRender ?? { status: 'running' }), status: 'failed', error: message };
    touch(p);
    console.error(`[vibeJob ${project.id}] failed: ${message}`);
  });
}

async function runVibeJob(
  id: string,
  cagePhotoUrl: string | undefined,
  petPhotoUrl: string | undefined,
  vibeText: string,
  mock: boolean,
) {
  const dir = projectDir(id);
  await mkdir(dir, { recursive: true });

  const filename = `after-${Date.now()}.png`;
  const rel = `/generated/${id}/vibe/${filename}`;
  const abs = path.join(dir, filename);

  if (mock) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const src = path.join(workingDir, 'public', 'mockup-assets', MOCK_AFTER_ASSET);
    await withRetry('mock vibe copy', () => copyFile(src, abs));
  } else {
    const project = getProject(id);
    const brief = project?.brief ?? { species: '', taboos: [], traits: [] };
    const hasPetPhoto = !!petPhotoUrl;
    const hasEnvironmentImage = !!cagePhotoUrl;
    const prompt = buildVibePrompt(brief, vibeText, hasPetPhoto, hasEnvironmentImage);
    const refs: string[] = [];
    if (cagePhotoUrl) refs.push(cagePhotoUrl);
    if (petPhotoUrl) refs.push(petPhotoUrl);
    const referenceDataUris = await Promise.all(refs.map((relPath) => fileToDataUri(publicImageToAbs(relPath))));
    const mode = referenceDataUris.length > 0 ? 'edit' : 'generate';
    console.log(`[vibeJob ${id}] fal ${mode} start → ${rel}`);
    const url =
      referenceDataUris.length > 0
        ? await withRetry('fal vibe edit', () => falEditImage(prompt, referenceDataUris))
        : await withRetry('fal vibe generate', () => falGenerateImage(prompt));
    await downloadImage(url, abs);
    console.log(`[vibeJob ${id}] fal ${mode} ready → ${rel}`);
  }

  const info = await stat(abs).catch(() => null);
  if (!info || info.size === 0) throw new Error('生图完成但输出文件为空');

  const p = getProject(id);
  if (!p) return;
  p.vibeRender = { status: 'done', ...(cagePhotoUrl ? { beforeUrl: cagePhotoUrl } : {}), afterUrl: rel };
  touch(p);
}
