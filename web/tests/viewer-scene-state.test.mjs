import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addContextItem,
  addPetReference,
  createSceneEditorState,
  draftDiffersFromLastConfirmation,
  getSceneConfirmationEligibility,
  isQuoteEligibleItem,
  removeSceneItem,
  resetAllSceneItems,
  resetSceneItem,
  snapSceneItemToSupport,
  updateCageDimensions,
  updateSceneItemTransform,
  validateCageDimensions,
} from '../app/lib/viewer/scene-state.ts';

const ownedRef = {
  kind: 'owned_asset',
  assetId: 'asset-target',
  checksum: 'a'.repeat(64),
  quoteEligible: true,
};

const temporaryRef = (assetKey) => ({
  kind: 'temporary_catalog',
  assetKey,
  checksum: 'b'.repeat(64),
  quoteEligible: false,
});
const item = ({
  instanceId,
  role,
  positionMm = { x: 0, y: 0, z: 0 },
  rotationYRad = 0,
  uniformScale = 1,
  sourceBoundsMm = { x: 100, y: 50, z: 80 },
  modelRef = temporaryRef(instanceId),
}) => ({
  instanceId,
  role,
  modelConfirmationId: role === 'target' ? 'model-confirmation-1' : null,
  modelRef,
  positionMm,
  rotationYRad,
  uniformScale,
  sourceBoundsMm,
  finalBoundsMm: {
    x: sourceBoundsMm.x * uniformScale,
    y: sourceBoundsMm.y * uniformScale,
    z: sourceBoundsMm.z * uniformScale,
  },
});

const draft = (overrides = {}) => ({
  schemaVersion: 'scene-draft.v1',
  stage: 'scene_editing',
  projectId: 'project-1',
  targetDesignItemId: 'design-item-1',
  targetModelConfirmationId: 'model-confirmation-1',
  targetInstanceId: 'target-1',
  cageMm: { width: 600, height: 400, depth: 400 },
  items: [
    item({
      instanceId: 'target-1',
      role: 'target',
      sourceBoundsMm: { x: 200, y: 80, z: 100 },
      modelRef: ownedRef,
    }),
  ],
  ...overrides,
});

test('参数化笼舍三轴必须是有限正数，修改尺寸立即参与确认校验', () => {
  assert.deepEqual(validateCageDimensions({ width: 600, height: 400, depth: 400 }), []);
  assert.deepEqual(
    validateCageDimensions({ width: 0, height: Number.NaN, depth: -1 }),
    ['cage_width_invalid', 'cage_height_invalid', 'cage_depth_invalid'],
  );

  const state = createSceneEditorState(draft());
  const resized = updateCageDimensions(state, { width: 150, height: 400, depth: 400 });
  assert.equal(resized.draft.cageMm.width, 150);
  assert.deepEqual(
    getSceneConfirmationEligibility(resized, {
      targetAssetReadable: true,
      savedRevisionMatches: true,
    }).blockingReasons,
    ['item_out_of_bounds:target-1:x'],
  );
});

test('场景始终恰有一个 target，target 不可删除，context 可添加和删除', () => {
  const state = createSceneEditorState(draft());
  const targetRemoval = removeSceneItem(state, 'target-1');
  assert.equal(targetRemoval.accepted, false);
  assert.deepEqual(targetRemoval.blockingReasons, ['target_cannot_be_removed']);
  assert.equal(targetRemoval.state, state);

  const context = item({
    instanceId: 'context-1',
    role: 'context',
    positionMm: { x: 180, y: 0, z: 0 },
  });
  const added = addContextItem(state, context);
  assert.equal(added.accepted, true);
  assert.deepEqual(added.state.draft.items.map(({ role }) => role), ['target', 'context']);

  const removed = removeSceneItem(added.state, 'context-1');
  assert.equal(removed.accepted, true);
  assert.deepEqual(removed.state.draft.items.map(({ role }) => role), ['target']);
});

