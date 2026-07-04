import sharp from 'sharp';
import path from 'path';

// 把 2×2 正交四视图网格图像素级均分为 4 张单视图（无任何生成式手段，纯裁切）。
// 网格布局（与 multiviewPrompt.ts 约定一致）：
//   左上=front  右上=back
//   左下=left   右下=right
// 参考 experiments/fidelity-test/crop_grid.py 的均分逻辑；这里不做 label 裁边
// （新 prompt 已要求无文字标注/无网格线），只做像素级四等分。
// 返回按 [front, left, back, right]（FLBR，Tripo multiview 上传顺序）排列的绝对路径数组。

export interface CropGridResult {
  front: string;
  back: string;
  left: string;
  right: string;
  /** Tripo multiview 上传顺序 FLBR */
  orderedForTripo: string[];
}

export async function cropGridToViews(gridAbsPath: string, outDir: string): Promise<CropGridResult> {
  const img = sharp(gridAbsPath);
  const meta = await img.metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) throw new Error(`网格图尺寸无效: ${W}x${H}`);
  const mx = Math.floor(W / 2);
  const my = Math.floor(H / 2);

  // (left, top, width, height) —— 像素级四等分，覆盖到边缘
  const quads: Record<'front' | 'back' | 'left' | 'right', { left: number; top: number; width: number; height: number }> = {
    front: { left: 0, top: 0, width: mx, height: my },
    back: { left: mx, top: 0, width: W - mx, height: my },
    left: { left: 0, top: my, width: mx, height: H - my },
    right: { left: mx, top: my, width: W - mx, height: H - my },
  };

  const out: Record<string, string> = {};
  for (const [name, region] of Object.entries(quads)) {
    const outPath = path.join(outDir, `grid-view-${name}.png`);
    // 每次从源文件重新构造 sharp 实例，避免 extract 复用同一 pipeline 的状态污染。
    await sharp(gridAbsPath).extract(region).png().toFile(outPath);
    out[name] = outPath;
  }

  return {
    front: out.front,
    back: out.back,
    left: out.left,
    right: out.right,
    orderedForTripo: [out.front, out.left, out.back, out.right],
  };
}
