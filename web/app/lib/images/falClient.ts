import { readFile, writeFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

// fal.ai 同步端点（fal.run）：nano-banana 生成 ~8s、edit ~10s，直接同步等待即可，无需 queue API。
const FAL_BASE = 'https://fal.run';
export const FAL_MODELS = {
  generate: 'fal-ai/nano-banana',
  edit: 'fal-ai/nano-banana/edit',
} as const;

function readFalKey() {
  if (process.env.FAL_KEY) return process.env.FAL_KEY;
  // next dev 从 web/ 启动时默认不会读取项目根 .env；服务端兜底读取 ../.env，绝不暴露到前端。
  for (const envPath of [path.join(process.cwd(), '.env.local'), path.join(process.cwd(), '..', '.env')]) {
    try {
      const match = readFileSync(envPath, 'utf8').match(/^FAL_KEY=(.+)$/m);
      if (match?.[1]) return match[1].trim().replace(/^['"]|['"]$/g, '');
    } catch {}
  }
  throw new Error('服务端未配置 FAL_KEY（请在项目根 .env 或 web/.env.local 中配置）');
}

interface FalImageResponse {
  images?: { url?: string }[];
}

async function falRun(model: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${FAL_BASE}/${model}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${readFalKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`fal ${model} HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as FalImageResponse;
  const url = data.images?.[0]?.url;
  if (!url) throw new Error(`fal ${model} 未返回图片`);
  return url;
}

export function falGenerateImage(prompt: string, signal?: AbortSignal): Promise<string> {
  return falRun(FAL_MODELS.generate, { prompt, num_images: 1 }, signal);
}

export function falEditImage(prompt: string, imageDataUris: string[], signal?: AbortSignal): Promise<string> {
  return falRun(FAL_MODELS.edit, { prompt, image_urls: imageDataUris, num_images: 1 }, signal);
}

export async function downloadImage(url: string, absPath: string, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`下载 fal 图片失败 HTTP ${res.status}`);
  await writeFile(absPath, Buffer.from(await res.arrayBuffer()));
}

export function publicImageToAbs(imagePath: string): string {
  // 注意：public 相对路径（如 /generated/xx.png）会被 path.isAbsolute 误判，先验证磁盘上真实存在。
  if (path.isAbsolute(imagePath) && existsSync(imagePath)) return imagePath;
  return path.join(process.cwd(), 'public', imagePath.replace(/^\//, ''));
}

export async function fileToDataUri(absPath: string): Promise<string> {
  const buf = await readFile(absPath);
  const mime = /\.jpe?g$/i.test(absPath) ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}
