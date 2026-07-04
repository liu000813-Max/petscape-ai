import type { Brief } from '../types/project';

// 场景 prompt 组装（spec §2 / B2 双语义）：(brief) => 3 个差异化方向的完整宠物造景场景 prompt。
// 生成的是完整场景（物种×尺寸×风格×使用场景×禁忌×氛围×习性），不是单物品图。
// petName 不进 prompt（人名/昵称对生图模型无意义、易产生幻觉文字）。

// 3 个方向：主风格贴合 / 自然有机变体 / 极简结构变体——保证 3 张有辨识度差异。
const DIRECTIONS = [
  { name: '方案 A · 贴合风格', hint: '严格贴合用户选定风格，作为主方案' },
  { name: '方案 B · 自然有机', hint: '更自然有机的造型语言，圆润洞口、苔藓木质纹理' },
  { name: '方案 C · 简洁结构', hint: '更简洁的几何结构，干净利落、易打印' },
] as const;

// 习性 → 功能暗示：行为需求翻译成造景结构语言，不直接抄用户措辞。
const TRAIT_HINTS: Record<string, string> = {
  爱钻洞: '设计多条可钻入的隧道/洞穴通道',
  爱攀爬: '设置分层平台与攀爬支架，增加垂直活动空间',
  爱觅食: '藏入可寻食的凹槽或隐藏小室，鼓励觅食行为',
  爱社交: '预留开阔的共处区域，视野通透便于互动',
  胆小怕光: '设计遮蔽感强的半封闭躲避角落，弱化开阔感',
  爱啃咬: '选用耐啃咬的原木质感结构，边缘加厚',
};

function briefLine(brief: Brief): string {
  const traitHints = (brief.traits ?? []).map((t) => TRAIT_HINTS[t] ?? t);
  const parts = [
    `宠物：${brief.species || '小宠'}`,
    brief.petSize ? `尺寸：${brief.petSize}` : '',
    brief.style ? `风格：${brief.style}` : '',
    brief.item ? `重点物品：${brief.item}` : '',
    brief.scene ? `使用场景：${brief.scene}` : '',
    brief.taboos.length ? `安全禁忌：${brief.taboos.join('、')}` : '',
    traitHints.length ? `习性对应功能：${traitHints.join('；')}` : '',
    brief.vibe?.trim() ? `主导氛围：${brief.vibe.trim()}` : '',
  ].filter(Boolean);
  return parts.join('，');
}

// 宠物出现要求：两分支都要，有参考照时要求外观一致，没有则按物种描述生成。
function petPresenceLine(brief: Brief, hasPetPhoto: boolean): string {
  if (hasPetPhoto) {
    return '画面中必须出现这只宠物本体，外观（毛色/花纹/体态）需与提供的宠物参考照保持一致，宠物在造景中自然活动。';
  }
  return `画面中必须出现一只真实的${brief.species || '小宠'}，在造景中自然活动，姿态生动、比例真实。`;
}

const COMMON_STYLE_SUFFIX =
  '温暖柔和的自然光，森林绿与原木色调，俯视偏侧的等距视角，干净背景，产品渲染质感。不要出现文字、水印、人手、尺子。';

export function buildScenePrompts(brief: Brief): { name: string; prompt: string }[] {
  const base = briefLine(brief);
  const hasPetPhoto = !!brief.petPhotoUrl;
  const presence = petPresenceLine(brief, hasPetPhoto);
  return DIRECTIONS.map(({ name, hint }) => ({
    name,
    prompt:
      `为一只真实宠物定制的造景空间设计效果图。${base}。设计方向：${hint}。` +
      `${presence} ${COMMON_STYLE_SUFFIX}`,
  }));
}

// i2i 改造图 prompt（B2）：保留原笼箱结构，只在其中添加可拆卸 3D 打印造景模块。
// 与 t2i 场景图共用习性/氛围/风格语义，但硬约束「不改变原笼箱」。
export function buildRevampPrompts(brief: Brief): { name: string; prompt: string }[] {
  const base = briefLine(brief);
  const hasPetPhoto = !!brief.petPhotoUrl;
  const presence = petPresenceLine(brief, hasPetPhoto);
  return DIRECTIONS.map(({ name, hint }) => ({
    name,
    prompt:
      `这是用户宠物现有笼箱的实拍照片，请在**不改变原笼箱结构、尺寸、材质、位置**的前提下，` +
      `为其添加可拆卸的 3D 打印造景模块（如躲避屋、通道、平台、垫材造型），做成「改造后」效果图。` +
      `${base}。设计方向：${hint}。${presence} ` +
      `造景模块与原笼箱风格协调、比例合身，看起来像是加装进现有笼箱内部或嵌入其中。` +
      `${COMMON_STYLE_SUFFIX}`,
  }));
}
