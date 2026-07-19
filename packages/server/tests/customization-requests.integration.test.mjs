import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  if (process.env.CI) throw new Error('CI 缺少 DATABASE_URL：C1 申请集成测试不得静默 skip');
  test('customization-requests.integration.test.mjs skipped: DATABASE_URL not set', (t) => {
    t.skip('需要执行最新 migration 的真实 PostgreSQL');
  });
} else {
  const { createPrismaClient } = await import('../src/infra/db/index.ts');
  const {
    B7_SANDBOX_SCENE_CONFIRMATION_ID,
    createCustomizationRequest,
    CustomizationRequestConflictError,
    getCustomizationRequest,
    listCustomizationRequests,
    NotFoundError,
  } = await import('../src/application/index.ts');

  const prisma = createPrismaClient({ connectionString: databaseUrl, poolMax: 12 });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const ownerUserId = `c1-owner-${suffix}`;
  const otherUserId = `c1-other-${suffix}`;

  const input = {
    sceneConfirmationId: B7_SANDBOX_SCENE_CONFIRMATION_ID,
    idempotencyKey: 'submit-01',
    contactName: '陈小景',
    contactPhone: '13800138000',
    usageDescription: '给成年仓鼠日常休息使用。',
    additionalRequirements: '入口边缘保持圆润。',
  };

  test.before(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerUserId, name: 'C1 Owner' },
        { id: otherUserId, name: 'C1 Other' },
      ],
    });
  });

  test.after(async () => {
    await prisma.customizationRequest.deleteMany({
      where: { ownerUserId: { in: [ownerUserId, otherUserId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [ownerUserId, otherUserId] } } });
    await prisma.$disconnect();
  });

  test('10 concurrent identical submissions create one request and return one immutable snapshot', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        createCustomizationRequest({ prisma, ownerUserId, input }),
      ),
    );

    assert.equal(results.filter((result) => result.created).length, 1);
    assert.equal(new Set(results.map((result) => result.request.id)).size, 1);
    const request = results[0].request;
    assert.equal(request.status, 'submitted');
    assert.equal(request.sandboxOnly, true);
    assert.equal(request.sceneConfirmation.eligibility, 'sandbox_only');
    assert.equal(request.sceneConfirmation.assetRef.kind, 'temporary_catalog');
    assert.equal(request.productCode, 'cheese-lounge-bed');
    assert.equal(request.materialVersion, 'petg-cheese-yellow-sandbox-v0');
    assert.equal(await prisma.customizationRequest.count({ where: { ownerUserId } }), 1);
  });

  test('owner can list/read while another user receives NotFoundError', async () => {
    const request = (await createCustomizationRequest({ prisma, ownerUserId, input })).request;
    const listed = await listCustomizationRequests({ prisma, ownerUserId });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, request.id);
    assert.equal((await getCustomizationRequest({ prisma, ownerUserId, requestId: request.id })).id, request.id);
    await assert.rejects(
      () => getCustomizationRequest({ prisma, ownerUserId: otherUserId, requestId: request.id }),
      (error) => error instanceof NotFoundError,
    );
  });

  test('resubmission creates a new version, supersedes the prior row, and never drifts history', async () => {
    const first = (await createCustomizationRequest({ prisma, ownerUserId, input })).request;
    const secondInput = {
      ...input,
      idempotencyKey: 'submit-02',
      supersedesRequestId: first.id,
      usageDescription: '改为给老年仓鼠短时休息使用。',
      additionalRequirements: null,
    };
    const second = (await createCustomizationRequest({ prisma, ownerUserId, input: secondInput })).request;

    assert.notEqual(second.id, first.id);
    assert.equal(second.supersedesRequestId, first.id);
    assert.equal(second.status, 'submitted');
    assert.equal((await getCustomizationRequest({ prisma, ownerUserId, requestId: first.id })).status, 'superseded');
    assert.equal((await getCustomizationRequest({ prisma, ownerUserId, requestId: first.id })).usageDescription, input.usageDescription);
    assert.equal(second.usageDescription, secondInput.usageDescription);
  });

  test('two different concurrent resubmissions can create only one successor', async () => {
    const current = (await listCustomizationRequests({ prisma, ownerUserId })).find(
      (request) => request.status === 'submitted',
    );
    assert.ok(current);
    const attempts = await Promise.allSettled([
      createCustomizationRequest({
        prisma,
        ownerUserId,
        input: {
          ...input,
          idempotencyKey: 'successor-race-a',
          supersedesRequestId: current.id,
          usageDescription: '并发重提 A',
        },
      }),
      createCustomizationRequest({
        prisma,
        ownerUserId,
        input: {
          ...input,
          idempotencyKey: 'successor-race-b',
          supersedesRequestId: current.id,
          usageDescription: '并发重提 B',
        },
      }),
    ]);
    assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = attempts.find((result) => result.status === 'rejected');
    assert.ok(rejected);
    assert.equal(rejected.reason instanceof CustomizationRequestConflictError, true);
    assert.equal(
      await prisma.customizationRequest.count({ where: { supersedesRequestId: current.id } }),
      1,
    );
  });

  test('database rejects invalid status, live flags, incomplete snapshots, and history drift', async () => {
    const valid = await prisma.customizationRequest.findFirstOrThrow({ where: { ownerUserId } });
    await assert.rejects(() =>
      prisma.customizationRequest.create({
        data: {
          ownerUserId,
          sceneConfirmationId: valid.sceneConfirmationId,
          projectId: valid.projectId,
          targetInstanceId: valid.targetInstanceId,
          sceneConfirmation: valid.sceneConfirmation,
          productCode: valid.productCode,
          materialName: valid.materialName,
          materialVersion: valid.materialVersion,
          sandboxOnly: true,
          contactName: '约束测试',
          contactPhone: '13800138000',
          usageDescription: '数据库状态约束测试',
          status: 'approved',
          idempotencyKey: 'invalid-status',
          requestFingerprint: 'a'.repeat(64),
          submittedAt: new Date(),
        },
      }),
    );
    await assert.rejects(() =>
      prisma.customizationRequest.create({
        data: {
          ownerUserId,
          sceneConfirmationId: 'drifted-scene-id',
          projectId: valid.projectId,
          targetInstanceId: valid.targetInstanceId,
          sceneConfirmation: valid.sceneConfirmation,
          productCode: valid.productCode,
          materialName: valid.materialName,
          materialVersion: valid.materialVersion,
          sandboxOnly: true,
          contactName: '约束测试',
          contactPhone: '13800138000',
          usageDescription: '数据库快照约束测试',
          status: 'submitted',
          idempotencyKey: 'invalid-snapshot',
          requestFingerprint: 'b'.repeat(64),
          submittedAt: new Date(),
        },
      }),
    );

    await assert.rejects(() =>
      prisma.customizationRequest.create({
        data: {
          ownerUserId,
          sceneConfirmationId: valid.sceneConfirmationId,
          projectId: valid.projectId,
          targetInstanceId: valid.targetInstanceId,
          sceneConfirmation: valid.sceneConfirmation,
          productCode: valid.productCode,
          materialName: valid.materialName,
          materialVersion: valid.materialVersion,
          sandboxOnly: false,
          contactName: '约束测试',
          contactPhone: '13800138000',
          usageDescription: 'C1 不接受 live 申请',
          status: 'submitted',
          idempotencyKey: 'invalid-live-flag',
          requestFingerprint: 'c'.repeat(64),
          submittedAt: new Date(),
        },
      }),
    );

    const incompleteSnapshot = structuredClone(valid.sceneConfirmation);
    delete incompleteSnapshot.eligibility;
    await assert.rejects(() =>
      prisma.customizationRequest.create({
        data: {
          ownerUserId,
          sceneConfirmationId: valid.sceneConfirmationId,
          projectId: valid.projectId,
          targetInstanceId: valid.targetInstanceId,
          sceneConfirmation: incompleteSnapshot,
          productCode: valid.productCode,
          materialName: valid.materialName,
          materialVersion: valid.materialVersion,
          sandboxOnly: true,
          contactName: '约束测试',
          contactPhone: '13800138000',
          usageDescription: '缺少 eligibility 的快照必须失败',
          status: 'submitted',
          idempotencyKey: 'invalid-missing-eligibility',
          requestFingerprint: 'd'.repeat(64),
          submittedAt: new Date(),
        },
      }),
    );

    await assert.rejects(() =>
      prisma.customizationRequest.update({
        where: { id: valid.id },
        data: { usageDescription: '不得原地改写历史输入' },
      }),
    );
  });

  test('a user cannot supersede another owner request or submit an unknown confirmation', async () => {
    const other = (
      await createCustomizationRequest({
        prisma,
        ownerUserId: otherUserId,
        input: { ...input, idempotencyKey: 'other-01' },
      })
    ).request;
    await assert.rejects(
      () =>
        createCustomizationRequest({
          prisma,
          ownerUserId,
          input: { ...input, idempotencyKey: 'hijack-01', supersedesRequestId: other.id },
        }),
      (error) => error instanceof NotFoundError,
    );
    await assert.rejects(
      () =>
        createCustomizationRequest({
          prisma,
          ownerUserId,
          input: { ...input, idempotencyKey: 'unknown-scene', sceneConfirmationId: 'unknown' },
        }),
      (error) => error instanceof NotFoundError,
    );
  });

  test('reusing an idempotency key with different content is rejected', async () => {
    await createCustomizationRequest({
      prisma,
      ownerUserId: otherUserId,
      input: { ...input, idempotencyKey: 'idempotency-content-guard' },
    });
    await assert.rejects(
      () =>
        createCustomizationRequest({
          prisma,
          ownerUserId: otherUserId,
          input: {
            ...input,
            idempotencyKey: 'idempotency-content-guard',
            usageDescription: '同一幂等键下的不同内容不得被静默接受',
          },
        }),
      (error) => error instanceof CustomizationRequestConflictError,
    );
  });
}
