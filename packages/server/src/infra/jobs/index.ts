// infra/jobs/ —— 任务表适配（SKIP LOCKED、租约、幂等）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.3 + docs/decisions/0003-persistent-jobs.md。
//
// 本文件是「测试先行」阶段的接口签名占位：所有函数体先 throw NOT_IMPLEMENTED，
// 供 packages/server/tests/jobs.race.test.mjs 的六类竞态测试 + 错误分类测试编译期
// 引用、运行期全红。真正的 SKIP LOCKED / 条件更新 SQL 由后续两个并行 builder 实现，
// 不得私改本文件导出的函数签名（两个 builder 与 code-reviewer 共用同一契约）。
//
// Prisma 客户端类型只从 infra/db 消费（lint 边界规则：infra/** 下除 infra/db 外
// 禁止直接 import '@prisma/client'）。
import type { PrismaClient } from '../db/index.ts';

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

/**
 * 幂等创建任务。可在调用方事务内执行（传入事务句柄作为 client）。
 * 唯一索引 (ownerUserId, type, idempotencyKey) 冲突时返回既有 job 且 created=false。
 */
export function createJob(
  client: JobDbClient,
  params: CreateJobParams,
): Promise<CreateJobResult> {
  void client;
  void params;
  throw new Error('NOT_IMPLEMENTED');
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
export function claimNextJob(params: ClaimNextJobParams): Promise<JobRecord | null> {
  void params;
  throw new Error('NOT_IMPLEMENTED');
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
export function heartbeat(params: HeartbeatParams): Promise<boolean> {
  void params;
  throw new Error('NOT_IMPLEMENTED');
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
export function completeJob(params: CompleteJobParams): Promise<CompleteJobOutcome> {
  void params;
  throw new Error('NOT_IMPLEMENTED');
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
export function failJob(params: FailJobParams): Promise<FailJobOutcome> {
  void params;
  throw new Error('NOT_IMPLEMENTED');
}

export interface CancelJobParams {
  jobId: string;
  /** 若提供，仅当任务当前状态匹配才允许取消（条件更新）。 */
  expectedStatus?: JobStatus;
}

/** 取消任务。返回是否实际发生了取消（false = 状态不匹配未取消，或任务不存在）。 */
export function cancelJob(params: CancelJobParams): Promise<boolean> {
  void params;
  throw new Error('NOT_IMPLEMENTED');
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
export function recoverOrphans(
  params: RecoverOrphansParams,
): Promise<RecoverOrphanResult[]> {
  void params;
  throw new Error('NOT_IMPLEMENTED');
}
