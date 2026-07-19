// infra/jobs/ —— 任务表适配（SKIP LOCKED、租约、幂等）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.3 + docs/decisions/0003-persistent-jobs.md。
//
// 本文件是 WP-3.3 实现阶段的落地：接口签名冻结自测试先行阶段，不得变动
// （packages/server/tests/jobs.race.test.mjs 的 import 与调用方式即契约）。
// 认领/续租/完成/失败使用受控 raw SQL（ADR-0002 预期路径）：Prisma 7 的
// query builder 不表达 `SELECT ... FOR UPDATE SKIP LOCKED`，因此在
// `prisma.$transaction` 内用 `$queryRawUnsafe`/`$executeRawUnsafe` 完成
// 认领的原子读-锁-写；heartbeat/completeJob/failJob/cancelJob 用条件 UPDATE
// （WHERE 携带持锁者/版本前置条件），受影响行数 0 即代表竞态落败，不做
// 读改写（find 后再 update 两步会打开竞态窗口）。
//
// Prisma 客户端类型只从 infra/db 消费（lint 边界规则：infra/** 下除 infra/db 外
// 禁止直接 import '@prisma/client'）。本模块不读 process.env（lint 边界规则：
// process.env 只准在 infra/config/ 中读取）——DATABASE_URL 经 infra/config 的
// loadCommonConfig() 取得（该函数默认参数里才出现 process.env，位于
// infra/config/ 目录内，符合边界规则豁免范围）。
//
// ── 租约时间基准契约（重要，多机部署前必读）──────────────────────────────
// 本模块所有"当前时刻"比较（claimNextJob / heartbeat / recoverOrphans 里的
// leaseExpiresAt 过期判定）以**应用进程时钟**（Node 的 Date.now()）为基准，
// 把 `now` 作为参数下推到 SQL，而非使用 SQL 端 now()。这样规避了 RDS 会话
// 时区非 UTC（实测 Asia/Shanghai）导致的 8 小时级偏差（详见 claimNextJob
// 注释）。
//   成立前提：所有 worker 进程与孤儿恢复进程共享同一时钟源。当前部署为
//   ADR-0001 的单 ECS，此前提天然成立。
//   多机部署红线：一旦扩展到多台机器/多进程且各自本地时钟可能漂移，本基准
//   即失效（一台机器的 Date.now() 会与另一台的租约过期判定错位）。届时必须
//   迁移到 DB 端统一时间源——例如在连接层 `SET timezone='UTC'` 后改用 SQL
//   `now()` 做全部租约过期比较，让唯一时间基准落在数据库上，不再依赖各进程
//   本地时钟。
import type { PrismaClient } from '../db/index.ts';
import { createPrismaClient } from '../db/index.ts';
import { loadCommonConfig } from '../config/index.ts';

/** Job.status 取值集合（ADR-0003）。 */
export type JobStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'needs_attention';

/** Job.errorClass 取值集合（ADR-0003 机制 5：错误分类）。 */
export type JobErrorClass = 'retryable' | 'permanent' | 'canceled' | 'manual';

/**
 * createJob 可执行的最小数据库句柄：既可以是顶层 PrismaClient，也可以是
 * `prisma.$transaction(async (tx) => ...)` 回调里的事务句柄（两者结构兼容，
 * 调用方可以把任务创建纳入自己的业务事务，见 ADR-0003 机制 7）。
 */
export type JobDbClient = PrismaClient;

/**
 * 任务记录的最小字段集合。刻意不直接复用 Prisma 生成类型，避免占位签名提前
 * 耦合 generated client 的具体形状；实现阶段两者字段应保持一致（由 tsc 兜底）。
 */
export interface JobRecord {
  id: string;
  type: string;
  status: JobStatus;
  ownerUserId: string;
  input: unknown;
  idempotencyKey: string;
  targetVersion: number;
  attemptCount: number;
  maxAttempts: number;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  progress: unknown;
  errorClass: JobErrorClass | null;
  errorDetail: unknown;
  vendorTaskId: string | null;
  resultRef: unknown;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  archivedAt: Date | null;
}

export interface CreateJobParams {
  type: string;
  ownerUserId: string;
  input: unknown;
  /** 业务幂等键：同一 (ownerUserId, type, idempotencyKey) 只允许一行任务存在。 */
  idempotencyKey: string;
  targetVersion?: number;
  maxAttempts?: number;
}

