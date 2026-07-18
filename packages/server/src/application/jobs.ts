// application/jobs.ts —— 任务用例（WP-3.4）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.4。
//
// 本层不直接 import @prisma/client（lint 边界规则）；PrismaClient 类型经
// infra/db 转发。createSampleJob 复用 WP-3.3 的 infra/jobs createJob（同事务语义，
// 业务幂等键由调用方——本例即 web Route Handler——传入，本层不生造幂等键）。
//
// 样例任务类型固定为 'sample.echo'（WP-3.4 spec 明确指示的示例任务），
// input 形状见 SampleEchoInput：worker 侧 handler（worker/src/handlers/sampleEcho.ts）
// 与此处的输入类型是同一份契约的两端，任何一边改动都要同步。
import type { PrismaClient } from '../infra/db/index.ts';
import { createJob, type JobRecord } from '../infra/jobs/index.ts';
import { assertOwner, NotFoundError } from '../domain/index.ts';

export { NotFoundError };

export const SAMPLE_ECHO_JOB_TYPE = 'sample.echo';

export interface SampleEchoInput {
  /** 任务归属项目——worker 完成后落地的 Asset 挂在该项目下（Asset.projectId 非空关系）。 */
  projectId: string;
  /** 任意文本，worker 侧原样写回产物 JSON。 */
  text: string;
  /** 模拟长任务耗时（毫秒）——用于覆盖多次心跳周期，验证 leaseSeconds/3 心跳节奏。 */
  sleepMs?: number;
  /**
   * WP-3.5：创建该任务的 API 请求的 requestId（web 侧 crypto.randomUUID()
   * 生成，见 web/app/lib/server-context.ts 的 withApiLogging）。不改 Job
   * schema——借用 input 字段透传，worker 侧 job 生命周期日志据此把 API 入口
   * 日志与任务执行日志用同一关联 ID 串起。可选：非本模块直接创建的任务
   * （如未来其他任务类型）不强制携带。
   */
  _requestId?: string;
}

export interface JobSummary {
  id: string;
  type: string;
  status: JobRecord['status'];
  ownerUserId: string;
  input: unknown;
  progress: unknown;
  resultRef: unknown;
  errorClass: JobRecord['errorClass'];
  errorDetail: unknown;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
}

export interface CreateSampleJobInput {
  prisma: PrismaClient;
  ownerUserId: string;
  input: SampleEchoInput;
  /** 业务幂等键：由调用方（Route Handler/客户端）提供，同一 key 重复请求只成立一个任务。 */
  idempotencyKey: string;
}

export interface CreateSampleJobResult {
  job: JobSummary;
  /** false = 幂等键命中已有任务，未创建新行。 */
  created: boolean;
}

/**
 * 创建一个 sample.echo 任务，归属当前登录用户。
 * 目标项目必须属于当前用户（否则 NotFoundError，同 requestAssetUpload 先例）——
 * worker 完成后落地的 Asset 强制关联 projectId，提前校验避免任务创建成功但
 * worker 执行阶段才发现项目不属于该用户/不存在。
 */
export async function createSampleJob({
  prisma,
  ownerUserId,
  input,
  idempotencyKey,
}: CreateSampleJobInput): Promise<CreateSampleJobResult> {
  const project = await prisma.project.findUnique({ where: { id: input.projectId } });
  assertOwner(project, ownerUserId, 'Project');

  const { job, created } = await createJob(prisma, {
    type: SAMPLE_ECHO_JOB_TYPE,
    ownerUserId,
    input,
    idempotencyKey,
  });
  return { job: toSummary(job), created };
}

export interface GetJobInput {
  prisma: PrismaClient;
  jobId: string;
  currentUserId: string;
}

/**
 * 查询单个任务状态 + 结果引用，非 owner 访问抛 NotFoundError
 * （对应 Route Handler 的 404 语义，同 WP-3.2 的 getProject 先例）。
 */
export async function getJob({ prisma, jobId, currentUserId }: GetJobInput): Promise<JobSummary> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  assertOwner(job, currentUserId, 'Job');
  return toSummary(job as unknown as JobRecord);
}

function toSummary(job: JobRecord): JobSummary {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    ownerUserId: job.ownerUserId,
    input: job.input,
    progress: job.progress,
    resultRef: job.resultRef,
    errorClass: job.errorClass,
    errorDetail: job.errorDetail,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
  };
}
