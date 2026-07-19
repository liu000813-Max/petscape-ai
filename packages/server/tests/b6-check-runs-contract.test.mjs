import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ChangeUserRoleSchema,
  CompleteCheckRunSchema,
  CreateCheckRunSchema,
  CheckRunResponseSchema,
} from '../src/contracts/check-runs.ts';

test('B6 role changes are narrow, explicit and reject RBAC-shaped input', () => {
  assert.deepEqual(
    ChangeUserRoleSchema.parse({ role: 'admin', expectedRole: 'user', reason: '批次 2 审核员授权' }),
    { role: 'admin', expectedRole: 'user', reason: '批次 2 审核员授权' },
  );
  assert.equal(ChangeUserRoleSchema.safeParse({ role: 'super_admin', reason: 'no' }).success, false);
  assert.equal(ChangeUserRoleSchema.safeParse({ role: 'admin', permissions: ['review'] }).success, false);
});

test('B6 process boundary accepts only server-owned request references and fixed rule versions', () => {
  assert.deepEqual(CreateCheckRunSchema.parse({ requestId: 'request-01' }), { requestId: 'request-01' });
  assert.equal(
    CreateCheckRunSchema.safeParse({ requestId: 'request-01', requestSnapshot: { amountCent: 1 } }).success,
    false,
  );

  const decision = {
    result: 'rejected',
    issues: ['入口边缘过薄'],
    evidence: [{ kind: 'note', ref: 'manual://edge-check', summary: '最薄处不足' }],
    adjustmentSuggestions: ['入口边缘加厚 2mm'],
    note: '沙箱人工检查',
  };
  assert.deepEqual(CompleteCheckRunSchema.parse(decision), decision);
  assert.equal(CompleteCheckRunSchema.safeParse({ ...decision, result: 'passed' }).success, false);
  assert.equal(CompleteCheckRunSchema.safeParse({ ...decision, amountCent: 12900 }).success, false);
  assert.equal(CompleteCheckRunSchema.safeParse({ ...decision, result: 'approved', evidence: [] }).success, false);
});

test('B6 response cannot call queued/uncertain reviews approved', () => {
  const base = {
    id: 'check-01',
    requestId: 'request-01',
    status: 'completed',
    result: 'uncertain',
    issues: ['需要补充壁厚证据'],
    evidence: [],
    adjustmentSuggestions: ['重新确认模型'],
    note: null,
    reviewerUserId: 'admin-01',
    checklistVersion: 'fdm-manual-sandbox-v0',
    ruleVersion: 'b6-manual-review-v0-sandbox',
    requestSnapshot: {
      customizationRequestId: 'request-01',
      contactName: '陈小景',
      contactPhone: '13800138000',
      usageDescription: '仓鼠休息使用',
      additionalRequirements: null,
      productCode: 'cheese-lounge-bed',
      materialName: 'PETG 奶酪黄（沙箱）',
      materialVersion: 'petg-cheese-yellow-sandbox-v0',
      sandboxOnly: true,
      sceneConfirmation: {
        schemaVersion: 'scene-confirmation-commerce.v0',
        sceneConfirmationId: 'scene-01',
        projectId: 'project-01',
        targetInstanceId: 'target-01',
        assetRef: { kind: 'temporary_catalog', assetKey: 'cheese-lounge-bed', sha256: 'a'.repeat(64) },
        dimensionsMm: { x: 120, y: 119.022, z: 53.865 },
        rotationYRad: 0,
        uniformScale: 1,
        confirmedAt: '2026-07-19T11:58:00.000Z',
        source: 'sandbox_fixture',
        eligibility: 'sandbox_only',
      },
      submittedAt: '2026-07-19T11:58:30.000Z',
    },
    startedAt: '2026-07-19T12:00:00.000Z',
    completedAt: '2026-07-19T12:01:00.000Z',
    createdAt: '2026-07-19T11:59:00.000Z',
  };
  assert.equal(CheckRunResponseSchema.safeParse(base).success, true);
  assert.equal(CheckRunResponseSchema.safeParse({ ...base, result: 'approved', reviewerUserId: null }).success, false);
});
