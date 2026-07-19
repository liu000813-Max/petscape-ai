import type { BoundsMm } from './geometry';
import { resolveViewerCatalogAsset } from '@petscape/server/contracts/viewer-catalog';

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

function temporaryAsset(asset: Omit<ViewerCatalogAsset, 'modelRef' | 'sizeSource' | 'sourceBoundsMm'>): ViewerCatalogAsset {
  const frozen = resolveViewerCatalogAsset(asset.assetKey);
  if (frozen.role !== asset.role) throw new Error(`临时目录角色漂移：${asset.assetKey}`);
  return {
    ...asset,
    sourceBoundsMm: { ...frozen.sourceBoundsMm },
    sizeSource: 'normalized_meta',
    modelRef: {
      kind: 'temporary_catalog',
      assetKey: asset.assetKey,
      checksum: frozen.checksum,
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
  }),
  temporaryAsset({
    assetKey: 'banana-bed',
    label: '香蕉小床',
    role: 'target',
    publicPath: '/scene-assets/banana-bed.norm.glb',
    metaPath: '/scene-assets/banana-bed.meta.json',
    bytes: 3_503_696,
  }),
  temporaryAsset({
    assetKey: 'cheese-play-mat',
    label: '奶酪游戏垫',
    role: 'target',
    publicPath: '/scene-assets/cheese-play-mat.norm.glb',
    metaPath: '/scene-assets/cheese-play-mat.meta.json',
    bytes: 3_441_712,
  }),
  temporaryAsset({
    assetKey: 'cloud-moss-platform',
    label: '云朵苔藓台',
    role: 'context',
    publicPath: '/scene-assets/cloud-moss-platform.norm.glb',
    metaPath: '/scene-assets/cloud-moss-platform.meta.json',
    bytes: 50_856,
  }),
  temporaryAsset({
    assetKey: 'star-spiral-ramp',
    label: '星星螺旋坡道',
    role: 'context',
    publicPath: '/scene-assets/star-spiral-ramp.norm.glb',
    metaPath: '/scene-assets/star-spiral-ramp.meta.json',
    bytes: 125_668,
  }),
] as const;

export function getViewerAsset(assetKey: string): ViewerCatalogAsset {
  const asset = VIEWER_ASSET_CATALOG.find((entry) => entry.assetKey === assetKey);
  if (!asset) throw new Error(`未知临时目录资产：${assetKey}`);
  return asset;
}
