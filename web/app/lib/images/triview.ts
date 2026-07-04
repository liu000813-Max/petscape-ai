import sharp from 'sharp';
import path from 'path';
import { SPECIES_WORDS } from '../prompts/avatarStyle';

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

const DEFAULT_TRIVIEW_POSE_PROMPT = `保持参考图的自然正面站姿 / 坐姿，四肢自然支撑身体；三个视图都要显示完整身体轮廓和所有肢体。`;

const TRIVIEW_POSE_PROMPTS: Record<string, string> = {
  rat: DEFAULT_TRIVIEW_POSE_PROMPT,
  snake: `蛇必须是低矮盘绕姿态。三个视图都要保留完整、连续的蛇身和多圈盘绕，头部可以略微抬起，但身体 / 盘绕必须仍是主形体；不要裁掉身体或尾巴，不要把蛇身变成头下方的小底座，不要改成非蛇类身体结构。`,
  spider: `蜘蛛必须是低矮爬行姿态。三个视图都要显示清楚的头胸部、腹部和八条腿，腿围绕身体自然展开；不要直立、不要拟人化、不要丢腿。`,
  gecko: `守宫必须是低矮趴伏 / 爬行姿态。三个视图都要保留四肢、脚趾和完整长尾，尾巴不得跨格或被裁掉；不要人形直立。`,
  parrot: `鹦鹉必须保持自然鸟类姿态。三个视图都要保留头、喙、翅膀、双足和完整尾羽；不要四足动物姿态、不要人形手臂、不要裁掉尾羽。`,
};

export function buildTriviewGridPrompt({ species }: TriviewPromptInput): string {
  const speciesWord = (species && SPECIES_WORDS[species]) || species;
  const subject = speciesWord ? `一只${speciesWord}` : '这只宠物角色';
  const posePrompt = (species && TRIVIEW_POSE_PROMPTS[species]) || DEFAULT_TRIVIEW_POSE_PROMPT;
  return `参考图是一张白底的宠物角色立绘（${subject}）。请把「完全相同的这只角色」渲染成一张横向排列的三视图网格图。

硬性要求：
1. 必须是参考图里那只一模一样的角色——保持其毛色、花纹、体型比例、所有外貌特征、装扮和材质。不得替换成别的角色，不得凭空增删结构。
2. 一行三格，从左到右固定顺序：① 正视图 front（正对镜头）② 左侧视图 left（角色朝向自己的左侧，即镜头看到的其右侧面）③ 后视图 back（背对镜头）。三个视图都是同一角色围绕垂直轴旋转拍摄，正交/平行投影、无透视畸变、相机高度一致。
3. 纯白背景（#FFFFFF），无阴影、无地面、无倒影、无文字标注、无网格线、无分隔框、无其它宠物或道具。
4. 构图硬约束：每个角色主体只占其所在格子高度的 75% 左右——主体最高点与画面上边缘、主体最低点与画面下边缘都必须有明显空白；三个视图彼此之间保持明显的水平间隙，任何部位（包括尾巴、胡须、道具）都绝不跨入相邻视图的区域、绝不接触画面左右边缘。
5. 物种姿态硬约束：${posePrompt}
6. 三个视图使用一致的缩放和光照，看起来是同一个角色从三个角度拍摄。

输出一张宽高比约 3:1 的横向图片，包含上述从左到右 front / left / back 三视图。`;
}

export interface TriviewGridAspectRatioCheck {
  ok: boolean;
  widthPx: number;
  heightPx: number;
  ratio: number;
  targetRatio: number;
  minRatio: number;
  maxRatio: number;
  reason?: string;
}

