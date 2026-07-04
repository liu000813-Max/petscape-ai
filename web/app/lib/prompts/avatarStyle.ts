// 宠物风格化立绘 prompt（单点真相源，用户亲手调这里）。
// avatarJob 步骤1「风格化」用本文件的 prompt 把用户上传的宠物照喂给 fal edit：
//   输出「游戏角色/手办风格、白底、单一主体居中、物种正确固定姿态」的立绘，
//   作为后续三视图 → Tripo image_to_model 的输入。
//
// 调参入口（grilling #2）：
//   - AVATAR_STYLE_PROMPT：主模板，含 {species}/{wearables} 两个插槽，前端把已选物种/装扮拼进来。
//   - WEARABLE_PROMPT_WORDS：装扮 id → 中文描述词，与 data.js 的 wearableItems id 对齐。
//   - STYLE_ENABLED：一键回退开关。false = 跳过风格化、直接把原图喂给三视图步骤
//     （grilling #2 回退路径 a：风格化拖累一致性时，退回原图直出三视图）。

export const AVATAR_STYLE_PROMPT = `把这张宠物照片重绘为一只可爱的收藏级手办 / 游戏角色风格的 3D 立绘。

主体：一只{species}，忠实保留照片里这只宠物的毛色、花纹、体型比例和最显著的外貌特征——让主人一眼认出是自己的宠物。

风格：任天堂 / 皮克斯质感的圆润 3D 角色手办，微哑光材质，柔和均匀的棚拍布光，干净清晰的边缘，略微 Q 版但不失真实特征。

姿态与构图（务必严格遵守，这是后续 3D 建模的硬约束）：
- 单一主体，画面正中央，四周留白。
{pose}
- 纯白背景（#FFFFFF），无阴影、无地面、无倒影、无文字、无边框、无其它道具或宠物。
{wearables}
输出单张正方形立绘。`;

// 装扮 id → 中文提示词（与 web/app/components/landing/data.js 的 wearableItems id 对齐）。
export const WEARABLE_PROMPT_WORDS: Record<string, string> = {
  'knit-hat': '头上戴着一顶迷你针织帽',
  'chef-scarf': '脖子上系着一条小厨师围巾',
  'name-charm': '佩戴着一枚小小的名字吊牌',
  'mini-cape': '披着一件迷你斗篷',
};

// 物种 id → 中文名（与 data.js species id 对齐；前端也可直接传中文名覆盖）。
export const SPECIES_WORDS: Record<string, string> = {
  rat: '花枝鼠',
  gecko: '守宫',
  snake: '蛇',
  parrot: '鹦鹉',
  spider: '蜘蛛',
};

// 物种姿态 / 解剖硬约束。共享风格由 AVATAR_STYLE_PROMPT 承载；这里避免把哺乳动物站姿套到蛇、蜘蛛、鸟类等。
const DEFAULT_POSE_PROMPT = `- 正面自然站姿或坐姿，面朝镜头；主体占画面高度约 60%-80%，身体居中、对称，四肢自然着地。`;

const SPECIES_POSE_PROMPTS: Record<string, string> = {
  rat: DEFAULT_POSE_PROMPT,
  snake: `- 蛇必须保持完整蛇形身体：低矮盘绕在画面中央，完整身体与多圈盘绕清晰可见，主体占画面宽度约 65%-85%，四周留白。
- 头部可以轻微抬起并面朝镜头，但身体和盘绕部分必须仍然是主要体量；禁止裁掉身体、尾部或盘绕。
- 必须是连续蛇身，不得改成非蛇类身体结构、只有一个小头，或把蛇身压缩成头下方的小小底座。`,
  spider: `- 蜘蛛以低矮爬行姿态居中，头胸部和腹部比例清楚，八条腿围绕身体自然展开并全部可见。
- 不要直立、不要拟人化站姿、不要丢腿，也不要把腿藏成不可辨认的一团。`,
  gecko: `- 守宫以低矮趴伏 / 爬行姿态居中，四肢向身体两侧自然支撑，脚趾可见，长尾完整可见并留白。
- 不要人形直立，不要裁掉尾巴或脚趾。`,
  parrot: `- 鹦鹉保持自然鸟类正面姿态，双足在身体下方支撑，翅膀贴合身体，头、喙、尾羽和羽毛轮廓完整可见。
- 不要四足动物姿态、不要人形手臂、不要额外肢体，也不要裁掉尾羽。`,
};

// 一键回退开关：true = 走风格化（默认）；false = 跳过风格化，直喂原图给三视图步骤。
export const STYLE_ENABLED = true;

// 把物种 / 已选装扮拼进模板。wearables 为空时插槽收敛为空行（不留「戴着」类空指令）。
export function buildAvatarStylePrompt(input: { species?: string; wearableIds?: string[] }): string {
  const speciesWord = (input.species && SPECIES_WORDS[input.species]) || input.species || '小宠物';
  const pose = (input.species && SPECIES_POSE_PROMPTS[input.species]) || DEFAULT_POSE_PROMPT;
  const words = (input.wearableIds || [])
    .map((id) => WEARABLE_PROMPT_WORDS[id])
    .filter(Boolean);
  const wearableLine = words.length ? `- 装扮：${words.join('、')}。\n` : '';
  return AVATAR_STYLE_PROMPT.replace('{species}', speciesWord).replace('{pose}', pose).replace('{wearables}\n', wearableLine);
}
