import type { BoundsMm } from './geometry';

export const MAX_VIEWER_ASSET_BYTES = 4 * 1024 * 1024;

export type ViewerCatalogAsset = {
  assetKey: string;
  label: string;
  role: 'target' | 'context';
  publicPath: string;
  metaPath: string;
  bytes: number;
  sourceBoundsMm: BoundsMm;
  sizeSource: 'normalized_meta';
  modelRef: {
    kind: 'temporary_catalog';
    assetKey: string;
    checksum: string;
    quoteEligible: false;
  };
};

function temporaryAsset(asset: Omit<ViewerCatalogAsset, 'modelRef' | 'sizeSource'> & { checksum: string }): ViewerCatalogAsset {
  const { checksum, ...entry } = asset;
  return {
    ...entry,
    sizeSource: 'normalized_meta',
    modelRef: {
      kind: 'temporary_catalog',
      assetKey: asset.assetKey,
      checksum,
      quoteEligible: false,
    },
  };
}

export const VIEWER_ASSET_CATALOG: readonly ViewerCatalogAsset[] = [
  temporaryAsset({
    assetKey: 'cheese-lounge-bed',
    label: '奶酪软垫小床',
    role: 'target',
    publicPath: '/scene-assets/cheese-lounge-bed.norm.glb',
    metaPath: '/scene-assets/cheese-lounge-bed.meta.json',
    bytes: 3_503_856,
    checksum: 'bbc2517c6503485c086d3b9e2987de1c75906426b5318d00e59ef232149d0112',
    sourceBoundsMm: { x: 274.148, y: 100, z: 194.543 },
  }),
  temporaryAsset({
    assetKey: 'banana-bed',
    label: '香蕉小床',
    role: 'target',
    publicPath: '/scene-assets/banana-bed.norm.glb',
    metaPath: '/scene-assets/banana-bed.meta.json',
    bytes: 3_503_696,
    checksum: 'a67ba88578cca7384364ea4a9e9d736fa86770f38cf64aa19a8ffda6e10b5dbe',
    sourceBoundsMm: { x: 234.107, y: 100, z: 94.742 },
  }),
  temporaryAsset({
    assetKey: 'cheese-play-mat',
    label: '奶酪游戏垫',
    role: 'target',
    publicPath: '/scene-assets/cheese-play-mat.norm.glb',
    metaPath: '/scene-assets/cheese-play-mat.meta.json',
    bytes: 3_441_712,
    checksum: 'e3964778fd1aa6f39ee1bad9575beb87e909bafdd4646e77592393614cac213a',
    sourceBoundsMm: { x: 162.435, y: 60, z: 162.434 },
  }),
  temporaryAsset({
    assetKey: 'cloud-moss-platform',
    label: '云朵苔藓台',
    role: 'context',
    publicPath: '/scene-assets/cloud-moss-platform.norm.glb',
    metaPath: '/scene-assets/cloud-moss-platform.meta.json',
    bytes: 50_856,
    checksum: 'c1a24649398206aabc41de72625179f0c10a74ab345cbfc81a4be722ebef0254',
    sourceBoundsMm: { x: 198, y: 57.261, z: 67 },
  }),
  temporaryAsset({
    assetKey: 'star-spiral-ramp',
    label: '星星螺旋坡道',
    role: 'context',
    publicPath: '/scene-assets/star-spiral-ramp.norm.glb',
    metaPath: '/scene-assets/star-spiral-ramp.meta.json',
    bytes: 125_668,
    checksum: '68fe1cd98c45e27db9795f5e4fd14d0b3d1228b1342ef0df5e2c414cd9f83da0',
    sourceBoundsMm: { x: 217.303, y: 144.16, z: 140.5 },
  }),
] as const;

export function getViewerAsset(assetKey: string): ViewerCatalogAsset {
  const asset = VIEWER_ASSET_CATALOG.find((entry) => entry.assetKey === assetKey);
  if (!asset) throw new Error(`未知临时目录资产：${assetKey}`);
  return asset;
}
