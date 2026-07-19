import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMeshAnalysisIdempotencyKey } from '../src/application/commerce-estimates.ts';
import { temporaryCatalogSceneConfirmationFixture } from '../src/contracts/scene-confirmation-commerce.fixture.ts';

test('idempotency canonicalizes dimensions instead of concatenating float strings', () => {
  const first = buildMeshAnalysisIdempotencyKey(temporaryCatalogSceneConfirmationFixture);
  const equivalent = buildMeshAnalysisIdempotencyKey({
    ...temporaryCatalogSceneConfirmationFixture,
    dimensionsMm: {
      ...temporaryCatalogSceneConfirmationFixture.dimensionsMm,
      x: temporaryCatalogSceneConfirmationFixture.dimensionsMm.x + 0.0000001,
    },
  });
  const changedAsset = buildMeshAnalysisIdempotencyKey({
    ...temporaryCatalogSceneConfirmationFixture,
    assetRef: {
      ...temporaryCatalogSceneConfirmationFixture.assetRef,
      sha256: 'c'.repeat(64),
    },
  });

  assert.match(first, /^mesh-analysis:v0:[a-f0-9]{64}$/);
  assert.equal(equivalent, first);
  assert.notEqual(changedAsset, first);
});
