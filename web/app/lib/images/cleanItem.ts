import { mkdir, readdir, stat } from 'fs/promises';
import path from 'path';
import { JOB_TIMEOUT_MS, withTimeout } from '../jobs/timeouts';
import { falEditImage, downloadImage, fileToDataUri, publicImageToAbs } from './falClient';

const workingDirectory = process.cwd();

export async function nextCleanItemImageIndex(dir: string): Promise<number> {
  const files = await readdir(dir).catch(() => []);
  const indices = files
    .map((file) => file.match(/^clean-item-(\d+)\.png$/)?.[1])
    .filter((index): index is string => Boolean(index))
    .map(Number);
  return indices.length ? Math.max(...indices) + 1 : 1;
}

export async function generateCleanItemImage(sessionId: string, sceneImagePath: string, itemDesc: string, index?: number): Promise<string> {
  const dir = path.join(workingDirectory, 'public', 'generated', sessionId);
  await mkdir(dir, { recursive: true });
  const imageIndex = index ?? (await nextCleanItemImageIndex(dir));
  const filename = `clean-item-${imageIndex}.png`;
  const rel = `/generated/${sessionId}/${filename}`;
  const abs = path.join(dir, filename);

  const prompt = `仔细观察这张宠物造景场景图，找到这个物品：${itemDesc}。

把这个物品单独重绘为纯白背景、无阴影、无杂物、无宠物、无其他装饰的单物品产品图。物品必须居中、完整、边缘清晰；忠实保留输入图中该物品的形状、颜色、材质、比例和关键结构。照片级产品摄影/电商产品图质感。`;

  console.log(`[cleanItem ${sessionId}] fal start input=${sceneImagePath} output=${rel}`);
  await withTimeout('cleanItem', JOB_TIMEOUT_MS.cleanItem, async (signal) => {
    const url = await falEditImage(prompt, [await fileToDataUri(publicImageToAbs(sceneImagePath))], signal);
    await downloadImage(url, abs, signal);
  });
  console.log(`[cleanItem ${sessionId}] fal success output=${rel}`);

  const info = await stat(abs).catch(() => null);
  if (!info || info.size === 0) throw new Error(`抠图完成但未找到输出文件：${rel}`);
  return rel;
}
