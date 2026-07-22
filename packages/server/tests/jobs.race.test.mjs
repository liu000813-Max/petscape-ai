// packages/server/tests/jobs.race.test.mjs
// spec: docs/plans/phase-b-execution-plan.md WP-3.3（测试先行阶段）+
//       docs/decisions/0003-persistent-jobs.md（八条机制 / 九条验证条件）。
//
// 本文件是「测试先行」阶段产出：infra/jobs/index.ts 的所有导出函数当前只是
// 签名占位（throw new Error('NOT_IMPLEMENTED')）。因此本文件里的用例在本阶段
// 必须全部 FAIL（红），且失败原因必须是 NOT_IMPLEMENTED，而不是测试自身的
// 断言逻辑或数据准备代码出错——每个用例直接调用 infra/jobs 的函数并写真实
// 行为断言，占位实现的 throw 会让测试运行时自然中断在调用处并标记为 failing。
// 后续两个并行 builder 实现 infra/jobs 后，这些用例应转绿；转绿阶段不应再
// 改动这些断言本身（除非发现测试 bug，应作为 Observations 记录，不要静默改
// 断言迁就实现）。
//
// 用例命名里的 "ADR-N" 对应 docs/decisions/0003-persistent-jobs.md 的
// 「验证条件」编号（1-7；条件 8/9 是归档策略与争用规模测试，超出本文件范围，
// 见 WP-3.3 验收 4/5）。
//
// 运行方式：对 DATABASE_URL 指向的本地 PostgreSQL 跑（此阶段本地 PG 容器即可，
// 不连真实 RDS——真实 RDS 验证在实现阶段进行，见 WP-3.3 spec）。跑法：
//   docker run -d --name wp33-pg -e POSTGRES_PASSWORD=postgres \
//     -e POSTGRES_DB=petscape_wp33 -p 55432:5432 postgres:16
//   cd packages/server && DATABASE_URL=postgresql://postgres:postgres@localhost:55432/petscape_wp33 \
//     npx prisma migrate deploy
//   DATABASE_URL=postgresql://postgres:postgres@localhost:55432/petscape_wp33 node --test tests/jobs.race.test.mjs
// 无 DATABASE_URL 时显式 skip（同 db.integration.test.mjs / auth.integration.test.mjs 先例）。

