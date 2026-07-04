import { mkdir, stat } from 'fs/promises';
import path from 'path';
import type { Session } from '../types/session';
import { JOB_TIMEOUT_MS, withTimeout } from '../jobs/timeouts';
import { falGenerateImage, falEditImage, downloadImage, fileToDataUri, publicImageToAbs } from './falClient';

const workingDirectory = process.cwd();

export function buildInitialScenePrompt(session: Session): string {
  const { species, petSize, style, item } = session.brief;
  const constraints = session.constraints.length ? `必须遵守这些约束：${session.constraints.join('；')}。` : '无额外禁忌。';
  return [
    '生成一张高质量宠物造景场景效果图，照片级/精致产品概念图质感。',
    `场景：安全、干净、温馨的仓鼠笼/生态箱内部，主角宠物是${species || '仓鼠'}。`,
    `目标物品：${item || '躲避屋'}，必须显著、完整、清晰可见，位于画面主体位置，便于后续从图中选取建模。`,
    `风格：${style || '自然温馨'}。`,
    `尺寸语义：适合${petSize || '用户指定尺寸'}的仓鼠使用，入口和内部空间看起来宽敞安全。`,
    constraints,
    '画面中可以有少量垫料、木屑、苔藓、小装饰，但不要遮挡目标物品；不要出现文字、水印、价格标签或品牌标识。',
    '构图为横向或正方形，目标物品边缘清楚，材质和颜色明确。',
  ].join('\n');
}

/**
 * 生成场景效果图（fal.ai nano-banana）。
 * baseImagePath 存在时走 edit 通道：以上一张场景图为底做指令式修改，保持场景一致性；
 * 否则走文生图。
 */
export async function generateSceneImage(sessionId: string, prompt: string, imageIndex: number, baseImagePath?: string): Promise<string> {
  const dir = path.join(workingDirectory, 'public', 'generated', sessionId);
  await mkdir(dir, { recursive: true });
  const filename = `scene-${imageIndex}.png`;
  const rel = `/generated/${sessionId}/${filename}`;
  const abs = path.join(dir, filename);

  console.log(`[renderImage ${sessionId}] fal start mode=${baseImagePath ? 'edit' : 'generate'} output=${rel}`);
  await withTimeout('renderImage', JOB_TIMEOUT_MS.renderImage, async (signal) => {
    const url = baseImagePath
      ? await falEditImage(prompt, [await fileToDataUri(publicImageToAbs(baseImagePath))], signal)
      : await falGenerateImage(prompt, signal);
    await downloadImage(url, abs, signal);
  });
  console.log(`[renderImage ${sessionId}] fal success output=${rel}`);

  const info = await stat(abs).catch(() => null);
  if (!info || info.size === 0) throw new Error(`生图完成但未找到输出文件：${rel}`);
  return rel;
}
