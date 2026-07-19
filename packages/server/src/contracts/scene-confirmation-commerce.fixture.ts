// WP-SEAM-0 双方共用的 conformance fixture。
// B 线 producer 应输出与这些形状兼容的数据，再由共享 Schema 解析。
import type { SceneConfirmationCommerceInput } from './scene-confirmation-commerce.ts';

export const ownedAssetSceneConfirmationFixture = {
  schemaVersion: 'scene-confirmation-commerce.v0',
  sceneConfirmationId: 'scn_confirm_01',
  projectId: 'project_01',
  targetInstanceId: 'target_cheese_bed_01',
  assetRef: {
    kind: 'owned_asset',
    assetId: 'asset_01',
    sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  },
  dimensionsMm: { x: 180, y: 120, z: 75 },
  rotationYRad: 0.25,
  uniformScale: 1.5,
  confirmedAt: '2026-07-19T08:30:00.000Z',
  source: 'viewer_scene_confirmation',
  eligibility: 'formal_candidate',
} as const satisfies SceneConfirmationCommerceInput;

export const temporaryCatalogSceneConfirmationFixture = {
  ...ownedAssetSceneConfirmationFixture,
  sceneConfirmationId: 'scn_confirm_sandbox_01',
  assetRef: {
    kind: 'temporary_catalog',
    assetKey: 'cheese-lounge-bed',
    sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  },
  source: 'sandbox_fixture',
  eligibility: 'sandbox_only',
} as const satisfies SceneConfirmationCommerceInput;

