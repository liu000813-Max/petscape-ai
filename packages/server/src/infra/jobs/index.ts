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
    const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "job"
       WHERE type = ANY($1::text[])
         AND (status = 'pending' OR (status = 'running' AND "leaseExpiresAt" < $2))
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
  // （leaseOwner 不匹配或 status 已不是 running）。读取当前行做事后分类——
  // 这里不影响正确性，因为写入路径已经是原子条件更新，本次分类只是给调用方
  // 一个可解释的失败原因，不会覆盖任何数据。
  const current = await client.job.findUnique({ where: { id: jobId } });
  if (current && current.status === 'running' && current.targetVersion !== targetVersion) {
    return 'stale_version';
  }
  return 'lost_lease';
}

export type FailJobOutcome = 'retrying' | 'failed' | 'needs_attention';

export interface FailJobParams {
  jobId: string;
  workerId: string;
  errorClass: JobErrorClass;
  errorDetail: unknown;
}

/**
 * 错误分类驱动的失败处理（ADR-0003 机制 5）：
 * - retryable 且 attemptCount < maxAttempts → 回 pending（清租约），返回 'retrying'；
 * - retryable 且已达 maxAttempts，或 permanent → 'failed'；
 * - manual → 'needs_attention'；
 * - canceled 由 cancelJob 处理，不经过本函数。
 */
export async function failJob(params: FailJobParams): Promise<FailJobOutcome> {
  const { jobId, workerId, errorClass, errorDetail } = params;
  const client = getClient();

  const current = await client.job.findUnique({ where: { id: jobId } });
  if (!current) {
    throw new Error(`[infra/jobs] failJob: job ${jobId} 不存在`);
  }

  let outcome: FailJobOutcome;
  let nextStatus: JobStatus;
  if (errorClass === 'retryable') {
    if (current.attemptCount < current.maxAttempts) {
      outcome = 'retrying';
      nextStatus = 'pending';
    } else {
      outcome = 'failed';
      nextStatus = 'failed';
    }
  } else if (errorClass === 'permanent') {
    outcome = 'failed';
    nextStatus = 'failed';
  } else {
    // manual（canceled 走 cancelJob，不经过本函数）。
    outcome = 'needs_attention';
    nextStatus = 'needs_attention';
  }

  const detailJson = JSON.stringify(errorDetail);
  const now = new Date();

  if (nextStatus === 'pending') {
    await client.$executeRawUnsafe(
      `UPDATE "job"
       SET status = 'pending',
           "leaseOwner" = NULL,
           "leaseExpiresAt" = NULL,
           "errorClass" = $1,
           "errorDetail" = $2::jsonb,
           "updatedAt" = $5
       WHERE id = $3
         AND "leaseOwner" = $4`,
      errorClass,
      detailJson,
      jobId,
      workerId,
      now,
    );
  } else {
    await client.$executeRawUnsafe(
      `UPDATE "job"
       SET status = $1,
           "errorClass" = $2,
           "errorDetail" = $3::jsonb,
           "finishedAt" = $6,
           "updatedAt" = $6
       WHERE id = $4
         AND "leaseOwner" = $5`,
      nextStatus,
      errorClass,
      detailJson,
      jobId,
      workerId,
      now,
    );
  }

  return outcome;
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
