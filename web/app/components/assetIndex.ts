// 批次3 资产索引：模块 id → 3D 场景渲染方式的映射表。
//
// 背景（见 docs/specs/batch3-preview-commerce.md 头部「批次A 现状注记」）：
// 批次A 最初因 Tripo 账户余额耗尽只有 source.png；后改路由 Meshy 引擎重新生成，
// 2026-07-04 产出 5 个真实 GLB（cheese-lounge-bed / banana-bed / banana-layer-pad /
// hanging-climb-baskets / cheese-play-mat，见 assets-3d/manifest.json，9/9 ok）。
// 这 5 个已过 tools/bake-assets/normalize_asset.py 归一化，烘焙进 public/scene-assets/，
// 下表指向真实产出（placeholder: false）。
//
// starry-hideout 仍未有批次A 真实产出，继续借用老仓库 scene-lab 占位 GLB（占位语义见下）。
// 其余 7 个模块无 GLB，走 billboard。
//
// 每一条都标了 placeholder: true/false，方便一眼看出哪些是占位、哪些（billboard）是设计如此。

export type AssetEntry =
  | {
      kind: 'glb';
      id: string;
      glbPath: string; // public/ 下路径，浏览器可直接 fetch
      metaPath: string; // .meta.json：{ heightMm, footprint: { xMm, zMm } }
      materialMode?: 'clay' | 'solid' | 'preserve';
      fitStrategy?: 'contain-collision';
      placeholder: boolean; // true = 借用老仓库 scene-lab 占位资产，非该模块真实产出
      placeholderNote?: string;
    }
  | {
      kind: 'billboard';
      id: string;
      imagePath: string; // 白底商品图（public/assets/pet-products/{id}.png）
      placeholder: false; // billboard 是设计如此（batch3 spec §3），不是"占位"
    };