export interface CreateJobResult {
  job: JobRecord;
  /** false = 唯一索引冲突命中已有行，返回既有 job，不创建新行（业务幂等）。 */
  created: boolean;
}

// ---------------------------------------------------------------------
// 模块级单例 Prisma client：claimNextJob/heartbeat/completeJob/failJob/
// cancelJob/recoverOrphans 六个函数不接受 client 参数（签名冻结），需要
// 自己持有到同一数据库的连接。DATABASE_URL 与连接池预算经 infra/config 的
// loadCommonConfig() 取得（该函数内部默认读 process.env，本文件不直接读）。
// ---------------------------------------------------------------------
let sharedClient: PrismaClient | null = null;

function getClient(): PrismaClient {
  if (!sharedClient) {
    const config = loadCommonConfig();
    if (!config.DATABASE_URL) {
      throw new Error(
        '[infra/jobs] DATABASE_URL 未配置——认领/续租/完成/失败/取消/孤儿恢复均需要数据库连接。',
      );
    }
    sharedClient = createPrismaClient({
      connectionString: config.DATABASE_URL,
      poolMax: config.WORKER_DB_POOL_MAX,
    });
  }
  return sharedClient;
}

/**
 * 断开模块级单例 Prisma client 并置空（幂等：未初始化或重复调用均安全）。
 * 用途：进程/脚本收尾时释放连接池，让事件循环无残留句柄、进程能自然退出
 * （否则单例连接会挂住 node --test / 一次性脚本，看似"卡住"实为等待连接关闭）。
 * 置空后下次调用任一 job 函数会经 getClient() 重新建连，因此可安全重复调用。
 */
export async function shutdownJobs(): Promise<void> {
  if (!sharedClient) return;
  const client = sharedClient;
  sharedClient = null;
  await client.$disconnect();
}

/**
 * 幂等创建任务。可在调用方事务内执行（传入事务句柄作为 client）。
 * 唯一索引 (ownerUserId, type, idempotencyKey) 冲突时返回既有 job 且 created=false。
 */
export async function createJob(
  client: JobDbClient,
  params: CreateJobParams,
): Promise<CreateJobResult> {
  const { type, ownerUserId, input, idempotencyKey, targetVersion, maxAttempts } = params;

  try {
    const job = await client.job.create({
      data: {
        type,
        ownerUserId,
        input: input as never,
        idempotencyKey,
        ...(targetVersion !== undefined ? { targetVersion } : {}),
        ...(maxAttempts !== undefined ? { maxAttempts } : {}),
      },
    });
    return { job: job as unknown as JobRecord, created: true };
  } catch (error) {
    // P2002 = 唯一约束冲突（业务幂等命中已有行）。回读既有行返回 created=false。
    if (isUniqueConstraintError(error)) {
      const existing = await client.job.findUniqueOrThrow({
        where: {
          job_owner_type_idempotency_key: {
            ownerUserId,
            type,
            idempotencyKey,
          },
        },
      });
      return { job: existing as unknown as JobRecord, created: false };
    }
    throw error;
  }
}

/**
 * 重开已耗尽的 retryable job。单条条件 UPDATE 保证并发重开只有一个获胜；
 * attemptCount 保持单调，避免与历史 JobAttempt(jobId, attemptNo) 唯一键冲突，
 * 并清掉上一代易变状态。targetVersion 递增阻止旧 worker 迟到完成。
 */
