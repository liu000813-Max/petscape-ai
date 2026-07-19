import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CreateSandboxEstimateRequestSchema,
  MeshAnalysisJobInputSchema,
  MeshAnalysisResultSchema,
  SandboxEstimateResponseSchema,
} from '../src/contracts/commerce-estimates.ts';
import { temporaryCatalogSceneConfirmationFixture } from '../src/contracts/scene-confirmation-commerce.fixture.ts';

test('estimate request accepts only a server-verifiable SceneConfirmation id', () => {
  assert.deepEqual(CreateSandboxEstimateRequestSchema.parse({ sceneConfirmationId: 'sandbox-fixture-01' }), {
    sceneConfirmationId: 'sandbox-fixture-01',
  });
  assert.equal(
    CreateSandboxEstimateRequestSchema.safeParse({
      sceneConfirmationId: 'sandbox-fixture-01',
      dimensionsMm: { x: 1, y: 1, z: 1 },
    }).success,
    false,
  );
  assert.equal(
    CreateSandboxEstimateRequestSchema.safeParse({
      sceneConfirmationId: 'sandbox-fixture-01',
      amountCent: 1,
    }).success,
    false,
  );
  assert.equal(
    CreateSandboxEstimateRequestSchema.safeParse({
      sceneConfirmationId: 'sandbox-fixture-01',
      materialId: 'client-selected-material',
    }).success,
    false,
  );
});

test('money response boundaries reject fractional and unsafe cents', () => {
  const ready = {
    estimateJobId: 'estimate-1',
    status: 'ready',
    label: '沙箱预估（不可支付）',
    formalQuoteAllowed: false,
    productCode: 'cheese-lounge-bed',
    materialName: 'PETG 奶酪黄（沙箱）',
    materialVersion: 'petg-cheese-yellow-sandbox-v0',
    pricingRuleVersion: 'v0-sandbox',
    analysis: {
      schemaVersion: 'mesh-analysis-result.v0',
      algorithmVersion: 'trimesh-volume.v0',
      geometryUnit: 'millimeter',
      assetChecksum: 'a'.repeat(64),
      dimensionsMm: { x: 120, y: 119.022, z: 53.865 },
      volumeMm3: 240342.387,
      triangleCount: 100,
      watertight: true,
    },
    weightGrams: '305.234',
    materialCostCent: 10684,
    baseFeeCent: 2500,
    multiplier: '2.5',
    floorPriceCent: 12900,
    amountCent: 33000,
    currency: 'CNY',
    taxMode: 'tax_inclusive',
    roundingMode: 'ceil_whole_yuan',
  };
  assert.equal(SandboxEstimateResponseSchema.safeParse(ready).success, true);
  assert.equal(
    SandboxEstimateResponseSchema.safeParse({ ...ready, materialCostCent: 1.5 }).success,
    false,
  );
  assert.equal(
    SandboxEstimateResponseSchema.safeParse({ ...ready, amountCent: Number.MAX_SAFE_INTEGER + 1 }).success,
    false,
  );
});

test('mesh job payload carries the shared contract, explicit unit and algorithm version', () => {
  const result = MeshAnalysisJobInputSchema.safeParse({
    schemaVersion: 'mesh-analysis-job.v0',
    algorithmVersion: 'trimesh-volume.v0',
    geometryUnit: 'millimeter',
    sceneConfirmation: temporaryCatalogSceneConfirmationFixture,
  });
  assert.equal(result.success, true);

  assert.equal(
    MeshAnalysisJobInputSchema.safeParse({
      schemaVersion: 'mesh-analysis-job.v0',
      algorithmVersion: 'trimesh-volume.v0',
      sceneConfirmation: temporaryCatalogSceneConfirmationFixture,
    }).success,
    false,
  );
});

test('mesh result rejects non-watertight and non-finite geometry', () => {
  const valid = {
    schemaVersion: 'mesh-analysis-result.v0',
    algorithmVersion: 'trimesh-volume.v0',
    geometryUnit: 'millimeter',
    assetChecksum: 'a'.repeat(64),
    dimensionsMm: { x: 120, y: 119.022, z: 53.865 },
    volumeMm3: 240342.387,
    triangleCount: 103716,
    watertight: true,
  };
  assert.equal(MeshAnalysisResultSchema.safeParse(valid).success, true);
  assert.equal(MeshAnalysisResultSchema.safeParse({ ...valid, watertight: false }).success, false);
  assert.equal(MeshAnalysisResultSchema.safeParse({ ...valid, volumeMm3: Number.NaN }).success, false);
});
