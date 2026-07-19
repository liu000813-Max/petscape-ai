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
    checksum: 'bbc2517c6503485c086d3b9e2987de1c75906426b5318d00e59ef232149d0112',
    sourceBoundsMm: { x: 274.148, y: 100, z: 194.543 },
  },
  {
    assetKey: 'banana-bed',
    role: 'target',
    checksum: 'a67ba88578cca7384364ea4a9e9d736fa86770f38cf64aa19a8ffda6e10b5dbe',
    sourceBoundsMm: { x: 234.107, y: 100, z: 94.742 },
  },
  {
    assetKey: 'cheese-play-mat',
    role: 'target',
    checksum: 'e3964778fd1aa6f39ee1bad9575beb87e909bafdd4646e77592393614cac213a',
    sourceBoundsMm: { x: 162.435, y: 60, z: 162.434 },
  },
  {
    assetKey: 'cloud-moss-platform',
    role: 'context',
    checksum: 'c1a24649398206aabc41de72625179f0c10a74ab345cbfc81a4be722ebef0254',
    sourceBoundsMm: { x: 198, y: 57.261, z: 67 },
  },
  {
    assetKey: 'star-spiral-ramp',
    role: 'context',
    checksum: '68fe1cd98c45e27db9795f5e4fd14d0b3d1228b1342ef0df5e2c414cd9f83da0',
    sourceBoundsMm: { x: 217.303, y: 144.16, z: 140.5 },
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
