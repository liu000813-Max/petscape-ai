import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  if (process.env.CI) throw new Error('CI 缺少 DATABASE_URL：B7 Estimate 集成测试不得静默 skip');
  test('b7-estimates.integration.test.mjs skipped: DATABASE_URL not set', (t) => {
    t.skip('需要执行最新 migration 的真实 PostgreSQL');
  });
} else {
  const { createPrismaClient } = await import('../src/infra/db/index.ts');
  const {
    B7_SANDBOX_SCENE_CONFIRMATION_ID,
    createSandboxEstimateJob,
    getSandboxEstimate,
    NotFoundError,
  } = await import('../src/application/index.ts');
  const { claimNextJob, shutdownJobs } = await import('../src/infra/jobs/index.ts');

  const prisma = createPrismaClient({ connectionString: databaseUrl, poolMax: 3 });
  const ownerUserId = `b7-owner-${Date.now()}`;
  const otherUserId = `b7-other-${Date.now()}`;
  const recoveryUserId = `b7-recovery-${Date.now()}`;

  test.after(async () => {
    await prisma.job.deleteMany({
      where: { ownerUserId: { in: [ownerUserId, otherUserId, recoveryUserId] } },
    });
    await prisma.$disconnect();
    await shutdownJobs();
  });

  test('concurrent duplicate estimate requests create one canonical mesh_analysis job', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        createSandboxEstimateJob({
          prisma,
          ownerUserId,
          sceneConfirmationId: B7_SANDBOX_SCENE_CONFIRMATION_ID,
        }),
      ),
    );

    assert.equal(results.filter((result) => result.created).length, 1);
    assert.equal(new Set(results.map((result) => result.estimateJobId)).size, 1);
    assert.equal(results.filter((result) => result.status === 'queued').length, 1);
    assert.equal(results.filter((result) => result.status === 'existing').length, 9);
    const rows = await prisma.job.findMany({ where: { ownerUserId, type: 'mesh_analysis' } });
    assert.equal(rows.length, 1);
    assert.match(rows[0].idempotencyKey, /^mesh-analysis:v0:[a-f0-9]{64}$/);
    assert.equal(rows[0].input.sceneConfirmation.assetRef.sha256.length, 64);
  });

  test('ready estimate is server-priced and remains explicitly non-payable', async () => {
    const created = await createSandboxEstimateJob({
      prisma,
      ownerUserId,
      sceneConfirmationId: B7_SANDBOX_SCENE_CONFIRMATION_ID,
    });
    await prisma.job.update({
      where: { id: created.estimateJobId },
      data: {
        status: 'succeeded',
        resultRef: {
          schemaVersion: 'mesh-analysis-result.v0',
          algorithmVersion: 'trimesh-volume.v0',
          geometryUnit: 'millimeter',
          assetChecksum: '8191dcdaaa3d01993df661857e388c1cbe641b5d0443d47b692a856acf6d596d',
          dimensionsMm: { x: 120, y: 119.022, z: 53.865 },
          volumeMm3: 240342.387,
          triangleCount: 103716,
          watertight: true,
        },
      },
    });

    const estimate = await getSandboxEstimate({
      prisma,
      ownerUserId,
      estimateJobId: created.estimateJobId,
    });
    assert.equal(estimate.status, 'ready');
    assert.equal(estimate.formalQuoteAllowed, false);
    assert.equal(estimate.label, '沙箱预估（不可支付）');
    assert.equal(estimate.materialVersion, 'petg-cheese-yellow-sandbox-v0');
    assert.equal(estimate.pricingRuleVersion, 'v0-sandbox');
    assert.equal(Number.isSafeInteger(estimate.amountCent), true);
    assert.ok(estimate.amountCent >= 12900);
  });

  test('retryable exhausted estimate can be atomically reopened without a duplicate job', async () => {
    const created = await createSandboxEstimateJob({
      prisma,
      ownerUserId: recoveryUserId,
      sceneConfirmationId: B7_SANDBOX_SCENE_CONFIRMATION_ID,
    });
    await prisma.job.update({
      where: { id: created.estimateJobId },
      data: {
        status: 'failed',
        errorClass: 'retryable',
        errorDetail: { code: 'mesh_analysis_internal', message: 'temporary runtime failure' },
        attemptCount: 3,
        finishedAt: new Date(),
      },
    });

    const reopened = await createSandboxEstimateJob({
      prisma,
      ownerUserId: recoveryUserId,
      sceneConfirmationId: B7_SANDBOX_SCENE_CONFIRMATION_ID,
    });
    assert.equal(reopened.created, false);
    assert.equal(reopened.status, 'queued');
    assert.equal(reopened.estimateJobId, created.estimateJobId);

    const row = await prisma.job.findUniqueOrThrow({ where: { id: created.estimateJobId } });
    assert.equal(row.status, 'pending');
    assert.equal(row.attemptCount, 3);
    assert.equal(row.maxAttempts, 6);
    assert.equal(row.targetVersion, 2);
    assert.equal(row.errorClass, null);
    assert.equal(row.errorDetail, null);
    assert.equal(row.progress, null);
    assert.equal(row.resultRef, null);

    const claimed = await claimNextJob({
      workerId: 'b7-recovery-test-worker',
      types: ['mesh_analysis'],
      leaseSeconds: 30,
    });
    assert.equal(claimed?.id, created.estimateJobId);
    assert.equal(claimed?.attemptCount, 4);
  });

  test('another user cannot read the estimate job', async () => {
    const created = await createSandboxEstimateJob({
      prisma,
      ownerUserId,
      sceneConfirmationId: B7_SANDBOX_SCENE_CONFIRMATION_ID,
    });
    await assert.rejects(
      () => getSandboxEstimate({ prisma, ownerUserId: otherUserId, estimateJobId: created.estimateJobId }),
      (error) => error instanceof NotFoundError,
    );
  });
}