export async function reopenRetryableJob(
  client: JobDbClient,
  jobId: string,
  additionalAttempts = 3,
): Promise<boolean> {
  if (!Number.isInteger(additionalAttempts) || additionalAttempts <= 0) {
    throw new Error('additionalAttempts 必须是正整数');
  }
  const now = new Date();
  const affected = await client.$executeRawUnsafe(
    `UPDATE "job"
     SET status = 'pending',
         "maxAttempts" = "maxAttempts" + $2,
         "targetVersion" = "targetVersion" + 1,
         "leaseOwner" = NULL,
         "leaseExpiresAt" = NULL,
         progress = NULL,
         "errorClass" = NULL,
         "errorDetail" = NULL,
         "resultRef" = NULL,
         "startedAt" = NULL,
         "finishedAt" = NULL,
         "updatedAt" = $3
     WHERE id = $1
       AND status = 'failed'
       AND "errorClass" = 'retryable'`,
    jobId,
    additionalAttempts,
    now,
  );
  return affected > 0;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

export interface ClaimNextJobParams {
  workerId: string;
  types: string[];
  leaseSeconds: number;
}

/**
 * 原子认领下一个可执行任务：`SELECT … FOR UPDATE SKIP LOCKED`。
 * 候选集合 = pending 任务，或 running 且租约已过期的任务。
 * 认领成功后：置 running、写入 leaseOwner/leaseExpiresAt、attemptCount+1、
 * 写一行 JobAttempt。无可认领任务时返回 null。
 */
export async function claimNextJob(params: ClaimNextJobParams): Promise<JobRecord | null> {
  const { workerId, types, leaseSeconds } = params;
  if (types.length === 0) return null;

  const client = getClient();
  const now = new Date();

  const result = await client.$transaction(async (tx) => {
    // 候选集合内按 createdAt 排序取最早的一行，跳过已被其他事务锁住的行
    // （SKIP LOCKED 保证两个并发事务不会阻塞等待、也不会选中同一行）。
    //
    // 用应用层传入的 `now`（$2）而非 SQL 的 now()：RDS 会话时区可能不是 UTC
    // （实测 Asia/Shanghai），SQL 端 now() 与本模块其余基于 Date.now() 的
    // 比较会出现 8 小时级偏差，导致未过期的租约被误判为过期（曾实测复现：
    // 同一 job 被第二个 worker 立即重复认领）。所有"当前时刻"比较统一走应用层
    // 传参，规避服务器会话时区设置。
    //
    // 机制 2 护栏：过期 running 且已写回 vendorTaskId 的任务**排除**出候选集
    // ——这类任务可能供应商侧已完成/在途，直接抢来重跑会重复提交供应商任务；
    // 它们只能经 recoverOrphans 落到 needs_attention 等人工/后续核实，不得被
    // claimNextJob 直接抢占。pending 任务不受影响；无 vendorTaskId 的过期
    // running 仍可被直接抢（等价于普通孤儿，重跑无副作用）。
    const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "job"
       WHERE type = ANY($1::text[])
         AND (
           status = 'pending'
           OR (status = 'running' AND "leaseExpiresAt" < $2 AND "vendorTaskId" IS NULL)
         )
       ORDER BY "createdAt" ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      types,
      now,
    );

    const row = rows[0];
    if (!row) return null;

    const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000);

    const updated = await tx.job.update({
      where: { id: row.id },
      data: {
        status: 'running',
        leaseOwner: workerId,
        leaseExpiresAt,
        attemptCount: { increment: 1 },
        startedAt: now,
      },
    });

    await tx.jobAttempt.create({
      data: {
        jobId: updated.id,
        attemptNo: updated.attemptCount,
        workerId,
      },
    });

    return updated;
  });

  return result as unknown as JobRecord | null;
}

export interface HeartbeatParams {
  jobId: string;
  workerId: string;
  leaseSeconds: number;
  progress?: unknown;
}

/**
 * 条件续租：仅当 jobId 当前仍由 workerId 持有租约（未过期）才续期并可选更新 progress。
 * 返回 false 表示已失去租约（租约过期或被其他 worker 抢占），调用方必须停止当前工作。
 */
export async function heartbeat(params: HeartbeatParams): Promise<boolean> {
  const { jobId, workerId, leaseSeconds, progress } = params;
  const client = getClient();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000);

  // "当前时刻"用应用层参数（$5）而非 SQL now()：见 claimNextJob 同类注释
  // （RDS 会话时区非 UTC 会导致租约过期判断偏差）。
  const affected = await client.$executeRawUnsafe(
    `UPDATE "job"
     SET "leaseExpiresAt" = $1,
         "progress" = COALESCE($2::jsonb, "progress"),
         "updatedAt" = $5
     WHERE id = $3
       AND "leaseOwner" = $4
       AND status = 'running'
       AND "leaseExpiresAt" > $5`,
    leaseExpiresAt,
    progress !== undefined ? JSON.stringify(progress) : null,
    jobId,
    workerId,
    now,
  );

  return affected > 0;
}