test('拒绝伪装成 context 的 target、重复实例和会导致碰撞的 context', () => {
  const state = createSceneEditorState(draft());
  assert.deepEqual(addContextItem(state, item({ instanceId: 'bad-target', role: 'target' })).blockingReasons, [
    'context_role_required',
  ]);
  assert.deepEqual(addContextItem(state, item({ instanceId: 'target-1', role: 'context' })).blockingReasons, [
    'duplicate_instance_id',
  ]);
  assert.deepEqual(addContextItem(state, item({ instanceId: 'overlap', role: 'context' })).blockingReasons, [
    'item_collision:overlap:target-1',
  ]);
});

test('程序化花枝鼠参照具有冻结的通用比例且永不参与报价', () => {
  const state = createSceneEditorState(draft());
  const result = addPetReference(state, 'rat-reference-1', { x: 180, y: 0, z: 100 });
  assert.equal(result.accepted, true);
  const reference = result.state.draft.items.at(-1);
  assert.equal(reference.role, 'pet_reference');
  assert.equal(reference.modelRef.kind, 'temporary_catalog');
  assert.equal(reference.modelRef.assetKey, 'procedural-adult-rat-reference-v1');
  assert.equal(reference.modelRef.quoteEligible, false);
  assert.deepEqual(reference.sourceBoundsMm, { x: 220, y: 110, z: 80 });
  assert.equal(isQuoteEligibleItem(reference), false);
  assert.equal(isQuoteEligibleItem(state.draft.items[0]), true);

  const locked = updateSceneItemTransform(result.state, 'rat-reference-1', {
    rotationYRad: 1,
    uniformScale: 1.5,
  });
  assert.equal(locked.accepted, false);
  assert.deepEqual(locked.blockingReasons, ['pet_reference_locked']);
  assert.equal(locked.state, result.state);
});

test('位置、Y 轴旋转与等比缩放同步更新最终尺寸且不突变原 state', () => {
  const state = createSceneEditorState(draft());
  const result = updateSceneItemTransform(state, 'target-1', {
    positionMm: { x: 20, y: 0, z: 10 },
    rotationYRad: Math.PI / 2,
    uniformScale: 1.5,
  });
  assert.equal(result.accepted, true);
  assert.deepEqual(result.state.draft.items[0].positionMm, { x: 20, y: 0, z: 10 });
  assert.equal(result.state.draft.items[0].rotationYRad, Math.PI / 2);
  assert.equal(result.state.draft.items[0].uniformScale, 1.5);
  assert.deepEqual(result.state.draft.items[0].finalBoundsMm, { x: 300, y: 120, z: 150 });
  assert.equal(state.draft.items[0].uniformScale, 1);
});

test('旋转后的 world AABB 越界会阻断编辑并保留原 state', () => {
  const state = createSceneEditorState(
    draft({ cageMm: { width: 210, height: 400, depth: 400 } }),
  );
  const result = updateSceneItemTransform(state, 'target-1', { rotationYRad: Math.PI / 4 });
  assert.equal(result.accepted, false);
  assert.deepEqual(result.blockingReasons, ['item_out_of_bounds:target-1:x']);
  assert.equal(result.state, state);
});

test('碰撞编辑会被阻断，恰好接触不视作碰撞', () => {
  const context = item({
    instanceId: 'context-1',
    role: 'context',
    positionMm: { x: 180, y: 0, z: 0 },
  });
  const state = createSceneEditorState(draft({ items: [...draft().items, context] }));
  const blocked = updateSceneItemTransform(state, 'context-1', {
    positionMm: { x: 149, y: 0, z: 0 },
  });
  assert.equal(blocked.accepted, false);
  assert.deepEqual(blocked.blockingReasons, ['item_collision:context-1:target-1']);

  const touching = updateSceneItemTransform(state, 'context-1', {
    positionMm: { x: 150, y: 0, z: 0 },
  });
  assert.equal(touching.accepted, true);
});

