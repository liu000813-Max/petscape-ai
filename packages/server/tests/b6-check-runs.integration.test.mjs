import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  if (process.env.CI) throw new Error('CI 缺少 DATABASE_URL：B6 权限/竞态测试不得静默 skip');
  test('b6-check-runs.integration.test.mjs skipped: DATABASE_URL not set', (t) => {
    t.skip('需要执行最新 migration 的真实 PostgreSQL');
  });
} else {
  const { createPrismaClient } = await import('../src/infra/db/index.ts');
  const {
    B7_SANDBOX_SCENE_CONFIRMATION_ID,
    AdminRequiredError,
    CheckRunConflictError,
    CustomizationRequestConflictError,
    bootstrapFirstAdmin,
    changeUserRole,
    completeCheckRun,
    createCheckRun,
    createCustomizationRequest,
    getApprovedCheckRunInput,
    listOwnerCheckRuns,
    startCheckRun,
  } = await import('../src/application/index.ts');

  const prisma = createPrismaClient({ connectionString: databaseUrl, poolMax: 12 });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const adminA = `b6-admin-a-${suffix}`;
  const adminB = `b6-admin-b-${suffix}`;
  const owner = `b6-owner-${suffix}`;
  const target = `b6-target-${suffix}`;

  async function submitRequest(key) {
    return (
      await createCustomizationRequest({
        prisma,
        ownerUserId: owner,
        input: {
          sceneConfirmationId: B7_SANDBOX_SCENE_CONFIRMATION_ID,
          idempotencyKey: key,
          contactName: 'B6 申请用户',
          contactPhone: '13800138000',
          usageDescription: `B6 沙箱审核 ${key}`,
          additionalRequirements: '入口圆润',
        },
      })
    ).request;
  }

  test.before(async () => {
    await prisma.user.createMany({
      data: [
        { id: adminA, name: 'B6 Admin A' },
        { id: adminB, name: 'B6 Admin B' },
        { id: owner, name: 'B6 Owner' },
        { id: target, name: 'B6 Target' },
      ],
    });
    await bootstrapFirstAdmin({ prisma, targetUserId: adminA, reason: 'B6 integration bootstrap' });
    await changeUserRole({
      prisma,
      actorUserId: adminA,
      targetUserId: adminB,
      input: { role: 'admin', expectedRole: 'user', reason: 'B6 integration second admin' },
    });
  });

  test.after(async () => {
    await prisma.$disconnect();
  });

  test('ordinary users cannot grant roles or create/start/complete reviews', async () => {
    const request = await submitRequest('permissions');
    await assert.rejects(
      () => changeUserRole({ prisma, actorUserId: owner, targetUserId: target, input: { role: 'admin', expectedRole: 'user', reason: '越权' } }),
      (error) => error instanceof AdminRequiredError,
    );
    await assert.rejects(
      () => createCheckRun({ prisma, actorUserId: owner, input: { requestId: request.id } }),
      (error) => error instanceof AdminRequiredError,
    );

    const queued = (await createCheckRun({ prisma, actorUserId: adminA, input: { requestId: request.id } })).checkRun;
    await assert.rejects(
      () => startCheckRun({ prisma, actorUserId: owner, checkRunId: queued.id }),
      (error) => error instanceof AdminRequiredError,
    );
    await assert.rejects(
      () => completeCheckRun({ prisma, actorUserId: owner, checkRunId: queued.id, input: { result: 'approved', issues: [], evidence: [{ kind: 'note', ref: 'manual://unauthorized', summary: '越权测试证据' }], adjustmentSuggestions: [], note: null } }),
      (error) => error instanceof AdminRequiredError,
    );
  });

  test('first admin bootstrap is audited once and then fails closed', async () => {
    const audits = await prisma.roleChangeAudit.findMany({ where: { targetUserId: adminA } });
    assert.equal(audits.length, 1);
    assert.equal(audits[0].source, 'bootstrap_operator');
    assert.equal(audits[0].actorUserId, null);
    await assert.rejects(() => prisma.user.create({
      data: { id: `b6-direct-admin-${suffix}`, name: 'Bypass Admin', role: 'admin' },
    }));
    await assert.rejects(
      () => bootstrapFirstAdmin({ prisma, targetUserId: owner, reason: '不得再次 bootstrap' }),
      (error) => error instanceof CheckRunConflictError,
    );
  });

  test('role changes are atomic and append one immutable audit row', async () => {
    const changed = await changeUserRole({
      prisma,
      actorUserId: adminA,
      targetUserId: target,
      input: { role: 'admin', expectedRole: 'user', reason: '批次 2 沙箱审核授权' },
    });
    assert.equal(changed.role, 'admin');
    const audits = await prisma.roleChangeAudit.findMany({ where: { targetUserId: target } });
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actorUserId, adminA);
    assert.equal(audits[0].previousRole, 'user');
    assert.equal(audits[0].newRole, 'admin');
    assert.equal(audits[0].source, 'admin_api');
    await assert.rejects(() => prisma.user.update({ where: { id: target }, data: { role: 'user' } }));
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target } })).role, 'admin');
    assert.equal(await prisma.roleChangeAudit.count({ where: { targetUserId: target } }), 1);
    await assert.rejects(() => prisma.roleChangeAudit.update({ where: { id: audits[0].id }, data: { reason: '漂移' } }));
    await assert.rejects(() => prisma.roleChangeAudit.delete({ where: { id: audits[0].id } }));
  });

  test('two admins racing to claim one queued check produce one reviewer', async () => {
    const request = await submitRequest('claim-race');
    const firstCreate = await createCheckRun({ prisma, actorUserId: adminA, input: { requestId: request.id } });
    const duplicateCreate = await createCheckRun({ prisma, actorUserId: adminB, input: { requestId: request.id } });
    assert.equal(firstCreate.created, true);
    assert.equal(duplicateCreate.created, false);
    assert.equal(firstCreate.checkRun.id, duplicateCreate.checkRun.id);

    const claims = await Promise.allSettled([
      startCheckRun({ prisma, actorUserId: adminA, checkRunId: firstCreate.checkRun.id }),
      startCheckRun({ prisma, actorUserId: adminB, checkRunId: firstCreate.checkRun.id }),
    ]);
    assert.equal(claims.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = claims.find((result) => result.status === 'rejected');
    assert.equal(rejected?.reason instanceof CheckRunConflictError, true);
    const winner = claims.find((result) => result.status === 'fulfilled').value;
    await assert.rejects(
      () => changeUserRole({
        prisma,
        actorUserId: winner.reviewerUserId === adminA ? adminB : adminA,
        targetUserId: winner.reviewerUserId,
        input: { role: 'user', expectedRole: 'admin', reason: '不得降级活跃审核员' },
      }),
      (error) => error instanceof CheckRunConflictError,
    );
    await assert.rejects(
      () => createCustomizationRequest({
        prisma,
        ownerUserId: owner,
        input: {
          sceneConfirmationId: B7_SANDBOX_SCENE_CONFIRMATION_ID,
          idempotencyKey: 'claim-race-resubmit',
          supersedesRequestId: request.id,
          contactName: 'B6 申请用户',
          contactPhone: '13800138000',
          usageDescription: '审核中不得重提',
          additionalRequirements: null,
        },
      }),
      (error) => error instanceof CustomizationRequestConflictError,
    );
  });

  test('completion freezes evidence; only completed approved input is consumable by C2', async () => {
    const request = await submitRequest('approved');
    const queued = (await createCheckRun({ prisma, actorUserId: adminA, input: { requestId: request.id } })).checkRun;
    const claimed = await startCheckRun({ prisma, actorUserId: adminA, checkRunId: queued.id });
    assert.equal(claimed.status, 'in_review');
    await assert.rejects(() => prisma.$executeRaw`
      UPDATE "check_run"
      SET "status" = 'completed', "result" = 'approved', "evidence" = '[]'::jsonb,
          "completedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${queued.id}
    `);
    assert.equal((await prisma.checkRun.findUniqueOrThrow({ where: { id: queued.id } })).status, 'in_review');
    const completed = await completeCheckRun({
      prisma,
      actorUserId: adminA,
      checkRunId: queued.id,
      input: {
        result: 'approved',
        issues: [],
        evidence: [{ kind: 'note', ref: 'manual://sandbox-visual', summary: '沙箱人工检查完成' }],
        adjustmentSuggestions: [],
        note: '仅沙箱可信检查，不代表真实制造承诺',
      },
    });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.result, 'approved');
    assert.equal(completed.requestSnapshot.productCode, 'cheese-lounge-bed');
    assert.equal(completed.requestSnapshot.sceneConfirmation.dimensionsMm.x, 120);
    assert.equal((await getApprovedCheckRunInput({ prisma, requestId: request.id })).checkRunId, completed.id);
    await assert.rejects(() => prisma.checkRun.update({ where: { id: completed.id }, data: { note: '不得漂移' } }));
    await assert.rejects(() => prisma.checkRun.delete({ where: { id: completed.id } }));
    assert.equal((await listOwnerCheckRuns({ prisma, ownerUserId: owner })).some((row) => row.id === completed.id), true);
    const successor = await createCustomizationRequest({
      prisma,
      ownerUserId: owner,
      input: {
        sceneConfirmationId: B7_SANDBOX_SCENE_CONFIRMATION_ID,
        idempotencyKey: 'approved-successor',
        supersedesRequestId: request.id,
        contactName: 'B6 申请用户',
        contactPhone: '13800138000',
        usageDescription: '通过后仍修改设计，旧审核必须失效',
        additionalRequirements: null,
      },
    });
    assert.equal(successor.request.supersedesRequestId, request.id);
    await assert.rejects(
      () => getApprovedCheckRunInput({ prisma, requestId: request.id }),
      (error) => error instanceof CheckRunConflictError,
    );
  });

  test('uncertain is never consumable as approved and the user can submit a successor request', async () => {
    const request = await submitRequest('uncertain');
    const queued = (await createCheckRun({ prisma, actorUserId: adminA, input: { requestId: request.id } })).checkRun;
    await startCheckRun({ prisma, actorUserId: adminA, checkRunId: queued.id });
    await completeCheckRun({
      prisma,
      actorUserId: adminA,
      checkRunId: queued.id,
      input: { result: 'uncertain', issues: ['证据不足'], evidence: [], adjustmentSuggestions: ['补充说明'], note: null },
    });
    await assert.rejects(
      () => getApprovedCheckRunInput({ prisma, requestId: request.id }),
      (error) => error instanceof CheckRunConflictError,
    );
    const successor = await createCustomizationRequest({
      prisma,
      ownerUserId: owner,
      input: {
        sceneConfirmationId: B7_SANDBOX_SCENE_CONFIRMATION_ID,
        idempotencyKey: 'uncertain-successor',
        supersedesRequestId: request.id,
        contactName: 'B6 申请用户',
        contactPhone: '13800138000',
        usageDescription: '补充信息后重新提交',
        additionalRequirements: '已补充审核所需说明',
      },
    });
    assert.equal(successor.request.supersedesRequestId, request.id);
  });

  test('the last admin cannot be demoted', async () => {
    await changeUserRole({
      prisma,
      actorUserId: adminA,
      targetUserId: target,
      input: { role: 'user', expectedRole: 'admin', reason: '移除测试中的临时管理员' },
    });
    await changeUserRole({
      prisma,
      actorUserId: adminA,
      targetUserId: adminB,
      input: { role: 'user', expectedRole: 'admin', reason: '测试最后管理员保护' },
    });
    await assert.rejects(
      () => changeUserRole({
        prisma,
        actorUserId: adminA,
        targetUserId: adminA,
        input: { role: 'user', expectedRole: 'admin', reason: '不得移除最后管理员' },
      }),
      (error) => error instanceof CheckRunConflictError,
    );
  });
}
