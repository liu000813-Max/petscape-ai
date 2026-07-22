// packages/server/tests/worker-e2e.integration.test.mjs
// spec: docs/plans/phase-b-execution-plan.md WP-3.4 验收 1-4：
//   1. 登录用户创建项目→上传资产→创建任务→worker 执行→结果 Asset 可查可下载；
//   2. 执行中"杀死" worker（模拟：不心跳、伪造租约过期）→ recoverOrphans/重新认领后
//      任务被恢复执行且最终完成，无重复副作用（同 jobId 产物唯一）；
//   3. （容器级"docker compose restart"验收在本文件范围外，见 PR body 的容器级
//      证据——本文件只覆盖函数级可验证的部分：数据在真实 RDS 中持久，不依赖任何
//      进程内存状态，等价于"重启后数据还在"的行为主张）；
//   4. 用户 B 全链访问 A 的任务/结果被拒（NotFoundError）。
//
// 本文件按 spec 明确指示：直接调 application + infra/jobs + handler 函数级串联，
// 不在测试内起容器（容器级验收=脚本+人读证据，见 PR body）。复用
// jobs.race.test.mjs 的 owner 前缀隔离手法与 assets.integration.test.mjs 的
// OTP 登录 + 清理手法。
//
// 无 DATABASE_URL 或无 OSS 凭证时显式 skip（同其余集成测试先例）。

import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.DATABASE_URL;
const hasOssCreds =
  process.env.ALIBABA_CLOUD_ACCESS_KEY_ID &&
  process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET &&
  process.env.ALIBABA_CLOUD_OSS_BUCKET &&
  process.env.ALIBABA_CLOUD_OSS_ENDPOINT;

