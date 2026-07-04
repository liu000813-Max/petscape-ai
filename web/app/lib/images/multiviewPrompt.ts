// 一致性四视图网格 prompt（单点真相源）。
// gate1 新链：白底物品图 → fal edit 用本文件的 prompt 生成 2×2 正交四视图网格 →
// 服务端像素级裁切 4 张 → Tripo multiview_to_model。
// 本 prompt 之后会用 A2 实验调优后的版本原地替换，请保持「单点可换」：只改这里，不散落到 job 里。
//
// 硬约束（务必保留语义）：
//   - 与参考图是「同一个物体」，不得替换、想象或补全成别的物件
//   - 几何、比例、洞口/开口布局与参考图严格一致
//   - 纯白背景、正交视图（front/back/left/right）、无阴影、无透视畸变
//   - 2×2 网格布局，四格视角固定顺序：左上 front、右上 back、左下 left、右下 right
//     （与裁切逻辑 cropGridToViews 及 Tripo 上传顺序 FLBR 对齐）

export interface MultiviewPromptInput {
  itemName: string;
}

export function buildMultiviewGridPrompt({ itemName }: MultiviewPromptInput): string {
  return `参考图是一个白底的单个物品：${itemName}。请把「同一个物品」渲染成一张 2×2 的正交四视图网格图。

硬性要求：
1. 必须是参考图中那个完全相同的物体——保持其几何形状、整体比例、所有洞口/开口/镂空的位置和大小、颜色、材质、关键结构。不得替换成别的物体，不得凭空想象或增删结构。
2. 四个格子分别是该物体的正交视图，固定顺序：左上=正视图(front)、右上=后视图(back)、左下=左视图(left)、右下=右视图(right)。每个视图都是平行投影（正交、无透视畸变），相机正对该面。
3. 纯白背景(#FFFFFF)，无阴影、无地面、无倒影、无文字标注、无网格线、无宠物、无其它装饰。
4. 物体在每个格子内居中、完整、边缘清晰，四个视图使用一致的缩放和光照，看起来是同一个物体从不同角度拍摄。

输出单张正方形图片，包含上述 2×2 四视图。`;
}
