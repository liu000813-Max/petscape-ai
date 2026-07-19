// WP-B7-1 临时 catalog 的显式沙箱 fixture。
// checksum 对应仓库内闭合网格 web/public/mockup-assets/mock-model.stl；它只用于
// 验证分析/计价骨架，不代表 cheese-lounge-bed 的正式制造文件或真实成本。
import type { SceneConfirmationCommerceInput } from '../contracts/scene-confirmation-commerce.ts';

export const B7_SANDBOX_SCENE_CONFIRMATION_ID =
  'b7-sandbox-scene-confirmation-closed-mesh-v0';

export const b7SandboxSceneConfirmationFixture = {
  schemaVersion: 'scene-confirmation-commerce.v0',
  sceneConfirmationId: B7_SANDBOX_SCENE_CONFIRMATION_ID,
  projectId: 'b7-sandbox-project',
  targetInstanceId: 'cheese-lounge-bed',
  assetRef: {
    kind: 'temporary_catalog',
    assetKey: 'cheese-lounge-bed-sandbox-closed-mesh-v0',
    sha256: '8191dcdaaa3d01993df661857e388c1cbe641b5d0443d47b692a856acf6d596d',
  },
  dimensionsMm: { x: 120, y: 119.022, z: 53.865 },
  rotationYRad: 0,
  uniformScale: 1,
  confirmedAt: '2026-07-19T00:00:00.000Z',
  source: 'sandbox_fixture',
  eligibility: 'sandbox_only',
} as const satisfies SceneConfirmationCommerceInput;
