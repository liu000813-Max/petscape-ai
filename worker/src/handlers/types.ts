// worker/src/handlers/types.ts —— Job handler 契约（WP-3.4）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.4。
//
// 所有 job handler（当前只有 sample.echo，Phase C 起接入真实生成/切片任务时会
// 增加更多 type）实现同一个函数签名，供 worker/src/main.ts 的主循环按 job.type
// 分发调用。handler 只管"干活"，不管认领/心跳节奏/完成写库——那些是 main.ts
// 主循环的职责（心跳节奏由主循环按 leaseSeconds/3 周期调用，handler 通过
// reportProgress 回调把进度值传出去，由主循环把它写进下一次 heartbeat 调用）。

/** handler 抛出本类错误 → main.ts 主循环调用 failJob 时 errorClass='retryable'；
 *  其余任何错误（包括非本类的普通 Error）→ errorClass='permanent'。 */
export class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

export interface JobHandlerContext {
  /** 当前认领该任务的 workerId（供 handler 需要时使用，例如日志标注）。 */
  workerId: string;
  /** 归还最新进度值——由主循环在下一次心跳时携带写入 job.progress。
   *  不由 handler 直接调用 heartbeat（心跳节奏统一由主循环掌握，见 main.ts）。 */
  reportProgress(progress: unknown): void;
  /** 已装配好的 { prisma, oss }（WP-3.4：产物落地 Asset + 上传 OSS 需要）。 */
  server: { prisma: import('@petscape/server/worker-api').PrismaClient; oss: import('@petscape/server/worker-api').OssStorage };
}

/**
 * handler 执行成功后返回 resultRef（不透明值，由 completeJob 原样写入
 * job.resultRef；sample.echo 的约定形状见 sampleEcho.ts 的 SampleEchoResultRef）。
 * 执行失败：抛 RetryableError → 可重试；抛其他任何错误 → permanent（不重试）。
 */
export type JobHandler = (
  job: { id: string; ownerUserId: string; input: unknown },
  ctx: JobHandlerContext,
) => Promise<unknown>;