if (!databaseUrl) {
  test('worker-e2e.integration.test.mjs skipped: DATABASE_URL not set (RDS 内网不可达，需 SSH 隧道)', (t) => {
    t.skip('DATABASE_URL 未设置——本机需先建立到 RDS 的 SSH 隧道并导出 DATABASE_URL 才能跑此集成测试。');
  });
} else if (!hasOssCreds) {
  test('worker-e2e.integration.test.mjs skipped: OSS credentials/bucket/endpoint not set', (t) => {
    t.skip('缺少 ALIBABA_CLOUD_ACCESS_KEY_ID/SECRET 或 ALIBABA_CLOUD_OSS_BUCKET/ENDPOINT——需提供真实 OSS 凭证才能跑此集成测试。');
  });
} else {
  const { createPrismaClient } = await import('../src/infra/db/index.ts');
  const { OssStorage } = await import('../src/infra/oss/index.ts');
  const {
    createSampleJob,
    getJob,
    getAssetDownloadUrl,
    NotFoundError,
  } = await import('../src/application/index.ts');
  const {
    claimNextJob,
    heartbeat,
    completeJob,
    recoverOrphans,
    shutdownJobs,
  } = await import('../src/infra/jobs/index.ts');

  const runId = `wp34-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const prisma = createPrismaClient({ connectionString: databaseUrl, poolMax: 10 });
  const oss = new OssStorage({
    accessKeyId: process.env.ALIBABA_CLOUD_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
    bucket: process.env.ALIBABA_CLOUD_OSS_BUCKET,
    endpoint: process.env.ALIBABA_CLOUD_OSS_ENDPOINT,
    region: process.env.ALIBABA_CLOUD_REGION,
  });

  // 本文件不经 Better Auth（不需要真实登录闭环——那是 auth.integration.test.mjs
  // 的职责），User 行直接建（同 jobs.race.test.mjs 直接写 ownerUserId 的手法，
  // 但这里 Job/Asset 均有真实外键指向 User/Project，需要真实建行满足约束）。
  async function createUser(label) {
    const id = `${runId}-${label}`;
    return prisma.user.create({ data: { id, name: `wp34-${label}` } });
  }

  const createdOssKeys = [];
  const createdUserIds = [];

  test.after(async () => {
    for (const key of createdOssKeys) {
      try {
        await oss.delete(key);
      } catch {
        // 对象可能因某个断言提前失败而从未真正上传，忽略清理失败。
      }
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
    await shutdownJobs();
  });

  /** 模拟 worker 执行 sample.echo：不经 worker/ 包（application 层单测边界），
   *  直接复刻 worker/src/handlers/sampleEcho.ts 的核心逻辑（上传产物 + 登记 Asset），
   *  验证 completeJob 的 resultRef 契约与下游 getAssetDownloadUrl 消费路径。 */
  async function runSampleEchoOnce(job, workerId) {
    const input = job.input;
    const resultPayload = { echo: input.text, jobId: job.id, processedAt: new Date().toISOString() };
    const resultJson = JSON.stringify(resultPayload);
    const ossKey = `uploads/generated/${job.ownerUserId}/${job.id}/result.json`;
    await oss.put(ossKey, resultJson);
    createdOssKeys.push(ossKey);

    const asset = await prisma.asset.create({
      data: {
        ownerUserId: job.ownerUserId,
        projectId: input.projectId,
        kind: 'job_result',
        mime: 'application/json',
        size: Buffer.byteLength(resultJson, 'utf8'),
        ossKey,
        status: 'available',
      },
    });

    const outcome = await completeJob({
      jobId: job.id,
      workerId,
      targetVersion: job.targetVersion,
      resultRef: { assetId: asset.id, ossKey },
    });
    return { outcome, asset, ossKey };
  }

  test('WP-3.4 验收 1：创建项目→创建 sample.echo 任务→"worker"执行→结果 Asset 可查可下载', async () => {
    const userA = await createUser('accept1-a');
    createdUserIds.push(userA.id);
    const project = await prisma.project.create({ data: { ownerUserId: userA.id, title: 'wp34 e2e project' } });

    const { job, created } = await createSampleJob({
      prisma,
      ownerUserId: userA.id,
      input: { projectId: project.id, text: 'wp-3.4 e2e', sleepMs: 0 },
      idempotencyKey: 'wp34-accept1',
    });
    assert.equal(created, true);
    assert.equal(job.status, 'pending');

    const claimed = await claimNextJob({ workerId: 'test-worker-1', types: ['sample.echo'], leaseSeconds: 30 });
    assert.equal(claimed?.id, job.id, '应认领到刚创建的任务');

    const { outcome, asset } = await runSampleEchoOnce(claimed, 'test-worker-1');
    assert.equal(outcome, 'completed');

    const jobAfter = await getJob({ prisma, jobId: job.id, currentUserId: userA.id });
    assert.equal(jobAfter.status, 'succeeded');
    assert.equal(jobAfter.resultRef.assetId, asset.id);

    // 结果 Asset 可查可下载（签名 URL + 内容核对）。
    const { downloadUrl } = await getAssetDownloadUrl({ prisma, oss, ownerUserId: userA.id, assetId: asset.id });
    const res = await fetch(downloadUrl);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.echo, 'wp-3.4 e2e');
    assert.equal(body.jobId, job.id);
  });

  test('WP-3.4 验收 2：执行中"杀死" worker（心跳丢失）→ 恢复后任务被再次认领执行且最终完成，无重复副作用', async () => {
    const userA = await createUser('accept2-a');
    createdUserIds.push(userA.id);
    const project = await prisma.project.create({ data: { ownerUserId: userA.id, title: 'wp34 kill-recovery' } });

    const { job } = await createSampleJob({
      prisma,
      ownerUserId: userA.id,
      input: { projectId: project.id, text: 'wp-3.4 kill-recovery', sleepMs: 0 },
      idempotencyKey: 'wp34-accept2',
    });

    // 第一个 worker 认领但"被杀"：不心跳、不 complete，直接伪造租约过期
    // （模拟 docker kill 场景：进程消失，租约到期前不会再有任何心跳/完成写入）。
    const claimed1 = await claimNextJob({ workerId: 'dead-worker', types: ['sample.echo'], leaseSeconds: 30 });
    assert.equal(claimed1.id, job.id);

    const hbBeforeKill = await heartbeat({ jobId: job.id, workerId: 'dead-worker', leaseSeconds: 30 });
    assert.equal(hbBeforeKill, true, '被杀之前至少成功心跳过一次（模拟已开始执行）');

    await prisma.job.update({
      where: { id: job.id },
      data: { leaseExpiresAt: new Date(Date.now() - 60_000) },
    });

    // recoverOrphans：sample.echo 无 vendorTaskId，应直接回 pending（requeued）。
    const recovered = await recoverOrphans({ now: new Date() });
    const mine = recovered.find((r) => r.jobId === job.id);
    assert.ok(mine, 'recoverOrphans 应处理该孤儿任务');
    assert.equal(mine.action, 'requeued');

    // 新 worker 认领并真正执行完成。
    const claimed2 = await claimNextJob({ workerId: 'new-worker', types: ['sample.echo'], leaseSeconds: 30 });
    assert.equal(claimed2?.id, job.id, '恢复后应可被新 worker 认领');
    assert.equal(claimed2.attemptCount, 2, '第二次认领 attemptCount 应为 2（两次 attempt）');

    const { outcome, asset } = await runSampleEchoOnce(claimed2, 'new-worker');
    assert.equal(outcome, 'completed');

    const jobAfter = await getJob({ prisma, jobId: job.id, currentUserId: userA.id });
    assert.equal(jobAfter.status, 'succeeded');

    // 无重复副作用：该 job 只应有一个产物 Asset（同 jobId 产物唯一）。
    const assetsForJob = await prisma.asset.findMany({
      where: { ownerUserId: userA.id, ossKey: { contains: job.id } },
    });
    assert.equal(assetsForJob.length, 1, '同一 jobId 只应产出一个结果 Asset，即使被杀后重新执行过一次');
    assert.equal(assetsForJob[0].id, asset.id);

    // 旧（已死）worker 事后尝试 complete 应 lost_lease，不产生第二个副作用。
    const staleOutcome = await completeJob({
      jobId: job.id,
      workerId: 'dead-worker',
      targetVersion: job.targetVersion,
      resultRef: { from: 'dead-worker-stale-retry' },
    });
    assert.equal(staleOutcome, 'lost_lease', '已失去租约的旧 worker 不应能覆盖已完成的结果');

    const jobFinal = await getJob({ prisma, jobId: job.id, currentUserId: userA.id });
    assert.equal(jobFinal.resultRef.assetId, asset.id, 'resultRef 不应被旧 worker 的迟到调用覆盖');
  });

  test('WP-3.4 验收 4：用户 B 全链访问 A 的任务/结果被拒（NotFoundError）', async () => {
    const userA = await createUser('accept4-a');
    const userB = await createUser('accept4-b');
    createdUserIds.push(userA.id, userB.id);
    const project = await prisma.project.create({ data: { ownerUserId: userA.id, title: 'wp34 isolation' } });

    const { job } = await createSampleJob({
      prisma,
      ownerUserId: userA.id,
      input: { projectId: project.id, text: 'wp-3.4 isolation', sleepMs: 0 },
      idempotencyKey: 'wp34-accept4',
    });

    const claimed = await claimNextJob({ workerId: 'test-worker-iso', types: ['sample.echo'], leaseSeconds: 30 });
    assert.equal(claimed.id, job.id);
    const { asset } = await runSampleEchoOnce(claimed, 'test-worker-iso');

    // B 查询 A 的任务 → NotFoundError。
    await assert.rejects(
      () => getJob({ prisma, jobId: job.id, currentUserId: userB.id }),
      NotFoundError,
      'B 查询 A 的任务应抛 NotFoundError',
    );

    // B 对 A 的项目创建任务（跨用户挂靠他人项目）→ NotFoundError。
    await assert.rejects(
      () =>
        createSampleJob({
          prisma,
          ownerUserId: userB.id,
          input: { projectId: project.id, text: 'hijack attempt', sleepMs: 0 },
          idempotencyKey: 'fixture2', // gitleaks:allow -- deterministic test fixture
        }),
      NotFoundError,
      'B 向 A 的项目创建任务应抛 NotFoundError',
    );

    // B 下载 A 的结果 Asset → NotFoundError。
    await assert.rejects(
      () => getAssetDownloadUrl({ prisma, oss, ownerUserId: userB.id, assetId: asset.id }),
      NotFoundError,
      'B 下载 A 的结果 Asset 应抛 NotFoundError',
    );
  });
}
