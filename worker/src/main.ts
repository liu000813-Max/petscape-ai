// worker/src/main.ts —— Worker 进程正式主循环（WP-3.4）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.4 + docs/decisions/0003-persistent-jobs.md。
//
// 流程：启动加载 workerConfig → 循环 claimNextJob（候选 types 来自
// WORKER_JOB_TYPES）→ 认领成功则执行对应 handler（期间按 leaseSeconds/3
// 心跳，heartbeat 返回 false 立即放弃执行）→ completeJob/failJob（错误分类：
// handler 抛 RetryableError → retryable，其余 → permanent）→ 周期性单独跑
// recoverOrphans（与主认领循环解耦，用独立 setInterval 定时器）。
//
// 依赖 @petscape/server/worker-api（不经主入口 src/index.ts——那条路径带
// `import 'server-only'`，在裸 Node 进程下会直接抛错；worker-api 是本包为
// worker 专门开的不带 server-only 的子路径导出面，见 worker-api.ts 顶部注释
// 与 PR body 的裁决记录）。
import {
  loadWorkerConfig,
  loadCommonConfig,
  createPrismaClient,
  OssStorage,
  claimNextJob,
  heartbeat,
  completeJob,
  failJob,
  recoverOrphans,
  shutdownJobs,
  type JobRecord,
} from '@petscape/server/worker-api';
import { RetryableError, type JobHandler } from './handlers/types.ts';
import { sampleEchoHandler } from './handlers/sampleEcho.ts';

// 本地开发约定：worker/package.json 的 dev/start 脚本用
// `--env-file=../.env` 指向仓库根目录 `.env`；部署环境由 Compose 直接注入，
// 不依赖 --env-file。配置校验失败会抛出并列出全部缺失/非法键名，
// 让进程 fail-fast 退出（非 0 exit code），不静默带着坏配置继续跑。
const config = loadWorkerConfig();
const commonConfig = loadCommonConfig();

console.log('[worker] PetScape worker process starting (WP-3.4)');
console.log(`[worker] NODE_ENV=${config.NODE_ENV}, config schema validated OK`);

if (!commonConfig.DATABASE_URL) {
  throw new Error('[worker] DATABASE_URL 未配置——worker 主循环需要数据库连接才能认领任务。');
}

const missingOssKeys = (
  [
    ['ALIBABA_CLOUD_ACCESS_KEY_ID', commonConfig.ALIBABA_CLOUD_ACCESS_KEY_ID],
    ['ALIBABA_CLOUD_ACCESS_KEY_SECRET', commonConfig.ALIBABA_CLOUD_ACCESS_KEY_SECRET],
    ['ALIBABA_CLOUD_OSS_BUCKET', commonConfig.ALIBABA_CLOUD_OSS_BUCKET],
    ['ALIBABA_CLOUD_OSS_ENDPOINT', commonConfig.ALIBABA_CLOUD_OSS_ENDPOINT],
    ['ALIBABA_CLOUD_REGION', commonConfig.ALIBABA_CLOUD_REGION],
  ] as const
).filter(([, value]) => !value);
if (missingOssKeys.length > 0) {
  throw new Error(
    `[worker] 缺少以下 OSS 配置键：${missingOssKeys.map(([key]) => key).join(', ')}`,
  );
}

const prisma = createPrismaClient({
  connectionString: commonConfig.DATABASE_URL,
  poolMax: commonConfig.WORKER_DB_POOL_MAX,
});
const oss = new OssStorage({
  accessKeyId: commonConfig.ALIBABA_CLOUD_ACCESS_KEY_ID!,
  accessKeySecret: commonConfig.ALIBABA_CLOUD_ACCESS_KEY_SECRET!,
  bucket: commonConfig.ALIBABA_CLOUD_OSS_BUCKET!,
  endpoint: commonConfig.ALIBABA_CLOUD_OSS_ENDPOINT!,
  region: commonConfig.ALIBABA_CLOUD_REGION!,
});

const workerId = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const jobTypes = config.WORKER_JOB_TYPES.split(',').map((t) => t.trim()).filter(Boolean);
const leaseSeconds = config.WORKER_LEASE_SECONDS;
const heartbeatIntervalMs = Math.max(1000, Math.floor((leaseSeconds * 1000) / 3));

console.log(
  `[worker] workerId=${workerId} jobTypes=${jobTypes.join(',')} leaseSeconds=${leaseSeconds} pollIntervalMs=${config.WORKER_POLL_INTERVAL_MS} heartbeatIntervalMs=${heartbeatIntervalMs}`,
);

const handlers: Record<string, JobHandler> = {
  'sample.echo': sampleEchoHandler,
};

let shuttingDown = false;
let currentJobAbandoned = false;