// 5 个真实 GLB（批次A Meshy 产出，见 assets-3d/manifest.json）+ 1 个老仓库占位（starry-hideout）。
export const assetIndex: Record<string, AssetEntry> = {
  // ---- 有 GLB（批次A 真实产出，2026-07-04 Meshy 生成 + normalize_asset.py 归一化）----
  'cheese-lounge-bed': {
    kind: 'glb',
    id: 'cheese-lounge-bed',
    glbPath: '/scene-assets/cheese-lounge-bed.norm.glb',
    metaPath: '/scene-assets/cheese-lounge-bed.meta.json',
    placeholder: false,
  },
  'banana-bed': {
    kind: 'glb',
    id: 'banana-bed',
    glbPath: '/scene-assets/banana-bed.norm.glb',
    metaPath: '/scene-assets/banana-bed.meta.json',
    placeholder: false,
  },
  'banana-layer-pad': {
    kind: 'glb',
    id: 'banana-layer-pad',
    glbPath: '/scene-assets/banana-layer-pad.norm.glb',
    metaPath: '/scene-assets/banana-layer-pad.meta.json',
    placeholder: false,
  },
  'hanging-climb-baskets': {
    kind: 'glb',
    id: 'hanging-climb-baskets',
    glbPath: '/scene-assets/hanging-climb-baskets.norm.glb',
    metaPath: '/scene-assets/hanging-climb-baskets.meta.json',
    placeholder: false,
  },
  'cheese-play-mat': {
    kind: 'glb',
    id: 'cheese-play-mat',
    glbPath: '/scene-assets/cheese-play-mat.norm.glb',
    metaPath: '/scene-assets/cheese-play-mat.meta.json',
    placeholder: false,
  },
  'pink-teapot': {
    kind: 'glb',
    id: 'pink-teapot',
    glbPath: '/scene-assets/pink-teapot.norm.glb',
    metaPath: '/scene-assets/pink-teapot.meta.json',
    placeholder: false,
  },
  'cloud-moss-platform': {
    kind: 'glb',
    id: 'cloud-moss-platform',
    glbPath: '/scene-assets/cloud-moss-platform.norm.glb',
    metaPath: '/scene-assets/cloud-moss-platform.meta.json',
    materialMode: 'preserve',
    placeholder: false,
  },
  'star-spiral-ramp': {
    kind: 'glb',
    id: 'star-spiral-ramp',
    glbPath: '/scene-assets/star-spiral-ramp.norm.glb',
    metaPath: '/scene-assets/star-spiral-ramp.meta.json',
    materialMode: 'preserve',
    placeholder: false,
  },
  'cloud-hammock': {
    kind: 'glb',
    id: 'cloud-hammock',
    glbPath: '/scene-assets/cloud-hammock.norm.glb',
    metaPath: '/scene-assets/cloud-hammock.meta.json',
    materialMode: 'preserve',
    placeholder: false,
  },
  'wood-dna-ladder': {
    kind: 'glb',
    id: 'wood-dna-ladder',
    glbPath: '/scene-assets/wood-dna-ladder.norm.glb',
    metaPath: '/scene-assets/wood-dna-ladder.meta.json',
    materialMode: 'preserve',
    placeholder: false,
  },
  'pink-teapot-large-hideout': {
    kind: 'glb',
    id: 'pink-teapot-large-hideout',
    glbPath: '/scene-assets/pink-teapot-large-hideout.meshy.glb',
    metaPath: '/scene-assets/pink-teapot-large-hideout.meta.json',
    materialMode: 'preserve',
    fitStrategy: 'contain-collision',
    placeholder: false,
  },
  'pink-teapot-small-hideout': {
    kind: 'glb',
    id: 'pink-teapot-small-hideout',
    glbPath: '/scene-assets/pink-teapot-small-hideout.meshy.glb',
    metaPath: '/scene-assets/pink-teapot-small-hideout.meta.json',
    materialMode: 'preserve',
    fitStrategy: 'contain-collision',
    placeholder: false,
  },
  'cloud-moss-teapot-platform': {
    kind: 'glb',
    id: 'cloud-moss-teapot-platform',
    glbPath: '/scene-assets/cloud-moss-teapot-platform.meshy.glb',
    metaPath: '/scene-assets/cloud-moss-teapot-platform.meta.json',
    materialMode: 'preserve',
    fitStrategy: 'contain-collision',
    placeholder: false,
  },
  's-cloud-star-ramp': {
    kind: 'glb',
    id: 's-cloud-star-ramp',
    glbPath: '/scene-assets/s-cloud-star-ramp.meshy.glb',
    metaPath: '/scene-assets/s-cloud-star-ramp.meta.json',
    materialMode: 'preserve',
    fitStrategy: 'contain-collision',
    placeholder: false,
  },
  'cloud-star-bowl-upper': {
    kind: 'glb',
    id: 'cloud-star-bowl-upper',
    glbPath: '/scene-assets/cloud-star-bowl-upper.meshy.glb',
    metaPath: '/scene-assets/cloud-star-bowl-upper.meta.json',
    materialMode: 'preserve',
    fitStrategy: 'contain-collision',
    placeholder: false,
  },
  'cloud-star-bowl-lower': {
    kind: 'glb',
    id: 'cloud-star-bowl-lower',
    glbPath: '/scene-assets/cloud-star-bowl-lower.meshy.glb',
    metaPath: '/scene-assets/cloud-star-bowl-lower.meta.json',
    materialMode: 'preserve',
    fitStrategy: 'contain-collision',
    placeholder: false,
  },
  'wood-dna-moss-ladder': {
    kind: 'glb',
    id: 'wood-dna-moss-ladder',
    glbPath: '/scene-assets/wood-dna-moss-ladder.meshy.glb',
    metaPath: '/scene-assets/wood-dna-moss-ladder.meta.json',
    materialMode: 'preserve',
    fitStrategy: 'contain-collision',
    placeholder: false,
  },

  // ---- 有 GLB（占位，借用老仓库 scene-lab 资产；批次A 尚无该模块真实产出）----
  'starry-hideout': {
    kind: 'glb',
    id: 'starry-hideout',
    glbPath: '/scene-assets/starry-hideout.norm.glb',
    metaPath: '/scene-assets/starry-hideout.meta.json',
    placeholder: true,
    placeholderNote: '借用老仓库 scene-lab custom-item.norm.glb（立体躲屋结构语义匹配"星月魔法躲屋"）；批次A 尚未产出该模块',
  },

  // ---- billboard（无 GLB，白底商品图立牌；13 - 5 - 1 = 7 项）----
  'vine-foraging-tray': { kind: 'billboard', id: 'vine-foraging-tray', imagePath: '/assets/pet-products/vine-foraging-tray.png', placeholder: false },
  'cheese-storage-tower': { kind: 'billboard', id: 'cheese-storage-tower', imagePath: '/assets/pet-products/cheese-storage-tower.png', placeholder: false },
  'sunny-climb-station': { kind: 'billboard', id: 'sunny-climb-station', imagePath: '/assets/pet-products/sunny-climb-station.png', placeholder: false },
  'hanging-z-ladder': { kind: 'billboard', id: 'hanging-z-ladder', imagePath: '/assets/pet-products/hanging-z-ladder.png', placeholder: false },
  'star-bridge-hide': { kind: 'billboard', id: 'star-bridge-hide', imagePath: '/assets/pet-products/star-bridge-hide.png', placeholder: false },
  'mushroom-climb-tree': { kind: 'billboard', id: 'mushroom-climb-tree', imagePath: '/assets/pet-products/mushroom-climb-tree.png', placeholder: false },
  'spiral-star-perch': { kind: 'billboard', id: 'spiral-star-perch', imagePath: '/assets/pet-products/spiral-star-perch.png', placeholder: false },
};

export function getAssetEntry(moduleId: string): AssetEntry | undefined {
  return assetIndex[moduleId];
}
