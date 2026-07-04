// PetScape 工作台状态模型（PRD §4）。表单是真相源，canvasItems 是画布内容真相源。
// tldraw snapshot 只存视图层（卡片位置/相机），不做第二内容真相源。
// T1 只产 scene2d + briefing/designing2d；tuning3d/门1门2 字段留给 T3。

export type UserState = 'briefing' | 'designing2d' | 'tuning3d';

export type CanvasItemStatus = 'generating' | 'ready' | 'failed';

// 画布上的一张卡（场景/变体/白底物品/3D 预览）。
// scene2d=2D 场景图（T1）、item2d=门1 抠出的白底物品图（T3）、model3d=3D 生成结果（T3）。
export type CanvasItemKind = 'scene2d' | 'item2d' | 'model3d';

export interface CanvasItem {
  id: string;
  kind: CanvasItemKind;
  name: string; // 卡片标签，如「方案 A · 蘑菇小屋」/「白底物品图」/「3D 模型」
  status: CanvasItemStatus;
  imagePath?: string; // /generated/{projectId}/scene-x.png（scene2d/item2d ready 后填）
  glbPath?: string; // /generated/{projectId}/model-x.glb（model3d ready 后填）
  prompt?: string;
  parentId?: string; // 派生源（T2 变体 / T3 白底←场景、3D←白底）
  error?: string;
  createdAt: string;
}

// 3D 预览调参（门 2 前用户可调的真实能力参数）。
export interface ModelConfig {
  scaleMm: number; // 整体最长边目标尺寸（80–160mm），门 2 时驱动 normalize
  color: string; // 渲染层 baseColorFactor（hex，如 #C08A5A）
  material: string; // 材质预设标签（PLA 木纹/PLA 哑光/…），当前仅影响渲染呈现
}

// 门 1 提交的 3D 生成任务状态（in-memory；前端轮询）。
export interface Model3dJob {
  status: 'running' | 'ready' | 'failed';
  taskId?: string; // 3D 引擎任务 id（Meshy image-to-3d）
  glbPath?: string; // 原始带材质 GLB（渲染预览用）
  repairedGlbPath?: string; // 修复后几何（切片用）
  printabilityIssues?: string[];
  progress?: number; // 0–100
  error?: string;
}

// 门 2 切片产物状态（in-memory；前端轮询）。
export interface SliceJob {
  status: 'running' | 'ready' | 'failed';
  stlPath?: string;
  gcodePath?: string;
  estimatedTime?: string;
  filament?: string;
  actualExtentsMm?: number[];
  warnings?: string[];
  progress?: number;
  error?: string;
}

export interface Brief {
  species: string; // 必填，英文 slug（fancy_rat/hamster/leopard_gecko/crested_gecko/bearded_dragon）
  petSize?: string; // 必填
  style?: string; // 必填
  item?: string; // 目标物品，不必填（spec §0）；B1 起从表单 UI 移除，门 1 逻辑仍在用
  scene?: string; // 使用场景；B1 起从表单 UI 移除
  taboos: string[]; // 禁忌与安全
  photoPath?: string;
  petName?: string; // 宠物昵称
  traits?: string[]; // 性格/习性多选（爱钻洞/爱攀爬/爱觅食/爱社交/胆小怕光/爱啃咬）
  vibe?: string; // 氛围描述（多行自由文本）
  petPhotoUrl?: string; // 宠物照片（/uploads/{projectId}/pet.*）
  cagePhotoUrl?: string; // 笼箱照片（/uploads/{projectId}/cage.*）
}

export interface PetScapeProject {
  id: string;
  userState: UserState;
  brief: Brief;
  canvasItems: CanvasItem[]; // 画布内容真相源
  canvasSnapshot?: unknown; // tldraw store snapshot：仅视图层（位置/相机），刷新恢复布局用
  generating: boolean; // 是否有场景生成 job 在跑（前端轮询依据）
  // ---- T3 门1/门2 状态（tuning3d 用；刷新恢复靠这些字段而非 canvasItems 反推）----
  gate1SceneId?: string; // 门 1 选中的场景卡 id
  itemName?: string; // 门 1 指定的物品名（如「蘑菇躲避屋」）
  model3d?: Model3dJob; // 3D 生成任务
  modelConfig?: ModelConfig; // 3D 预览调参（真实能力三件）
  slice?: SliceJob; // 门 2 切片产物
  // ——接驳层预铺（批次0.5）：以下三字段由批次1/2 消费；字段结构改动须经主控——
  avatar?: AvatarJob; // 批次1：照片→风格化→3视图→Tripo 3D
  avatarSlice?: AvatarSliceJob; // 批次1：宠物模型自动切片（不挖腔）
  vibeRender?: VibeRenderJob; // 批次2：笼箱 vibe 改造效果图
  createdAt: string;
  updatedAt: string;
}

// 批次1：宠物 3D 生成任务（stage 供前端管线阶段可视化）
export interface AvatarJob {
  status: 'idle' | 'running' | 'failed' | 'done';
  stage?: 'styling' | 'triview' | 'modeling';
  styledImageUrl?: string; // 风格化立绘（中间反馈）
  modelUrl?: string; // 最终 GLB
  error?: string;
}

// 批次1：宠物模型切片（按体型档映射 scaleMm；同 mm 幂等）
export interface AvatarSliceJob {
  status: 'idle' | 'running' | 'failed' | 'done';
  scaleMm?: number;
  stlUrl?: string;
  gcodeUrl?: string;
  weightG?: number;
  printTimeMin?: number;
  error?: string;
}

// 批次2：vibe 环境改造效果图
export interface VibeRenderJob {
  status: 'idle' | 'running' | 'failed' | 'done';
  beforeUrl?: string; // 用户笼箱原图
  afterUrl?: string; // fal 改造后图
  error?: string;
}

// 门 2 前的默认参数（用户未调时的落点）。
export function defaultModelConfig(): ModelConfig {
  return { scaleMm: 120, color: '#C08A5A', material: 'PLA 木纹' };
}

// 必填三项校验（spec §0）：物种 + 尺寸 + 风格
export function missingRequiredFields(brief: Brief): string[] {
  const missing: string[] = [];
  if (!brief.species?.trim()) missing.push('物种');
  if (!brief.petSize?.trim()) missing.push('宠物尺寸');
  if (!brief.style?.trim()) missing.push('风格');
  return missing;
}
