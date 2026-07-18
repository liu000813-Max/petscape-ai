// packages/server/scripts/jobs-contention-probe.mjs
// spec: docs/plans/phase-b-execution-plan.md WP-3.3 验收 4 / ADR-0003 验证条件 9。
//
// 一次性争用小测：以预期峰值的显著倍数（1000 个任务，4 并发 worker）验证
// SKIP LOCKED 认领链路在争用下的耗时特征，产出总耗时、平均/最大认领延迟，
// 作为"重新评估 pg-boss/分区表/独立消息系统"的触发指标基线记录进 PR body。
//
// 不是常驻测试，不接入 `pnpm test`（无 DATABASE_URL 门禁），需要本地/RDS
// PostgreSQL 且已 migrate deploy。跑法（NODE_ENV 必须显式设置——直接 `node`
// 运行不像 `node --test` 那样自动注入 NODE_ENV=test，而 infra/jobs 内部
// 经 infra/config 的 loadCommonConfig() 校验 NODE_ENV 为必需键）：
//   NODE_ENV=development DATABASE_URL=postgresql://postgres:postgres@localhost:55432/petscape_wp33 \
//     node scripts/jobs-contention-probe.mjs
//
// 每个 worker 循环执行：claimNextJob → 立即 completeJob（targetVersion 默认 1，
// 与 createJob 未显式传入 targetVersion 时的默认值一致）。脚本结束时清理本次
// 写入的所有 job（按 ownerUserId 前缀），不在数据库留垃圾行。

import { createJob, claimNextJob, completeJob, shutdownJobs } from '../src/infra/jobs/index.ts';
import { createPrismaClient } from '../src/infra/db/index.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL not set. Aborting contention probe.');
  process.exit(1);
}

const JOB_COUNT = 1000;
const WORKER_COUNT = 4;
const TYPE = 'contention-probe';
const runId = `contention-probe-${Date.now()}`;

const prisma = createPrismaClient({ connectionString: databaseUrl, poolMax: 20 });

async function main() {
  console.log(`[probe] creating ${JOB_COUNT} jobs (owner prefix: ${runId}) ...`);
  const createStart = Date.now();
  for (let i = 0; i < JOB_COUNT; i += 1) {
    await createJob(prisma, {
      type: TYPE,
      ownerUserId: `${runId}-${i}`,
      input: { i },
      idempotencyKey: `probe-${i}`,
    });
  }
  const createMs = Date.now() - createStart;
  console.log(`[probe] created ${JOB_COUNT} jobs in ${createMs}ms`);

  const claimLatencies = [];
  let claimedTotal = 0;

  async function workerLoop(workerId) {
    for (;;) {
      const claimStart = Date.now();
      const job = await claimNextJob({ workerId, types: [TYPE], leaseSeconds: 30 });
      const claimMs = Date.now() - claimStart;
      if (!job) break;
      claimLatencies.push(claimMs);
      claimedTotal += 1;

      const outcome = await completeJob({
        jobId: job.id,
        workerId,
        targetVersion: job.targetVersion,
        resultRef: { done: true },
      });
      if (outcome !== 'completed') {
        console.warn(`[probe] unexpected completeJob outcome for ${job.id}: ${outcome}`);
      }
    }
  }

  console.log(`[probe] running ${WORKER_COUNT} concurrent workers against ${JOB_COUNT} jobs ...`);
  const runStart = Date.now();
  await Promise.all(
    Array.from({ length: WORKER_COUNT }, (_, i) => workerLoop(`probe-worker-${i}`)),
  );
  const runMs = Date.now() - runStart;

  const avgClaimMs =
    claimLatencies.reduce((a, b) => a + b, 0) / (claimLatencies.length || 1);
  const maxClaimMs = claimLatencies.reduce((a, b) => Math.max(a, b), 0);

  console.log('--- jobs-contention-probe results ---');
  console.log(`job_count: ${JOB_COUNT}`);
  console.log(`worker_count: ${WORKER_COUNT}`);
  console.log(`jobs_created_ms: ${createMs}`);
  console.log(`jobs_claimed_total: ${claimedTotal}`);
  console.log(`total_claim_and_complete_ms: ${runMs}`);
  console.log(`avg_claim_latency_ms: ${avgClaimMs.toFixed(2)}`);
  console.log(`max_claim_latency_ms: ${maxClaimMs}`);
  console.log(`throughput_jobs_per_sec: ${(claimedTotal / (runMs / 1000)).toFixed(2)}`);

  if (claimedTotal !== JOB_COUNT) {
    console.error(
      `[probe] MISMATCH: claimed ${claimedTotal} but expected ${JOB_COUNT} (possible lost job or bug)`,
    );
  }
}

async function cleanup() {
  const deleted = await prisma.job.deleteMany({
    where: { ownerUserId: { startsWith: runId } },
  });
  console.log(`[probe] cleaned up ${deleted.count} jobs (owner prefix: ${runId})`);
  await prisma.$disconnect();
  // 断开 infra/jobs 的模块级单例连接（claimNextJob/completeJob 用的是它，
  // 不是脚本本地的 prisma）；否则该连接会挂住事件循环，脚本无法自然退出。
  await shutdownJobs();
}

main()
  .catch((error) => {
    console.error('[probe] failed:', error);
    process.exitCode = 1;
  })
  .finally(cleanup);
