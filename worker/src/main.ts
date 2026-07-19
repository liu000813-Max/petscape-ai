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
  logInfo,
  logWarn,
  logError,
  type JobRecord,
} from '@petscape/server/worker-api';
import { RetryableError, type JobHandler } from './handlers/types.ts';
import { sampleEchoHandler } from './handlers/sampleEcho.ts';
import { meshAnalysisHandler } from './handlers/meshAnalysis.ts';

// 本地开发约定：worker/package.json 的 dev/start 脚本用
// `--env-file=../.env` 指向仓库根目录 `.env`；部署环境由 Compose 直接注入，
// 不依赖 --env-file。配置校验失败会抛出并列出全部缺失/非法键名，
// 让进程 fail-fast 退出（非 0 exit code），不静默带着坏配置继续跑。
const config = loadWorkerConfig();
const commonConfig = loadCommonConfig();

logInfo('worker.starting', { nodeEnv: config.NODE_ENV });

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

logInfo('worker.config', {
  workerId,
  jobTypes: jobTypes.join(','),
  leaseSeconds,
  pollIntervalMs: config.WORKER_POLL_INTERVAL_MS,
  heartbeatIntervalMs,
});

const handlers: Record<string, JobHandler> = {
  'sample.echo': sampleEchoHandler,
  mesh_analysis: meshAnalysisHandler,
};

/**
 * WP-3.5：从 job.input 里尽力而为地取出 web 侧创建该任务时写入的 requestId
 * （见 application/jobs.ts SampleEchoInput._requestId）。取不到时返回
 * undefined——生命周期日志仍然打印，只是缺该关联字段（非 sample.echo 类型或
 * 非本链路创建的任务没有这个字段，属预期）。
 */
function extractRequestId(input: unknown): string | undefined {
  if (input && typeof input === 'object' && '_requestId' in input) {
    const value = (input as { _requestId?: unknown })._requestId;
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

let shuttingDown = false;
let currentJobAbandoned = false;

/** SIGTERM/SIGINT 优雅退出：停止认领新任务；当前任务自然跑完（或心跳丢失后自行放弃，
 *  不强行 kill 正在执行的 handler——放租约交给租约自然过期 + recoverOrphans 兜底）。 */
function requestShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logInfo('worker.shutdown.requested', { signal });
}
process.on('SIGTERM', () => requestShutdown('SIGTERM'));
process.on('SIGINT', () => requestShutdown('SIGINT'));

/** 执行单个已认领 job：分发到对应 handler，期间按 leaseSeconds/3 心跳。 */
async function runJob(job: JobRecord): Promise<void> {
  const requestId = extractRequestId(job.input);
  const claimedAt = Date.now();

  // WP-3.5：job 生命周期事件——claimed（认领成功，本函数入口即认领后）。
  logInfo('worker.job.claimed', { jobId: job.id, requestId, type: job.type, workerId });

  const handler = handlers[job.type];
  if (!handler) {
    logError('worker.job.no_handler', { jobId: job.id, requestId, type: job.type });
    await failJob({
      jobId: job.id,
      workerId,
      errorClass: 'permanent',
      errorDetail: { message: `no handler registered for type=${job.type}` },
    });
    logError('worker.job.failed', {
      jobId: job.id,
      requestId,
      durationMs: Date.now() - claimedAt,
      errorClass: 'permanent',
      err: `no handler registered for type=${job.type}`,
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
        logError('worker.job.heartbeat-lost', { jobId: job.id, requestId, workerId });
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
        server: {
          prisma,
          oss,
          meshAnalyzerPythonBin: config.MESH_ANALYZER_PYTHON_BIN,
        },
      },
    );

    if (leaseLost) {
      currentJobAbandoned = true;
      logWarn('worker.job.completed_after_lease_lost', {
        jobId: job.id,
        requestId,
        durationMs: Date.now() - claimedAt,
      });
      return;
    }

    const outcome = await completeJob({
      jobId: job.id,
      workerId,
      targetVersion: job.targetVersion,
      resultRef,
    });
    // WP-3.5：completed 事件记录从 claimed 到 completeJob 落地的执行耗时。
    logInfo('worker.job.completed', {
      jobId: job.id,
      requestId,
      durationMs: Date.now() - claimedAt,
      outcome,
    });
  } catch (error) {
    if (leaseLost) {
      currentJobAbandoned = true;
      logWarn('worker.job.failed_after_lease_lost', {
        jobId: job.id,
        requestId,
        durationMs: Date.now() - claimedAt,
        err: error,
      });
      return;
    }
    const errorClass = error instanceof RetryableError ? 'retryable' : 'permanent';
    const message = error instanceof Error ? error.message : String(error);
    const domainErrorCode =
      error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : undefined;
    const outcome = await failJob({
      jobId: job.id,
      workerId,
      errorClass,
      errorDetail: {
        ...(domainErrorCode ? { code: domainErrorCode } : {}),
        message,
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    // WP-3.5：failed 事件的 errorClass 字段即"任务失败计数"的日志聚合口径
    // （spec 明确指示不引指标系统，failed 事件自带 errorClass 供后续聚合）。
    logError('worker.job.failed', {
      jobId: job.id,
      requestId,
      durationMs: Date.now() - claimedAt,
      errorClass,
      outcome,
      err: error,
    });
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
      logError('worker.claimNextJob.error', { err: error });
    }

    if (!job) {
      await new Promise((resolve) => setTimeout(resolve, config.WORKER_POLL_INTERVAL_MS));
      continue;
    }

    await runJob(job);
  }
  logInfo('worker.claimLoop.stopped', {});
}

/** 孤儿恢复：独立定时器周期运行，与认领循环解耦（认领循环忙于执行长任务时孤儿恢复仍需按时跑）。 */
const recoverTimer = setInterval(() => {
  void recoverOrphans({}).then((results) => {
    // WP-3.5：orphan-recovered 事件——每个被恢复的孤儿任务各记一条。
    for (const result of results) {
      logInfo('worker.job.orphan-recovered', { jobId: result.jobId, action: result.action });
    }
  }).catch((error) => {
    logError('worker.recoverOrphans.error', { err: error });
  });
}, config.WORKER_RECOVER_ORPHANS_INTERVAL_MS);

async function main(): Promise<void> {
  await claimLoop();
  clearInterval(recoverTimer);
  await shutdownJobs();
  await prisma.$disconnect();
  logInfo('worker.exiting', { currentJobAbandoned });
  process.exit(0);
}

main().catch((error) => {
  logError('worker.main.crashed', { err: error });
  process.exit(1);
});
