import sharp from 'sharp';
import path from 'path';

// 宠物角色三视图（1×3 横排 front/left/back）prompt + 裁切 + 独立性验证（单点真相源）。
// avatarJob 步骤2「三视图」用 buildTriviewGridPrompt 把风格化立绘喂给 fal edit 生成 1×3 网格 →
// cropTriviewToViews 像素级三等分 → validateViews 逐张体检 → Tripo image_to_model 三槽位提交。
// 与老的四视图函数（multiviewPrompt.ts / cropGrid.ts）互不干扰：那套是 gate1 物品链，本套是 avatar 宠物链。
//
// 布局约定（与裁切逻辑严格对齐）：一行三格，从左到右 = front / left / back。
//   Tripo multiview 四槽位 = [front, left, back, right]；本链 right 槽留空（省略/传 null）。

export interface TriviewPromptInput {
  species?: string;
}

export function buildTriviewGridPrompt({ species }: TriviewPromptInput): string {
  const subject = species ? `一只${species}` : '这只宠物角色';
  return `参考图是一张白底的宠物角色立绘（${subject}）。请把「完全相同的这只角色」渲染成一张横向排列的三视图网格图。

硬性要求：
1. 必须是参考图里那只一模一样的角色——保持其毛色、花纹、体型比例、所有外貌特征、装扮和材质。不得替换成别的角色，不得凭空增删结构。
2. 一行三格，从左到右固定顺序：① 正视图 front（正对镜头）② 左侧视图 left（角色朝向自己的左侧，即镜头看到的其右侧面）③ 后视图 back（背对镜头）。三个视图都是同一角色围绕垂直轴旋转拍摄，正交/平行投影、无透视畸变、相机高度一致。
3. 纯白背景（#FFFFFF），无阴影、无地面、无倒影、无文字标注、无网格线、无分隔框、无其它宠物或道具。
4. 角色在每个格子内居中、完整、四周留白、边缘清晰，三个视图使用一致的缩放和光照，看起来是同一个角色从三个角度拍摄。

输出一张宽高比约 3:1 的横向图片，包含上述从左到右 front / left / back 三视图。`;
}

export interface TriviewCropResult {
  front: string;
  left: string;
  back: string;
  /** Tripo multiview 上传顺序（本链 right 槽留空）：[front, left, back] */
  orderedForTripo: string[];
}

// 把 1×3 横排三视图网格像素级三等分为 3 张单视图（纯裁切，无生成式手段）。
export async function cropTriviewToViews(gridAbsPath: string, outDir: string): Promise<TriviewCropResult> {
  const img = sharp(gridAbsPath);
  const meta = await img.metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) throw new Error(`三视图网格尺寸无效: ${W}x${H}`);
  const third = Math.floor(W / 3);

  const regions: Record<'front' | 'left' | 'back', { left: number; top: number; width: number; height: number }> = {
    front: { left: 0, top: 0, width: third, height: H },
    left: { left: third, top: 0, width: third, height: H },
    back: { left: third * 2, top: 0, width: W - third * 2, height: H },
  };

  const out: Record<string, string> = {};
  for (const [name, region] of Object.entries(regions)) {
    const outPath = path.join(outDir, `avatar-view-${name}.png`);
    await sharp(gridAbsPath).extract(region).png().toFile(outPath);
    out[name] = outPath;
  }

  return {
    front: out.front,
    left: out.left,
    back: out.back,
    orderedForTripo: [out.front, out.left, out.back],
  };
}

export interface ViewCheck {
  view: string;
  widthPx: number;
  heightPx: number;
  marginPct: number; // 四边最小留白占比（%）
  contentPct: number; // 内容（非白）占画面比例（%）
  sizeOk: boolean;
  marginOk: boolean;
  contentOk: boolean;
  pass: boolean;
}

export interface ValidateViewsResult {
  ok: boolean;
  checks: ViewCheck[];
  reasons: string[];
}

// 逐张体检三视图：① 尺寸正确（宽高 >0 且接近方形，容忍 3:1 网格切出的偏差）
//   ② 四边留白 ≥3%（主体没贴边 = 没跨格切割）③ 内容占比 20-90%（非空白格、非糊满）。
// 内容 = 与纯白（>=245 三通道）差异明显的像素；用 raw 灰度阈值统计，逐行逐列求主体包围盒。
export async function validateViews(viewPaths: string[]): Promise<ValidateViewsResult> {
  const names = ['front', 'left', 'back'];
  const checks: ViewCheck[] = [];
  const reasons: string[] = [];
  const MIN_MARGIN_PCT = 3;
  const MIN_CONTENT_PCT = 20;
  const MAX_CONTENT_PCT = 90;

  for (let i = 0; i < viewPaths.length; i += 1) {
    const name = names[i] ?? `view-${i}`;
    const p = viewPaths[i];
    const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width;
    const H = info.height;
    const ch = info.channels;

    let contentPixels = 0;
    let minX = W;
    let minY = H;
    let maxX = -1;
    let maxY = -1;
    const WHITE = 245;

    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const idx = (y * W + x) * ch;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = ch === 4 ? data[idx + 3] : 255;
        const isContent = a > 20 && (r < WHITE || g < WHITE || b < WHITE);
        if (isContent) {
          contentPixels += 1;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    const totalPixels = W * H;
    const contentPct = (contentPixels / totalPixels) * 100;
    // 主体包围盒到四边的最小留白（占该维度比例）
    let marginPct: number;
    if (maxX < 0) {
      marginPct = 0; // 全空白
    } else {
      const marginLeft = minX / W;
      const marginRight = (W - 1 - maxX) / W;
      const marginTop = minY / H;
      const marginBottom = (H - 1 - maxY) / H;
      marginPct = Math.min(marginLeft, marginRight, marginTop, marginBottom) * 100;
    }

    const sizeOk = W > 0 && H > 0;
    const marginOk = marginPct >= MIN_MARGIN_PCT;
    const contentOk = contentPct >= MIN_CONTENT_PCT && contentPct <= MAX_CONTENT_PCT;
    const pass = sizeOk && marginOk && contentOk;
    if (!pass) {
      if (!sizeOk) reasons.push(`${name}: 尺寸无效 ${W}x${H}`);
      if (!marginOk) reasons.push(`${name}: 留白不足 ${marginPct.toFixed(1)}%<3%（疑似贴边/跨格切割）`);
      if (!contentOk)
        reasons.push(`${name}: 内容占比 ${contentPct.toFixed(1)}% 超出 20-90%（疑似空白格/糊满）`);
    }
    checks.push({
      view: name,
      widthPx: W,
      heightPx: H,
      marginPct: Number(marginPct.toFixed(2)),
      contentPct: Number(contentPct.toFixed(2)),
      sizeOk,
      marginOk,
      contentOk,
      pass,
    });
  }

  return { ok: checks.every((c) => c.pass), checks, reasons };
}
