import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CreateCustomizationRequestSchema,
  CustomizationRequestIdParamSchema,
  CustomizationRequestResponseSchema,
} from '../src/contracts/customization-requests.ts';

const validRequest = {
  sceneConfirmationId: 'b7-sandbox-scene-confirmation-cheese-lounge-bed',
  idempotencyKey: 'request-form-submit-01',
  contactName: '陈小景',
  contactPhone: '13800138000',
  usageDescription: '给成年仓鼠日常休息使用，放在室内笼舍底层。',
  additionalRequirements: '入口边缘保持圆润。',
};

test('C1 request boundary accepts only user-editable fields and a confirmation reference', () => {
  assert.deepEqual(CreateCustomizationRequestSchema.parse(validRequest), validRequest);

  for (const injected of [
    { dimensionsMm: { x: 1, y: 1, z: 1 } },
    { amountCent: 1 },
    { materialId: 'client-selected-material' },
    { assetRef: { kind: 'temporary_catalog', assetKey: 'forged', sha256: 'a'.repeat(64) } },
    { sandboxOnly: false },
    { status: 'submitted' },
  ]) {
    assert.equal(
      CreateCustomizationRequestSchema.safeParse({ ...validRequest, ...injected }).success,
      false,
    );
  }
});

test('C1 detail route parameter is parsed at the process boundary', () => {
  assert.deepEqual(CustomizationRequestIdParamSchema.parse({ id: ' request-01 ' }), {
    id: 'request-01',
  });
  assert.equal(CustomizationRequestIdParamSchema.safeParse({ id: '   ' }).success, false);
  assert.equal(CustomizationRequestIdParamSchema.safeParse({ id: 'x'.repeat(192) }).success, false);
});

test('C1 response is a submitted immutable sandbox snapshot, not a quote', () => {
  const response = {
    id: 'request-01',
    status: 'submitted',
    sandboxOnly: true,
    label: '沙箱定制申请（不会产生真实交易）',
    productCode: 'cheese-lounge-bed',
    materialName: 'PETG 奶酪黄（沙箱）',
    materialVersion: 'petg-cheese-yellow-sandbox-v0',
    contactName: '陈小景',
    contactPhone: '13800138000',
    usageDescription: validRequest.usageDescription,
    additionalRequirements: validRequest.additionalRequirements,
    supersedesRequestId: null,
    sceneConfirmation: {
      schemaVersion: 'scene-confirmation-commerce.v0',
      sceneConfirmationId: validRequest.sceneConfirmationId,
      projectId: 'sandbox-project-cheese-lounge-bed',
      targetInstanceId: 'cheese-lounge-bed-instance',
      assetRef: {
        kind: 'temporary_catalog',
        assetKey: 'cheese-lounge-bed',
        sha256: '8191dcdaaa3d01993df661857e388c1cbe641b5d0443d47b692a856acf6d596d',
      },
      dimensionsMm: { x: 120, y: 119.022, z: 53.865 },
      rotationYRad: 0,
      uniformScale: 1,
      confirmedAt: '2026-07-19T00:00:00.000Z',
      source: 'sandbox_fixture',
      eligibility: 'sandbox_only',
    },
    submittedAt: '2026-07-19T12:00:00.000Z',
    createdAt: '2026-07-19T12:00:00.000Z',
  };

  assert.equal(CustomizationRequestResponseSchema.safeParse(response).success, true);
  assert.equal(
    CustomizationRequestResponseSchema.safeParse({ ...response, sandboxOnly: false }).success,
    false,
  );
  assert.equal(
    CustomizationRequestResponseSchema.safeParse({ ...response, amountCent: 12900 }).success,
    false,
  );
});
