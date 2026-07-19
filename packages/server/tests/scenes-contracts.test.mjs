import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CreateDesignItemRequestSchema,
  CreateModelConfirmationRequestSchema,
  ConfirmSceneRequestSchema,
  ModelConfirmationResponseSchema,
  ModelRefSchema,
  RevisionConflictResponseSchema,
  SceneRecordSchema,
  SceneConfirmationSnapshotSchema,
  SceneDraftSchema,
  SceneItemSchema,
  ViewerStageSchema,
} from '../src/contracts/scenes.ts';
import { resolveViewerCatalogAsset } from '../src/contracts/viewer-catalog.ts';

const checksum = 'a'.repeat(64);
const bounds = { x: 274.148, y: 100, z: 194.543 };
const temporaryModel = {
  kind: 'temporary_catalog',
  assetKey: 'cheese-lounge-bed',
  checksum,
  quoteEligible: false,
};

function target(overrides = {}) {
  return {
    instanceId: 'target-1',
    role: 'target',
    modelConfirmationId: 'model-confirmation-1',
    modelRef: temporaryModel,
    positionMm: { x: 0, y: 0, z: 0 },
    rotationYRad: 0,
    uniformScale: 1,
    sourceBoundsMm: bounds,
    finalBoundsMm: bounds,
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    instanceId: 'context-1',
    role: 'context',
    modelConfirmationId: null,
    modelRef: {
      kind: 'temporary_catalog',
      assetKey: 'cloud-moss-platform',
      checksum: 'b'.repeat(64),
      quoteEligible: false,
    },
    positionMm: { x: 100, y: 0, z: 0 },
    rotationYRad: 0,
    uniformScale: 1,
    sourceBoundsMm: { x: 198, y: 57.261, z: 67 },
    finalBoundsMm: { x: 198, y: 57.261, z: 67 },
    ...overrides,
  };
}

function draft(items = [target(), context()]) {
  return {
    schemaVersion: 'scene-draft.v1',
    stage: 'scene_editing',
    projectId: 'project-1',
    targetDesignItemId: 'design-item-1',
    targetModelConfirmationId: 'model-confirmation-1',
    targetInstanceId: 'target-1',
    cageMm: { width: 600, height: 400, depth: 400 },
    items,
  };
}

test('ViewerStageSchema：两阶段是显式且封闭的状态', () => {
  assert.equal(ViewerStageSchema.parse('model_review'), 'model_review');
  assert.equal(ViewerStageSchema.parse('scene_editing'), 'scene_editing');
  assert.equal(ViewerStageSchema.safeParse('quoting').success, false);
});

test('ModelRefSchema：temporary_catalog 强制 sandbox 且不可报价', () => {
  assert.deepEqual(ModelRefSchema.parse(temporaryModel), temporaryModel);
  assert.equal(ModelRefSchema.safeParse({ ...temporaryModel, quoteEligible: true }).success, false);
  assert.equal(ModelRefSchema.safeParse({ ...temporaryModel, checksum: '' }).success, false);
});

test('ModelRefSchema：owned_asset 只接受非空 SHA-256 checksum', () => {
  assert.equal(
    ModelRefSchema.safeParse({
      kind: 'owned_asset',
      assetId: 'asset-1',
      checksum,
      quoteEligible: true,
    }).success,
    true,
  );
  assert.equal(
    ModelRefSchema.safeParse({
      kind: 'owned_asset',
      assetId: 'asset-1',
      checksum: '',
      quoteEligible: true,
    }).success,
    false,
  );
});

test('SceneItemSchema：只允许统一缩放与绕 Y 轴旋转，最终尺寸必须匹配', () => {
  assert.equal(SceneItemSchema.safeParse(target()).success, true);
  assert.equal(SceneItemSchema.safeParse({ ...target(), scaleX: 1 }).success, false);
  assert.equal(SceneItemSchema.safeParse({ ...target(), rotationXRad: 1 }).success, false);
  assert.equal(
    SceneItemSchema.safeParse({ ...target(), uniformScale: 2, finalBoundsMm: bounds }).success,
    false,
  );
});

