// WP-SEAM-0 consumer compatibility + provider conformance contract tests.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCENE_CONFIRMATION_COMMERCE_SCHEMA_VERSION,
  SceneConfirmationCommerceInputSchema,
} from '../src/contracts/scene-confirmation-commerce.ts';
import {
  ownedAssetSceneConfirmationFixture as ownedAssetFixture,
  temporaryCatalogSceneConfirmationFixture as temporaryCatalogFixture,
} from '../src/contracts/scene-confirmation-commerce.fixture.ts';

test('shared contract accepts an immutable owned asset and preserves final mm geometry', () => {
  const parsed = SceneConfirmationCommerceInputSchema.parse(ownedAssetFixture);

  assert.equal(parsed.schemaVersion, SCENE_CONFIRMATION_COMMERCE_SCHEMA_VERSION);
  assert.deepEqual(parsed.dimensionsMm, { x: 180, y: 120, z: 75 });
  assert.equal(parsed.assetRef.sha256, 'a'.repeat(64));
});

test('temporary_catalog is accepted only as sandbox_only', () => {
  assert.equal(SceneConfirmationCommerceInputSchema.safeParse(temporaryCatalogFixture).success, true);
  assert.equal(
    SceneConfirmationCommerceInputSchema.safeParse({
      ...temporaryCatalogFixture,
      eligibility: 'formal_candidate',
    }).success,
    false,
  );
});

test('sandbox fixture source can never become a formal candidate', () => {
  assert.equal(
    SceneConfirmationCommerceInputSchema.safeParse({
      ...ownedAssetFixture,
      source: 'sandbox_fixture',
    }).success,
    false,
  );
});

test('consumer rejects unknown versions, mutable asset refs, missing units and invalid transforms', () => {
  assert.equal(
    SceneConfirmationCommerceInputSchema.safeParse({
      ...ownedAssetFixture,
      schemaVersion: 'scene-confirmation-commerce.v1',
    }).success,
    false,
  );
  assert.equal(
    SceneConfirmationCommerceInputSchema.safeParse({
      ...ownedAssetFixture,
      assetRef: { kind: 'owned_asset', assetId: 'asset_01' },
    }).success,
    false,
  );
  assert.equal(
    SceneConfirmationCommerceInputSchema.safeParse({
      ...ownedAssetFixture,
      dimensions: { x: 180, y: 120, z: 75 },
      dimensionsMm: undefined,
    }).success,
    false,
  );
  assert.equal(
    SceneConfirmationCommerceInputSchema.safeParse({
      ...ownedAssetFixture,
      rotationYRad: Number.NaN,
    }).success,
    false,
  );
  assert.equal(
    SceneConfirmationCommerceInputSchema.safeParse({
      ...ownedAssetFixture,
      uniformScale: 0,
    }).success,
    false,
  );
});

test('strict contract rejects client-supplied geometry analysis and money', () => {
  assert.equal(
    SceneConfirmationCommerceInputSchema.safeParse({
      ...ownedAssetFixture,
      volumeCm3: 42,
    }).success,
    false,
  );
  assert.equal(
    SceneConfirmationCommerceInputSchema.safeParse({
      ...ownedAssetFixture,
      amountCent: 12900,
    }).success,
    false,
  );
});

test('provider conformance rejects malformed ids, checksum, timestamp and non-positive dimensions', () => {
  for (const patch of [
    { sceneConfirmationId: '' },
    { projectId: '' },
    { targetInstanceId: '' },
    { assetRef: { kind: 'owned_asset', assetId: 'asset_01', sha256: 'not-a-checksum' } },
    { confirmedAt: '2026-07-19' },
    { dimensionsMm: { x: -1, y: 120, z: 75 } },
  ]) {
    assert.equal(
      SceneConfirmationCommerceInputSchema.safeParse({ ...ownedAssetFixture, ...patch }).success,
      false,
    );
  }
});
