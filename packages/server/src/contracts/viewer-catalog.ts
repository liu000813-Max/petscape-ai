// Server-verifiable identity facts for the frozen WP-B4/B5 temporary catalog.
// Web-only labels and public paths are intentionally kept out of this registry.
export type ViewerCatalogRole = 'target' | 'context' | 'pet_reference';

export type ViewerCatalogAsset = Readonly<{
  assetKey: string;
  role: ViewerCatalogRole;
  checksum: string;
  sourceBoundsMm: Readonly<{ x: number; y: number; z: number }>;
}>;

export const VIEWER_CATALOG_ASSETS = [
  {
    assetKey: 'cheese-lounge-bed',
    role: 'target',
    checksum: 'ad7ff9f2b6e2f53ab0908dee9caa58e23f22b7319962bd57931b991bd56d61b5',
    sourceBoundsMm: { x: 274.148, y: 100, z: 194.543 },
  },
  {
    assetKey: 'banana-bed',
    role: 'target',
    checksum: '6cc74ace31d4899b275279b4c8ceb2902597ac819a221b1fa2b87ddbec3e0a3d',
    sourceBoundsMm: { x: 234.107, y: 100, z: 94.742 },
  },
  {
    assetKey: 'cheese-play-mat',
    role: 'target',
    checksum: '0442e89e3948a6ff77bcb45491e4269dc86976632dcf5383950742fe4da730e1',
    sourceBoundsMm: { x: 162.435, y: 60, z: 162.434 },
  },
  {
    assetKey: 'cloud-moss-platform',
    role: 'context',
    checksum: '3e003e2747c9ba2571cf2108a6b953746b18da09b0e89cfb9b6dfe1acd404c01',
    sourceBoundsMm: { x: 84.469, y: 57.261, z: 83.799 },
  },
  {
    assetKey: 'star-spiral-ramp',
    role: 'context',
    checksum: '80bd234ba51d598d517fe8b252652c0430ac5b5bf4cb444db877e3ea8e40530f',
    sourceBoundsMm: { x: 144.39, y: 144.16, z: 114.169 },
  },
  {
    assetKey: 'procedural-adult-rat-reference-v1',
    role: 'pet_reference',
    checksum: '9a330c398ac69a5968e94688c73701848a3470140604a054dc88278d40448e3d',
    sourceBoundsMm: { x: 220, y: 110, z: 80 },
  },
] as const satisfies readonly ViewerCatalogAsset[];

export function resolveViewerCatalogAsset(assetKey: string): ViewerCatalogAsset {
  const asset = VIEWER_CATALOG_ASSETS.find((entry) => entry.assetKey === assetKey);
  if (!asset) throw new Error(`未知临时目录资产：${assetKey}`);
  return asset;
}
