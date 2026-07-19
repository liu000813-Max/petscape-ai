import test from 'node:test';
import assert from 'node:assert/strict';

import { createPersistedSceneDraft, saveResponseLeavesDraftDirty } from '../app/lib/viewer/viewer-workspace.ts';

const confirmation = {
  id: 'model-confirmation-db-1',
  designItemId: 'design-item-db-1',
  modelRef: {
    kind: 'temporary_catalog',
    assetKey: 'cheese-lounge-bed',
    checksum: 'ad7ff9f2b6e2f53ab0908dee9caa58e23f22b7319962bd57931b991bd56d61b5',
    quoteEligible: false,
  },
  sourceBoundsMm: { x: 274.148, y: 100, z: 194.543 },
  uniformScale: 1.25,
  finalBoundsMm: { x: 342.685, y: 125, z: 243.17875 },
  confirmedAt: '2026-07-19T10:00:00.000Z',
};

test('persisted workspace draft uses server DesignItem/ModelConfirmation ids and frozen rat reference', () => {
  const draft = createPersistedSceneDraft('project-db-1', 'design-item-db-1', confirmation);
  assert.equal(draft.targetDesignItemId, 'design-item-db-1');
  assert.equal(draft.targetModelConfirmationId, 'model-confirmation-db-1');
  assert.equal(draft.items[0].modelConfirmationId, 'model-confirmation-db-1');
  assert.equal(draft.items.some((item) => item.modelConfirmationId?.startsWith('memory-')), false);
  const reference = draft.items.find((item) => item.role === 'pet_reference');
  assert.equal(reference.modelRef.assetKey, 'procedural-adult-rat-reference-v1');
  assert.equal(reference.modelRef.quoteEligible, false);
});

test('save response cannot mark edits made during the request as clean', () => {
  assert.equal(saveResponseLeavesDraftDirty(4, 4), false);
  assert.equal(saveResponseLeavesDraftDirty(4, 5), true);
});