/** SIGTERM/SIGINT 优雅退出：停止认领新任务；当前任务自然跑完（或心跳丢失后自行放弃，
 *  不强行 kill 正在执行的 handler——放租约交给租约自然过期 + recoverOrphans 兜底）。 */
function requestShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] 收到 ${signal}，停止认领新任务，等待当前任务结束后退出`);
}
process.on('SIGTERM', () => requestShutdown('SIGTERM'));
process.on('SIGINT', () => requestShutdown('SIGINT'));

/** 执行单个已认领 job：分发到对应 handler，期间按 leaseSeconds/3 心跳。 */
async function runJob(job: JobRecord): Promise<void> {
  const handler = handlers[job.type];
  if (!handler) {
    console.error(`[worker] job ${job.id} type=${job.type} 无对应 handler，标记 permanent 失败`);
    await failJob({
      jobId: job.id,
      workerId,
      errorClass: 'permanent',
      errorDetail: { message: `no handler registered for type=${job.type}` },
    });
    return;
  }

  let latestProgress: unknown;
  let leaseLost = false;

  const heartbeatTimer = setInterval(() => {
    void (async () => {
      const ok = await heartbeat({
        jobId: job.id,
        workerId,
        leaseSeconds,
        progress: latestProgress,
      });
      if (!ok) {
        leaseLost = true;
        console.error(`[worker] job ${job.id} 心跳失败（租约已丢失），放弃当前执行`);
        clearInterval(heartbeatTimer);
      }
    })();
  }, heartbeatIntervalMs);

  currentJobAbandoned = false;
  try {
    const resultRef = await handler(
      { id: job.id, ownerUserId: job.ownerUserId, input: job.input },
      {
        workerId,
        reportProgress: (progress) => {
          latestProgress = progress;
        },
        server: { prisma, oss },
      },
    );

    if (leaseLost) {
      currentJobAbandoned = true;
      console.error(`[worker] job ${job.id} 执行完成但租约已丢失，不写 completeJob（避免覆盖新持有者）`);
      return;
    }

    const outcome = await completeJob({
      jobId: job.id,
      workerId,
      targetVersion: job.targetVersion,
      resultRef,
    });
    console.log(`[worker] job ${job.id} completeJob outcome=${outcome}`);
  } catch (error) {
    if (leaseLost) {
      currentJobAbandoned = true;
      console.error(`[worker] job ${job.id} 执行失败且租约已丢失，不写 failJob`, error);
      return;
    }
    const errorClass = error instanceof RetryableError ? 'retryable' : 'permanent';
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[worker] job ${job.id} 执行失败（errorClass=${errorClass}）: ${message}`);
    const outcome = await failJob({
      jobId: job.id,
      workerId,
      errorClass,
      errorDetail: { message, stack: error instanceof Error ? error.stack : undefined },
    });
    console.log(`[worker] job ${job.id} failJob outcome=${outcome}`);
  } finally {
    clearInterval(heartbeatTimer);
  }
}

/** 主认领循环：无任务时按 WORKER_POLL_INTERVAL_MS 睡眠后重试；shuttingDown 时停止认领。 */
async function claimLoop(): Promise<void> {
  while (!shuttingDown) {
    let job: JobRecord | null = null;
    try {
      job = await claimNextJob({ workerId, types: jobTypes, leaseSeconds });
    } catch (error) {
      console.error('[worker] claimNextJob 出错，等待下一轮轮询', error);
    }

    if (!job) {
      await new Promise((resolve) => setTimeout(resolve, config.WORKER_POLL_INTERVAL_MS));
      continue;
    }

    console.log(`[worker] 认领任务 job=${job.id} type=${job.type}`);
    await runJob(job);
  }
  console.log('[worker] claimLoop 已停止（不再认领新任务）');
}

/** 孤儿恢复：独立定时器周期运行，与认领循环解耦（认领循环忙于执行长任务时孤儿恢复仍需按时跑）。 */
const recoverTimer = setInterval(() => {
  void recoverOrphans({}).then((results) => {
    if (results.length > 0) {
      console.log(`[worker] recoverOrphans 处理了 ${results.length} 个孤儿任务:`, results);
    }
  }).catch((error) => {
    console.error('[worker] recoverOrphans 出错', error);
  });
}, config.WORKER_RECOVER_ORPHANS_INTERVAL_MS);

async function main(): Promise<void> {
  await claimLoop();
  clearInterval(recoverTimer);
  await shutdownJobs();
  await prisma.$disconnect();
  console.log(`[worker] 进程退出（currentJobAbandoned=${currentJobAbandoned}）`);
  process.exit(0);
}

main().catch((error) => {
  console.error('[worker] 主循环异常退出', error);
  process.exit(1);
});