import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  test('jobs.race.test.mjs skipped: DATABASE_URL not set (本地 PG 容器未配置)', (t) => {
    t.skip('DATABASE_URL 未设置——本机需先起本地 PostgreSQL 容器并 migrate deploy 才能跑此竞态测试套件；见文件头注释的跑法。真实 RDS 验证在实现阶段进行。');
  });
} else {
  const { createPrismaClient } = await import('../src/infra/db/index.ts');
  const {
    createJob,
    claimNextJob,
    heartbeat,
    completeJob,
    failJob,
    cancelJob,
    recoverOrphans,
    shutdownJobs,
  } = await import('../src/infra/jobs/index.ts');

  const prisma = createPrismaClient({ connectionString: databaseUrl, poolMax: 20 });

  // 测试隔离：每个测试用独立 ownerUserId 前缀，避免用例间数据互相干扰；
  // 结尾统一清理本文件写入的所有 job（JobAttempt 上有 onDelete: Cascade，删 Job 即可级联）。
  const runId = `wp33-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ownerPrefix = (suffix) => `${runId}-${suffix}`;

  test.after(async () => {
    await prisma.job.deleteMany({ where: { ownerUserId: { startsWith: runId } } });
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------
  // 用例 1（ADR-2）：并发认领 —— 两个 worker 抢 100 个 pending job，
  // 断言无双认领（每 job 恰一个 attempt 持有者）、全部被领完。
  // ---------------------------------------------------------------------
  test('ADR-2: 并发认领 100 个 pending job，两个 worker 无双认领且全部领完', async () => {
    const type = 'race-claim';
    const owner = ownerPrefix('claim');
    const jobCount = 100;

    await prisma.job.createMany({
      data: Array.from({ length: jobCount }, (_, i) => ({
        type,
        ownerUserId: owner,
        input: { i },
        idempotencyKey: `claim-${i}`,
        status: 'pending',
      })),
    });

    async function workerLoop(workerId) {
      const claimed = [];
      for (;;) {
        const job = await claimNextJob({ workerId, types: [type], leaseSeconds: 30 });
        if (!job) break;
        claimed.push(job.id);
      }
      return claimed;
    }

    const [claimedA, claimedB] = await Promise.all([workerLoop('worker-a'), workerLoop('worker-b')]);

    const overlap = claimedA.filter((id) => claimedB.includes(id));
    assert.equal(overlap.length, 0, '两个 worker 认领的 job 集合不应有交集（无双认领）');
    assert.equal(claimedA.length + claimedB.length, jobCount, '两个 worker 认领总数应等于全部 pending job 数');

    const attempts = await prisma.jobAttempt.groupBy({
      by: ['jobId'],
      where: { job: { ownerUserId: owner, type } },
      _count: { jobId: true },
    });
    assert.equal(attempts.length, jobCount, '每个 job 应恰有一次 attempt 记录');
    assert.ok(
      attempts.every((a) => a._count.jobId === 1),
      '每个 job 恰应只有一个 attempt（一个租约持有者）',
    );
  });

  // ---------------------------------------------------------------------
  // 用例 2（ADR-4）：杀 worker / 孤儿恢复 —— 认领后不心跳，伪造租约过期，
  // recoverOrphans 后无 vendorTaskId 的回 pending 可再领。
  // ---------------------------------------------------------------------
  test('ADR-4: 杀 worker 后孤儿任务（无 vendorTaskId）经 recoverOrphans 回 pending 可再领', async () => {
    const type = 'race-orphan-no-vendor';
    const owner = ownerPrefix('orphan-no-vendor');

    const { job } = await createJob(prisma, {
      type,
      ownerUserId: owner,
      input: {},
      idempotencyKey: 'orphan-1',
    });

    const claimed = await claimNextJob({ workerId: 'worker-dead', types: [type], leaseSeconds: 30 });
    assert.equal(claimed.id, job.id);

    // 伪造租约过期：直接 UPDATE leaseExpiresAt 到过去时刻（模拟 worker 被杀、未心跳）。
    await prisma.job.update({
      where: { id: job.id },
      data: { leaseExpiresAt: new Date(Date.now() - 60_000) },
    });

    const recovered = await recoverOrphans({ now: new Date() });
    const mine = recovered.find((r) => r.jobId === job.id);
    assert.ok(mine, 'recoverOrphans 应该处理该孤儿任务');
    assert.equal(mine.action, 'requeued', '无 vendorTaskId 的孤儿任务应回 pending（requeued）');

    const reclaimed = await claimNextJob({ workerId: 'worker-b', types: [type], leaseSeconds: 30 });
    assert.equal(reclaimed?.id, job.id, '回 pending 的任务应可被再次认领');
  });

  // ---------------------------------------------------------------------
  // 用例 3（ADR-3）：租约过期恢复 + 失联心跳 —— 过期后 heartbeat 返回 false；
  // 另一 worker 可认领同 job；旧 worker completeJob 返回 lost_lease 且不覆盖。
  // ---------------------------------------------------------------------
  test('ADR-3: 租约过期后旧 worker heartbeat=false，新 worker 认领后旧 worker completeJob=lost_lease', async () => {
    const type = 'race-lease-expiry';
    const owner = ownerPrefix('lease-expiry');

    const { job } = await createJob(prisma, {
      type,
      ownerUserId: owner,
      input: {},
      idempotencyKey: 'lease-1',
      targetVersion: 1,
    });

    const claimed = await claimNextJob({ workerId: 'worker-old', types: [type], leaseSeconds: 30 });
    assert.equal(claimed.id, job.id);

    // 伪造租约过期（旧 worker 失联，未及时心跳续租）。
    await prisma.job.update({
      where: { id: job.id },
      data: { leaseExpiresAt: new Date(Date.now() - 60_000) },
    });

    const heartbeatOk = await heartbeat({ jobId: job.id, workerId: 'worker-old', leaseSeconds: 30 });
    assert.equal(heartbeatOk, false, '租约已过期，旧 worker 心跳应返回 false');

    // 新 worker 认领同一个（现已成为孤儿的）任务——先走恢复再认领。
    await recoverOrphans({ now: new Date() });
    const reclaimed = await claimNextJob({ workerId: 'worker-new', types: [type], leaseSeconds: 30 });
    assert.equal(reclaimed?.id, job.id, '新 worker 应能认领该任务');

    // 旧 worker（已失联）尝试完成，应返回 lost_lease 且不覆盖新 worker 的状态。
    const outcome = await completeJob({
      jobId: job.id,
      workerId: 'worker-old',
      targetVersion: 1,
      resultRef: { from: 'worker-old-stale' },
    });
    assert.equal(outcome, 'lost_lease', '失去租约的旧 worker 完成任务应返回 lost_lease');

    const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    assert.notEqual(after.status, 'succeeded', '旧 worker 的 completeJob 不应把任务写成 succeeded');
  });

  test('租约已过期但尚未被重领时，原 worker 也不能 complete 或 fail', async () => {
    const type = 'race-expired-direct-write';
    const owner = ownerPrefix('expired-direct-write');
    const completeCandidate = (await createJob(prisma, {
      type, ownerUserId: owner, input: {}, idempotencyKey: 'expired-complete', targetVersion: 1,
    })).job;
    const failCandidate = (await createJob(prisma, {
      type, ownerUserId: owner, input: {}, idempotencyKey: 'expired-fail', targetVersion: 1,
    })).job;

    await claimNextJob({ workerId: 'worker-expired', types: [type], leaseSeconds: 30 });
    await claimNextJob({ workerId: 'worker-expired', types: [type], leaseSeconds: 30 });
    await prisma.job.updateMany({
      where: { id: { in: [completeCandidate.id, failCandidate.id] } },
      data: { leaseExpiresAt: new Date(Date.now() - 60_000) },
    });

    assert.equal(await completeJob({
      jobId: completeCandidate.id, workerId: 'worker-expired', targetVersion: 1, resultRef: { stale: true },
    }), 'lost_lease');
    assert.equal(await failJob({
      jobId: failCandidate.id, workerId: 'worker-expired', errorClass: 'retryable', errorDetail: { code: 'late' },
    }), 'lost_lease');
    const rows = await prisma.job.findMany({ where: { id: { in: [completeCandidate.id, failCandidate.id] } } });
    assert.ok(rows.every((row) => row.status === 'running'));
  });

  // ---------------------------------------------------------------------
  // 用例 4（ADR-4）：供应商已完成但本地未落库 —— 有 vendorTaskId 的过期 job，
  // recoverOrphans 置 needs_vendor_check 不重新入队。
  // ---------------------------------------------------------------------
  test('ADR-4: 有 vendorTaskId 的孤儿任务经 recoverOrphans 置 needs_vendor_check，不重新入队', async () => {
    const type = 'race-orphan-vendor';
    const owner = ownerPrefix('orphan-vendor');

    const { job } = await createJob(prisma, {
      type,
      ownerUserId: owner,
      input: {},
      idempotencyKey: 'orphan-vendor-1',
    });

    const claimed = await claimNextJob({ workerId: 'worker-dead', types: [type], leaseSeconds: 30 });
    assert.equal(claimed.id, job.id);

    // 该任务在被杀之前已经把供应商任务 ID 写回本地（典型：外部生成/切片任务）。
    await prisma.job.update({
      where: { id: job.id },
      data: {
        vendorTaskId: 'vendor-task-abc123',
        leaseExpiresAt: new Date(Date.now() - 60_000),
      },
    });

    const recovered = await recoverOrphans({ now: new Date() });
    const mine = recovered.find((r) => r.jobId === job.id);
    assert.ok(mine, 'recoverOrphans 应该处理该孤儿任务');
    assert.equal(
      mine.action,
      'needs_vendor_check',
      '有 vendorTaskId 的孤儿任务不得自动重跑，应置 needs_attention/needs_vendor_check',
    );

    const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(after.status, 'needs_attention', '有 vendorTaskId 的孤儿任务应停在 needs_attention 等人工/后续流程核实供应商状态');
    assert.notEqual(after.status, 'pending', '不得直接回 pending 重新入队（会导致重复提交供应商任务）');
  });

  // ---------------------------------------------------------------------
  // 用例 5（ADR-5）：旧任务迟到完成 —— job targetVersion=2，
  // 用 targetVersion=1 调 completeJob 返回 stale_version 且状态不变。
  // ---------------------------------------------------------------------
  test('ADR-5: targetVersion=2 的任务用 targetVersion=1 completeJob 返回 stale_version 且状态不变', async () => {
    const type = 'race-stale-version';
    const owner = ownerPrefix('stale-version');

    const { job } = await createJob(prisma, {
      type,
      ownerUserId: owner,
      input: {},
      idempotencyKey: 'stale-1',
      targetVersion: 2,
    });

    const claimed = await claimNextJob({ workerId: 'worker-a', types: [type], leaseSeconds: 30 });
    assert.equal(claimed.id, job.id);

    const before = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });

    const outcome = await completeJob({
      jobId: job.id,
      workerId: 'worker-a',
      targetVersion: 1, // 迟到的旧版本
      resultRef: { stale: true },
    });
    assert.equal(outcome, 'stale_version', '旧版本迟到完成应返回 stale_version');

    const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    assert.deepEqual(
      { status: after.status, resultRef: after.resultRef },
      { status: before.status, resultRef: before.resultRef },
      'stale_version 分支不得修改任务状态或结果引用',
    );
  });

  // ---------------------------------------------------------------------
  // 用例 6（ADR-6）：重复幂等 —— 10 个并发 createJob 同 (owner,type,key)，
  // 恰 1 个 created=true，job 只有一行。
  // ---------------------------------------------------------------------
  test('ADR-6: 10 个并发 createJob 同 (owner,type,idempotencyKey) 恰 1 个 created=true 且只有一行 job', async () => {
    const type = 'race-idempotent';
    const owner = ownerPrefix('idempotent');
    const idempotencyKey = 'dup-key-1';

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        createJob(prisma, {
          type,
          ownerUserId: owner,
          input: { attempt: true },
          idempotencyKey,
        }),
      ),
    );

    const createdTrueCount = results.filter((r) => r.created === true).length;
    assert.equal(createdTrueCount, 1, '10 个并发幂等创建请求应恰好 1 个 created=true');

    const jobIds = new Set(results.map((r) => r.job.id));
    assert.equal(jobIds.size, 1, '所有返回的 job 应指向同一行（唯一索引兜底）');

    const rows = await prisma.job.findMany({
      where: { ownerUserId: owner, type, idempotencyKey },
    });
    assert.equal(rows.length, 1, '数据库中该 (owner,type,key) 只应有一行 job');
  });

  // ---------------------------------------------------------------------
  // 错误分类用例（ADR-7）：retryable 未超限回 pending、超限转 failed、manual 转 needs_attention。
  // ---------------------------------------------------------------------
  test('ADR-7: retryable 错误在未超 maxAttempts 时 failJob 返回 retrying 并回到 pending', async () => {
    const type = 'race-error-retryable';
    const owner = ownerPrefix('error-retryable');

    const { job } = await createJob(prisma, {
      type,
      ownerUserId: owner,
      input: {},
      idempotencyKey: 'err-retryable-1',
      maxAttempts: 3,
    });

    const claimed = await claimNextJob({ workerId: 'worker-a', types: [type], leaseSeconds: 30 });
    assert.equal(claimed.id, job.id);
    assert.equal(claimed.attemptCount, 1, '首次认领后 attemptCount 应为 1');

    const outcome = await failJob({
      jobId: job.id,
      workerId: 'worker-a',
      errorClass: 'retryable',
      errorDetail: { message: 'transient vendor timeout' },
    });
    assert.equal(outcome, 'retrying', 'attemptCount(1) < maxAttempts(3) 时应返回 retrying');

    const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(after.status, 'pending', 'retrying 应把任务重新置为 pending 以便再次认领');
    assert.equal(after.leaseOwner, null, 'retrying 应清空租约持有者');
  });

  test('ADR-7: retryable 错误达到 maxAttempts 上限时 failJob 返回 failed', async () => {
    const type = 'race-error-exhausted';
    const owner = ownerPrefix('error-exhausted');

    const { job } = await createJob(prisma, {
      type,
      ownerUserId: owner,
      input: {},
      idempotencyKey: 'err-exhausted-1',
      maxAttempts: 1,
    });

    const claimed = await claimNextJob({ workerId: 'worker-a', types: [type], leaseSeconds: 30 });
    assert.equal(claimed.attemptCount, 1);

    const outcome = await failJob({
      jobId: job.id,
      workerId: 'worker-a',
      errorClass: 'retryable',
      errorDetail: { message: 'still failing' },
    });
    assert.equal(outcome, 'failed', 'attemptCount(1) >= maxAttempts(1) 时即使 retryable 也应转 failed');

    const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(after.status, 'failed');
  });

  test('pending job 达到 maxAttempts 后不得再次被认领', async () => {
    const type = 'race-exhausted-pending';
    const owner = ownerPrefix('exhausted-pending');
    const { job } = await createJob(prisma, {
      type, ownerUserId: owner, input: {}, idempotencyKey: 'fixture1', maxAttempts: 1, // gitleaks:allow -- deterministic test fixture
    });
    await prisma.job.update({ where: { id: job.id }, data: { attemptCount: 1 } });

    assert.equal(await claimNextJob({ workerId: 'worker-a', types: [type], leaseSeconds: 30 }), null);
    assert.equal((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status, 'pending');
  });

  test('worker 在最后一次尝试中崩溃后，孤儿恢复留下 durable failed 且不能再认领', async () => {
    const type = 'race-crash-exhausted';
    const owner = ownerPrefix('crash-exhausted');
    const { job } = await createJob(prisma, {
      type, ownerUserId: owner, input: {}, idempotencyKey: 'crash-exhausted-1', maxAttempts: 1,
    });
    const claimed = await claimNextJob({ workerId: 'worker-crashed', types: [type], leaseSeconds: 30 });
    assert.equal(claimed.id, job.id);
    await prisma.job.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(Date.now() - 60_000) } });

    const recovered = await recoverOrphans({ now: new Date() });
    assert.equal(recovered.find((item) => item.jobId === job.id)?.action, 'failed_exhausted');
    const stored = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(stored.status, 'failed');
    assert.equal(stored.errorClass, 'retryable');
    assert.equal(stored.errorDetail.code, 'lease_expired_max_attempts');
    assert.equal(await claimNextJob({ workerId: 'worker-next', types: [type], leaseSeconds: 30 }), null);
  });

  test('ADR-7: permanent 错误直接 failJob 返回 failed（不消耗重试）', async () => {
    const type = 'race-error-permanent';
    const owner = ownerPrefix('error-permanent');

    const { job } = await createJob(prisma, {
      type,
      ownerUserId: owner,
      input: {},
      idempotencyKey: 'err-permanent-1',
      maxAttempts: 3,
    });

    const claimed = await claimNextJob({ workerId: 'worker-a', types: [type], leaseSeconds: 30 });
    assert.equal(claimed.attemptCount, 1);

    const outcome = await failJob({
      jobId: job.id,
      workerId: 'worker-a',
      errorClass: 'permanent',
      errorDetail: { message: 'invalid input, vendor rejected permanently' },
    });
    assert.equal(outcome, 'failed', 'permanent 错误应直接 failed，即使还有重试余量');

    const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(after.status, 'failed');
  });

  test('ADR-7: manual 错误 failJob 返回 needs_attention', async () => {
    const type = 'race-error-manual';
    const owner = ownerPrefix('error-manual');

    const { job } = await createJob(prisma, {
      type,
      ownerUserId: owner,
      input: {},
      idempotencyKey: 'err-manual-1',
      maxAttempts: 3,
    });

    const claimed = await claimNextJob({ workerId: 'worker-a', types: [type], leaseSeconds: 30 });
    assert.equal(claimed.attemptCount, 1);

    const outcome = await failJob({
      jobId: job.id,
      workerId: 'worker-a',
      errorClass: 'manual',
      errorDetail: { message: 'ambiguous vendor state, needs human review' },
    });
    assert.equal(outcome, 'needs_attention', 'manual 错误应转 needs_attention');

    const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(after.status, 'needs_attention');
  });

  // ---------------------------------------------------------------------
  // 附加：cancelJob 基本占位覆盖（不在六类竞态编号内，但属于接口全集，
  // 保证 cancelJob 也在测试先行阶段被引用到，避免实现阶段遗漏契约）。
  // ---------------------------------------------------------------------
  test('cancelJob: 取消一个 pending 任务', async () => {
    const type = 'race-cancel';
    const owner = ownerPrefix('cancel');

    const { job } = await createJob(prisma, {
      type,
      ownerUserId: owner,
      input: {},
      idempotencyKey: 'cancel-1',
    });

    const canceled = await cancelJob({ jobId: job.id, expectedStatus: 'pending' });
    assert.equal(canceled, true);

    const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(after.status, 'canceled');
  });

  // ---------------------------------------------------------------------
  // 追加用例（机制 2 护栏）：有 vendorTaskId 的过期 running job 不得被
  // claimNextJob 直接抢占；只能经 recoverOrphans 落到 needs_attention。
  // ---------------------------------------------------------------------
  test('机制 2 护栏: 有 vendorTaskId 的过期 running job 不被 claimNextJob 抢占，仅 recoverOrphans 置 needs_vendor_check', async () => {
    const type = 'race-vendor-guard';
    const owner = ownerPrefix('vendor-guard');

    const { job } = await createJob(prisma, {
      type,
      ownerUserId: owner,
      input: {},
      idempotencyKey: 'vendor-guard-1',
    });

    const claimed = await claimNextJob({ workerId: 'worker-dead', types: [type], leaseSeconds: 30 });
    assert.equal(claimed.id, job.id);

    // 用测试自己的 prisma client 直接 UPDATE：写回 vendorTaskId + 伪造租约过期
    // （模拟 worker 已把供应商任务 ID 落库后被杀）。
    await prisma.job.update({
      where: { id: job.id },
      data: {
        vendorTaskId: 'vendor-task-guard-xyz',
        leaseExpiresAt: new Date(Date.now() - 60_000),
      },
    });

    // 同 type 再 claim：该过期 running job 因携带 vendorTaskId 被排除出候选集，
    // 无其他可认领任务时应返回 null（不被抢占，避免重复提交供应商任务）。
    const stolen = await claimNextJob({ workerId: 'worker-thief', types: [type], leaseSeconds: 30 });
    assert.equal(stolen, null, '有 vendorTaskId 的过期 running job 不应被 claimNextJob 直接抢占');

    // 只能经 recoverOrphans 落到 needs_attention / needs_vendor_check。
    const recovered = await recoverOrphans({ now: new Date() });
    const mine = recovered.find((r) => r.jobId === job.id);
    assert.ok(mine, 'recoverOrphans 应处理该孤儿任务');
    assert.equal(mine.action, 'needs_vendor_check', '有 vendorTaskId 的孤儿应置 needs_vendor_check');

    const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(after.status, 'needs_attention', '应停在 needs_attention 等人工/后续核实供应商状态');
  });

  // 追加全局 teardown：断开 infra/jobs 模块级单例连接，让 node --test 跑完
  // 事件循环无残留句柄、进程自然退出（不影响既有用例逻辑）。
  test.after(async () => {
    await shutdownJobs();
  });
}