test('水平支撑面 snap 到足够重叠的最高表面且不会形成碰撞', () => {
  const lower = item({
    instanceId: 'context-lower',
    role: 'context',
    sourceBoundsMm: { x: 220, y: 80, z: 120 },
  });
  const upper = item({
    instanceId: 'context-upper',
    role: 'context',
    positionMm: { x: 0, y: 80, z: 0 },
    sourceBoundsMm: { x: 140, y: 40, z: 100 },
  });
  const candidate = item({
    instanceId: 'context-candidate',
    role: 'context',
    positionMm: { x: 0, y: 250, z: 0 },
    sourceBoundsMm: { x: 80, y: 30, z: 60 },
  });
  const target = draft().items[0];
  const state = createSceneEditorState(
    draft({
      items: [
        { ...target, positionMm: { x: 200, y: 0, z: 100 } },
        lower,
        upper,
        candidate,
      ],
    }),
  );
  const snapped = snapSceneItemToSupport(state, 'context-candidate');
  assert.equal(snapped.accepted, true);
  assert.equal(snapped.state.draft.items.find(({ instanceId }) => instanceId === 'context-candidate').positionMm.y, 120);
});

test('单个重置与全部重置恢复各实例进入 state 时的 transform', () => {
  const context = item({
    instanceId: 'context-1',
    role: 'context',
    positionMm: { x: 180, y: 0, z: 0 },
  });
  const initial = createSceneEditorState(draft({ items: [...draft().items, context] }));
  const movedTarget = updateSceneItemTransform(initial, 'target-1', { positionMm: { x: -50, y: 0, z: 0 } }).state;
  const movedBoth = updateSceneItemTransform(movedTarget, 'context-1', {
    positionMm: { x: 220, y: 0, z: 0 },
    rotationYRad: 1,
    uniformScale: 0.8,
  }).state;

  const one = resetSceneItem(movedBoth, 'context-1');
  assert.equal(one.accepted, true);
  assert.deepEqual(one.state.draft.items.find(({ instanceId }) => instanceId === 'context-1'), context);
  assert.equal(one.state.draft.items[0].positionMm.x, -50);

  const all = resetAllSceneItems(movedBoth);
  assert.deepEqual(all.draft.items, initial.draft.items);
});

test('确认资格汇总模型确认、资产、保存、笼舍、越界与碰撞阻断原因', () => {
  const context = item({ instanceId: 'context-1', role: 'context' });
  const invalid = createSceneEditorState(
    draft({
      targetModelConfirmationId: '',
      cageMm: { width: 0, height: 400, depth: 400 },
      items: [draft().items[0], context],
    }),
  );
  const eligibility = getSceneConfirmationEligibility(invalid, {
    targetAssetReadable: false,
    savedRevisionMatches: false,
  });
  assert.equal(eligibility.eligible, false);
  assert.deepEqual(eligibility.blockingReasons, [
    'target_model_confirmation_missing',
    'target_asset_unreadable',
    'scene_revision_unsaved',
    'cage_width_invalid',
    'scene_target_invalid',
    'item_out_of_bounds:target-1:x',
    'item_out_of_bounds:context-1:x',
    'item_collision:target-1:context-1',
  ]);
});

test('确认后编辑能判定 draft 已不同，恢复相同内容后不误报', () => {
  const original = draft();
  const confirmation = {
    ...original,
    schemaVersion: 'scene-confirmation.v1',
    sceneId: 'scene-1',
    sceneRevision: 3,
    confirmedAt: '2026-07-19T08:00:00.000Z',
  };
  const state = createSceneEditorState(original, confirmation);
  assert.equal(draftDiffersFromLastConfirmation(state), false);

  const moved = updateSceneItemTransform(state, 'target-1', {
    positionMm: { x: 20, y: 0, z: 0 },
  }).state;
  assert.equal(draftDiffersFromLastConfirmation(moved), true);
  assert.equal(draftDiffersFromLastConfirmation(resetAllSceneItems(moved)), false);
});
