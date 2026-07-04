// 宠物风格化立绘 prompt（单点真相源，用户亲手调这里）。
// avatarJob 步骤1「风格化」用本文件的 prompt 把用户上传的宠物照喂给 fal edit：
//   输出「游戏角色/手办风格、白底、单一主体居中、正面站立固定姿态」的立绘，
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
- 单一主体，画面正中央，占画面高度约 60%-80%，四周留白。
- 正面站立、面朝镜头的固定姿态；身体直立、对称、居中，四肢自然着地。
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

// 一键回退开关：true = 走风格化（默认）；false = 跳过风格化，直喂原图给三视图步骤。
export const STYLE_ENABLED = true;

// 把物种 / 已选装扮拼进模板。wearables 为空时插槽收敛为空行（不留「戴着」类空指令）。
export function buildAvatarStylePrompt(input: { species?: string; wearableIds?: string[] }): string {
  const speciesWord = (input.species && SPECIES_WORDS[input.species]) || input.species || '小宠物';
  const words = (input.wearableIds || [])
    .map((id) => WEARABLE_PROMPT_WORDS[id])
    .filter(Boolean);
  const wearableLine = words.length ? `- 装扮：${words.join('、')}。\n` : '';
  return AVATAR_STYLE_PROMPT.replace('{species}', speciesWord).replace('{wearables}\n', wearableLine);
}