test('SceneDraftSchema：必须恰有一个 target，且与冻结的确认和实例引用一致', () => {
  assert.equal(SceneDraftSchema.safeParse(draft()).success, true);
  assert.equal(SceneDraftSchema.safeParse(draft([context()])).success, false);
  assert.equal(SceneDraftSchema.safeParse(draft([target(), target({ instanceId: 'target-2' })])).success, false);
  assert.equal(
    SceneDraftSchema.safeParse(draft([target({ modelConfirmationId: 'other-confirmation' }), context()])).success,
    false,
  );
});

test('SceneDraftSchema：context 永不携带目标确认，也不能成为 targetInstanceId', () => {
  assert.equal(SceneDraftSchema.safeParse(draft([target(), context({ modelConfirmationId: 'leak' })])).success, false);
  assert.equal(SceneDraftSchema.safeParse({ ...draft(), targetInstanceId: 'context-1' }).success, false);
});

test('SceneDraftSchema：instanceId 在同一场景内必须唯一', () => {
  assert.equal(
    SceneDraftSchema.safeParse(draft([target(), context({ instanceId: 'target-1' })])).success,
    false,
  );
});

test('SceneConfirmationSnapshotSchema：冻结 schema version、revision 与完整场景', () => {
  const snapshot = {
    ...draft(),
    schemaVersion: 'scene-confirmation.v1',
    sceneId: 'scene-1',
    sceneRevision: 4,
    confirmedAt: '2026-07-19T08:00:00.000Z',
  };
  assert.equal(SceneConfirmationSnapshotSchema.safeParse(snapshot).success, true);
  assert.equal(
    SceneConfirmationSnapshotSchema.safeParse({ ...snapshot, schemaVersion: 'scene-confirmation.v2' }).success,
    false,
  );
});

test('revision contract：保存冲突结构化，确认请求绑定精确 revision', () => {
  assert.equal(
    RevisionConflictResponseSchema.safeParse({
      error: 'revision_conflict',
      expectedRevision: 2,
      currentRevision: 3,
    }).success,
    true,
  );
  assert.deepEqual(ConfirmSceneRequestSchema.parse({ sceneId: 'scene-1', sceneRevision: 3 }), {
    sceneId: 'scene-1',
    sceneRevision: 3,
  });
  assert.equal(ConfirmSceneRequestSchema.safeParse({ sceneId: 'scene-1' }).success, false);
});

test('persistence contract：DesignItem 与 ModelConfirmation 输入严格且冻结缩放结果', () => {
  assert.deepEqual(CreateDesignItemRequestSchema.parse({ name: '奶酪躺椅' }), { name: '奶酪躺椅' });
  assert.equal(CreateDesignItemRequestSchema.safeParse({ name: '' }).success, false);

  const input = {
    modelRef: temporaryModel,
    sourceBoundsMm: bounds,
    uniformScale: 1.25,
    finalBoundsMm: { x: bounds.x * 1.25, y: 125, z: bounds.z * 1.25 },
  };
  assert.equal(CreateModelConfirmationRequestSchema.safeParse(input).success, true);
  assert.equal(
    CreateModelConfirmationRequestSchema.safeParse({ ...input, finalBoundsMm: bounds }).success,
    false,
  );
  assert.equal(
    ModelConfirmationResponseSchema.safeParse({
      id: 'model-confirmation-1',
      designItemId: 'design-item-1',
      ...input,
      confirmedAt: '2026-07-19T09:00:00.000Z',
    }).success,
    true,
  );
});

test('persistence contract：SceneRecord 带服务端 id/revision，draft 字段保持唯一正本', () => {
  assert.equal(
    SceneRecordSchema.safeParse({
      id: 'scene-1',
      revision: 3,
      draft: draft(),
      updatedAt: '2026-07-19T09:00:00.000Z',
    }).success,
    true,
  );
  assert.equal(
    SceneRecordSchema.safeParse({ id: 'scene-1', revision: -1, draft: draft(), updatedAt: 'bad' }).success,
    false,
  );
});

test('temporary catalog registry：服务端冻结 key、role、checksum 与原始尺寸', () => {
  const cheese = resolveViewerCatalogAsset('cheese-lounge-bed');
  assert.equal(cheese.role, 'target');
  assert.equal(cheese.checksum, 'bbc2517c6503485c086d3b9e2987de1c75906426b5318d00e59ef232149d0112');
  assert.deepEqual(cheese.sourceBoundsMm, { x: 274.148, y: 100, z: 194.543 });
  assert.throws(() => resolveViewerCatalogAsset('forged-catalog-item'), /未知临时目录资产/);
});