// 三视图裁切前先验证整张网格接近 3:1。阈值保守放宽到约 ±13%，拦截方图/16:9 等明显会三等分错位的产物。
export async function validateTriviewGridAspectRatio(gridAbsPath: string): Promise<TriviewGridAspectRatioCheck> {
  const meta = await sharp(gridAbsPath).metadata();
  const widthPx = meta.width ?? 0;
  const heightPx = meta.height ?? 0;
  const targetRatio = 3;
  const minRatio = 2.6;
  const maxRatio = 3.4;
  const ratio = heightPx ? widthPx / heightPx : 0;
  const ok = widthPx > 0 && heightPx > 0 && ratio >= minRatio && ratio <= maxRatio;
  return {
    ok,
    widthPx,
    heightPx,
    ratio: Number(ratio.toFixed(3)),
    targetRatio,
    minRatio,
    maxRatio,
    reason: ok
      ? undefined
      : `三视图网格宽高比 ${widthPx}x${heightPx} = ${ratio.toFixed(3)}，不在 ${minRatio}-${maxRatio} 的 3:1 容忍范围内`,
  };
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

// 提交 Tripo 前给单视图补白边（白底图无损）。治愈"主体上下贴边"——fal 常忽略留白约束，
// 与其反复重生成烧调用，不如裁切后统一垫边。必须在 validateViews 之后调用（补白会掩盖跨格信号）。
export async function padViews(viewPaths: string[], padPct = 6): Promise<void> {
  for (const p of viewPaths) {
    const meta = await sharp(p).metadata();
    const padX = Math.round(((meta.width ?? 0) * padPct) / 100);
    const padY = Math.round(((meta.height ?? 0) * padPct) / 100);
    const buf = await sharp(p)
      .extend({ top: padY, bottom: padY, left: padX, right: padX, background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png()
      .toBuffer();
    await sharp(buf).toFile(p);
  }
}

export interface ViewCheck {
  view: string;
  widthPx: number;
  heightPx: number;
  marginPct: number; // 左右最小留白占比（%）——跨格信号只看横向
  contentPct: number; // 内容（非白）占画面比例（%）
  edgeDensityPct: number; // 左右边缘条（各 2% 宽）内容像素密度（%）
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

// 逐张体检三视图：① 尺寸正确 ② 跨格检测（只看横向：左右留白 <1% 且左右边缘条内容密度 >15%
//   才判跨格——上下贴边只是构图紧，由 padViews 补白治愈，不在此拦截；轻微压线如尾尖也放行）
//   ③ 内容占比 20-90%（非空白格、非糊满）。
// 内容 = 与纯白（>=245 三通道）差异明显的像素；用 raw 灰度阈值统计，逐行逐列求主体包围盒。
// 2026-07-04 校正：原版"四边留白≥3%"把上下贴边一律判死——fal 实际产出内容合格但构图顶格，
//   导致 tripo 级联永远走不到提交步、全部降级 meshy。验证语义收敛为"只拦真跨格"。
export async function validateViews(viewPaths: string[]): Promise<ValidateViewsResult> {
  const names = ['front', 'left', 'back'];
  const checks: ViewCheck[] = [];
  const reasons: string[] = [];
  const MIN_LR_MARGIN_PCT = 1; // 左右留白低于此值才进入边缘密度判定
  const MAX_EDGE_DENSITY_PCT = 15; // 左右边缘条内容密度超过此值 = 邻格实体被切进来（真跨格）
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
    // 跨格信号只看横向：主体包围盒到左右边的最小留白 + 左右边缘条（各 2% 宽）内容密度。
    let marginPct: number;
    if (maxX < 0) {
      marginPct = 0; // 全空白（由 contentOk 拦截）
    } else {
      marginPct = (Math.min(minX / W, (W - 1 - maxX) / W)) * 100;
    }
    const edgeW = Math.max(1, Math.round(W * 0.02));
    let edgeContent = 0;
    for (let y = 0; y < H; y += 1) {
      for (const x of [...Array(edgeW).keys(), ...[...Array(edgeW).keys()].map((k) => W - 1 - k)]) {
        const idx = (y * W + x) * ch;
        const a = ch === 4 ? data[idx + 3] : 255;
        if (a > 20 && (data[idx] < WHITE || data[idx + 1] < WHITE || data[idx + 2] < WHITE)) edgeContent += 1;
      }
    }
    const edgeDensityPct = (edgeContent / (edgeW * 2 * H)) * 100;

    const sizeOk = W > 0 && H > 0;
    // 上下贴边不拦（padViews 补白治愈）；仅"左右几乎无留白且边缘条有实体"判真跨格。
    const marginOk = !(marginPct < MIN_LR_MARGIN_PCT && edgeDensityPct > MAX_EDGE_DENSITY_PCT);
    const contentOk = contentPct >= MIN_CONTENT_PCT && contentPct <= MAX_CONTENT_PCT;
    const pass = sizeOk && marginOk && contentOk;
    if (!pass) {
      if (!sizeOk) reasons.push(`${name}: 尺寸无效 ${W}x${H}`);
      if (!marginOk)
        reasons.push(`${name}: 左右留白 ${marginPct.toFixed(1)}% 且边缘密度 ${edgeDensityPct.toFixed(1)}%（邻格实体被切入，判跨格）`);
      if (!contentOk)
        reasons.push(`${name}: 内容占比 ${contentPct.toFixed(1)}% 超出 20-90%（疑似空白格/糊满）`);
    }
    checks.push({
      view: name,
      widthPx: W,
      heightPx: H,
      marginPct: Number(marginPct.toFixed(2)),
      contentPct: Number(contentPct.toFixed(2)),
      edgeDensityPct: Number(edgeDensityPct.toFixed(2)),
      sizeOk,
      marginOk,
      contentOk,
      pass,
    });
  }

  return { ok: checks.every((c) => c.pass), checks, reasons };
}