export type CompleteJobOutcome = 'completed' | 'stale_version' | 'lost_lease';

export interface CompleteJobParams {
  jobId: string;
  workerId: string;
  /** 防迟到覆盖令牌：必须匹配 job.targetVersion 才允许写入 succeeded。 */
  targetVersion: number;
  resultRef: unknown;
}

/**
 * 条件完成：持有租约且 targetVersion 匹配 job.targetVersion 才写 succeeded。
 * - 版本不匹配 → 'stale_version'，不改任何数据（防迟到覆盖，ADR-0003 机制 3）；
 * - 租约已丢失（过期或被其他 worker 抢占）→ 'lost_lease'，不改任何数据。
 */
export async function completeJob(params: CompleteJobParams): Promise<CompleteJobOutcome> {
  const { jobId, workerId, targetVersion, resultRef } = params;
  const client = getClient();
  const now = new Date();

  const affected = await client.$executeRawUnsafe(
    `UPDATE "job"
     SET status = 'succeeded',
         "resultRef" = $1::jsonb,
         "finishedAt" = $5,
         "updatedAt" = $5
     WHERE id = $2
       AND "leaseOwner" = $3
       AND status = 'running'
       AND "targetVersion" = $4`,
    JSON.stringify(resultRef),
    jobId,
    workerId,
    targetVersion,
    now,
  );

  if (affected > 0) return 'completed';

  // 更新未命中：区分是版本过期（targetVersion 不匹配）还是租约已丢失
  // （leaseOwner 不匹配或 status 已不是 running）。读取当前行做事后分类。
  //
  // 已知近似：本次分类读取的是 UPDATE **之后**某一时刻的行状态，与 UPDATE
  // 未命中的瞬时真实原因之间存在竞态窗口——期间该行可能被其他 worker 再次
  // 修改，因此返回的 outcome（stale_version vs lost_lease）可能与"UPDATE 失败
  // 当刻的原因"不完全一致。此分类**仅用于日志/断言的可解释性，不得驱动任何
  // 控制流**（写入路径已经是原子条件更新，无论分类如何都不会覆盖数据；调用
  // 方不应据此 outcome 做重试/回滚等分支决策）。
  const current = await client.job.findUnique({ where: { id: jobId } });
  if (current && current.status === 'running' && current.targetVersion !== targetVersion) {
    return 'stale_version';
  }
  return 'lost_lease';
}

export type FailJobOutcome = 'retrying' | 'failed' | 'needs_attention' | 'lost_lease';

export interface FailJobParams {
  jobId: string;
  workerId: string;
  errorClass: JobErrorClass;
  errorDetail: unknown;
}

/**
 * 错误分类驱动的失败处理（ADR-0003 机制 5），单条条件更新 SQL 原子完成：
 * - retryable 且 attemptCount < maxAttempts → 回 pending（清租约），返回 'retrying'；
 * - retryable 且已达 maxAttempts，或 permanent → 'failed'；
 * - manual → 'needs_attention'；
 * - canceled 由 cancelJob 处理，不经过本函数。
 *
 * 落点由一条 CASE UPDATE 在 SQL 端计算（retryable 未超限=pending，否则终态），
 * WHERE 携带 leaseOwner + status='running' 前置条件；affected 行数 0（含失去
 * 租约、状态已非 running、job 不存在）→ 返回 'lost_lease'，不做读-改-写两步式。
 * 实际落点用 RETURNING status 判定，不回读第二条查询。
 */
