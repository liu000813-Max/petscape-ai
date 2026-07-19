import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TARGET_INSPECTION_ASSETS,
  confirmInspectionModel,
  createModelInspectionState,
  markInspectionLoadError,
  markInspectionLoadReady,
  retryInspectionLoad,
  selectInspectionAsset,
  setInspectionUniformScale,
} from '../app/lib/viewer/model-inspection.ts';

test('单品检视只暴露冻结的三个 target 测试资产', () => {
  assert.deepEqual(
    TARGET_INSPECTION_ASSETS.map((asset) => asset.assetKey).sort(),
    ['banana-bed', 'cheese-lounge-bed', 'cheese-play-mat'],
  );
  assert.equal(TARGET_INSPECTION_ASSETS.every((asset) => asset.role === 'target'), true);
});

test('快速切换后旧请求结果不能覆盖当前模型加载状态', () => {
  const initial = createModelInspectionState('cheese-lounge-bed');
  const banana = selectInspectionAsset(initial, 'banana-bed');
  const mat = selectInspectionAsset(banana, 'cheese-play-mat');

  assert.equal(markInspectionLoadReady(mat, banana.loadRequestId), mat);
  assert.equal(markInspectionLoadError(mat, banana.loadRequestId, '旧请求失败'), mat);

  const ready = markInspectionLoadReady(mat, mat.loadRequestId);
  assert.equal(ready.loadStatus, 'ready');
  assert.equal(ready.assetKey, 'cheese-play-mat');
});

test('加载失败可重试且异常模型不能确认', () => {
  const initial = createModelInspectionState('cheese-lounge-bed');
  const failed = markInspectionLoadError(initial, initial.loadRequestId, 'HTTP 404');

  assert.equal(failed.loadStatus, 'error');
  assert.equal(failed.loadError, 'HTTP 404');
  assert.throws(() => confirmInspectionModel(failed, new Date().toISOString()), /加载完成/);

  const retried = retryInspectionLoad(failed);
  assert.equal(retried.loadStatus, 'loading');
  assert.equal(retried.loadError, null);
  assert.equal(retried.loadRequestId, failed.loadRequestId + 1);
});

test('统一比例同步计算三轴最终 mm，不提供逐轴形变', () => {
  const initial = createModelInspectionState('banana-bed');
  const scaled = setInspectionUniformScale(initial, 1.25);

  assert.equal(scaled.uniformScale, 1.25);
  assert.deepEqual(scaled.finalBoundsMm, { x: 292.634, y: 125, z: 118.428 });
  assert.throws(() => setInspectionUniformScale(initial, 0), /统一比例/);
});

test('每次确认追加不可变 ModelConfirmation 快照并进入场景占位阶段', () => {
  const initial = createModelInspectionState('cheese-lounge-bed');
  const ready = markInspectionLoadReady(initial, initial.loadRequestId);
  const first = confirmInspectionModel(ready, '2026-07-19T10:00:00.000Z');

  assert.equal(first.stage, 'scene_editing');
  assert.equal(first.confirmations.length, 1);
  assert.deepEqual(first.confirmations[0], {
    modelRef: {
      kind: 'temporary_catalog',
      assetKey: 'cheese-lounge-bed',
      checksum: 'ad7ff9f2b6e2f53ab0908dee9caa58e23f22b7319962bd57931b991bd56d61b5',
      quoteEligible: false,
    },
    sourceBoundsMm: { x: 274.148, y: 100, z: 194.543 },
    uniformScale: 1,
    finalBoundsMm: { x: 274.148, y: 100, z: 194.543 },
    confirmedAt: '2026-07-19T10:00:00.000Z',
  });
  assert.equal(Object.isFrozen(first.confirmations[0]), true);
  assert.equal(Object.isFrozen(first.confirmations[0].modelRef), true);
  assert.equal(Object.isFrozen(first.confirmations[0].finalBoundsMm), true);

  const selectedAgain = selectInspectionAsset(first, 'banana-bed');
  const secondReady = markInspectionLoadReady(selectedAgain, selectedAgain.loadRequestId);
  const second = confirmInspectionModel(secondReady, '2026-07-19T10:01:00.000Z');

  assert.equal(second.confirmations.length, 2);
  assert.equal(second.confirmations[0], first.confirmations[0]);
  assert.equal(second.confirmations[1].modelRef.assetKey, 'banana-bed');
});