export async function failJob(params: FailJobParams): Promise<FailJobOutcome> {
  const { jobId, workerId, errorClass, errorDetail } = params;
  const client = getClient();
  const detailJson = JSON.stringify(errorDetail);
  const now = new Date();

  // 单条 CASE 条件更新：SQL 端根据 errorClass 与 attemptCount/maxAttempts 决定
  // 新状态与租约字段，一次原子写入。仅 running 且 leaseOwner 匹配的行会被更新。
  //   - retryable 且 attemptCount < maxAttempts → pending，清租约（可再认领）；
  //   - retryable 已超限 / permanent → failed，写 finishedAt；
  //   - manual → needs_attention，写 finishedAt。
  const rows = await client.$queryRawUnsafe<Array<{ status: string }>>(
    `UPDATE "job"
     SET status = CASE
           WHEN $1 = 'retryable' AND "attemptCount" < "maxAttempts" THEN 'pending'
           WHEN $1 = 'manual' THEN 'needs_attention'
           ELSE 'failed'
         END,
         "leaseOwner" = CASE
           WHEN $1 = 'retryable' AND "attemptCount" < "maxAttempts" THEN NULL
           ELSE "leaseOwner"
         END,
         "leaseExpiresAt" = CASE
           WHEN $1 = 'retryable' AND "attemptCount" < "maxAttempts" THEN NULL
           ELSE "leaseExpiresAt"
         END,
         "finishedAt" = CASE
           WHEN $1 = 'retryable' AND "attemptCount" < "maxAttempts" THEN "finishedAt"
           ELSE $5
         END,
         "errorClass" = $1,
         "errorDetail" = $2::jsonb,
         "updatedAt" = $5
     WHERE id = $3
       AND "leaseOwner" = $4
       AND status = 'running'
     RETURNING status`,
    errorClass,
    detailJson,
    jobId,
    workerId,
    now,
  );

  const row = rows[0];
  // affected 0 行：失去租约 / 状态已非 running / job 不存在——竞态落败。
  if (!row) return 'lost_lease';

  // 实际落点由 RETURNING status 判定（不回读第二条查询）。
  if (row.status === 'pending') return 'retrying';
  if (row.status === 'needs_attention') return 'needs_attention';
  return 'failed';
}

export interface CancelJobParams {
  jobId: string;
  /** 若提供，仅当任务当前状态匹配才允许取消（条件更新）。 */
  expectedStatus?: JobStatus;
}

/** 取消任务。返回是否实际发生了取消（false = 状态不匹配未取消，或任务不存在）。 */
export async function cancelJob(params: CancelJobParams): Promise<boolean> {
  const { jobId, expectedStatus } = params;
  const client = getClient();
  const now = new Date();

  const affected = expectedStatus
    ? await client.$executeRawUnsafe(
        `UPDATE "job"
         SET status = 'canceled',
             "errorClass" = 'canceled',
             "finishedAt" = $3,
             "updatedAt" = $3
         WHERE id = $1
           AND status = $2`,
        jobId,
        expectedStatus,
        now,
      )
    : await client.$executeRawUnsafe(
        `UPDATE "job"
         SET status = 'canceled',
             "errorClass" = 'canceled',
             "finishedAt" = $2,
             "updatedAt" = $2
         WHERE id = $1`,
        jobId,
        now,
      );

  return affected > 0;
}

export interface RecoverOrphansParams {
  /** 判定"现在"的时刻，默认当前时间；测试可注入固定时刻。 */
  now?: Date;
}

export type RecoverOrphanAction = 'requeued' | 'needs_vendor_check';

export interface RecoverOrphanResult {
  jobId: string;
  action: RecoverOrphanAction;
}

/**
 * 孤儿任务恢复（ADR-0003 机制 2）：扫描 running 且租约已过期的任务。
 * - 存在 vendorTaskId → 置 needs_attention，返回 'needs_vendor_check'
 *   （不自动重跑；必须先由人工/后续流程查询供应商侧状态）；
 * - 不存在 vendorTaskId → 回 pending，返回 'requeued'（可再被认领）。
 */
export async function recoverOrphans(
  params: RecoverOrphansParams,
): Promise<RecoverOrphanResult[]> {
  const client = getClient();
  const now = params.now ?? new Date();

  return client.$transaction(async (tx) => {
    const orphans = await tx.$queryRawUnsafe<Array<{ id: string; vendorTaskId: string | null }>>(
      `SELECT id, "vendorTaskId" FROM "job"
       WHERE status = 'running'
         AND "leaseExpiresAt" < $1
       FOR UPDATE SKIP LOCKED`,
      now,
    );

    const results: RecoverOrphanResult[] = [];

    for (const orphan of orphans) {
      if (orphan.vendorTaskId) {
        await tx.job.update({
          where: { id: orphan.id },
          data: {
            status: 'needs_attention',
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        results.push({ jobId: orphan.id, action: 'needs_vendor_check' });
      } else {
        await tx.job.update({
          where: { id: orphan.id },
          data: {
            status: 'pending',
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        results.push({ jobId: orphan.id, action: 'requeued' });
      }
    }

    return results;
  });
}
