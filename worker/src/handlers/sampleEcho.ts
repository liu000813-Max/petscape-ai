// worker/src/handlers/sampleEcho.ts —— sample.echo job handler（WP-3.4）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.4。
//
// 样例任务：input 含文本与 sleepMs（模拟长任务、覆盖多次心跳周期）。
// 执行：按 sleepMs 分段 sleep（每段之间上报进度，供主循环下次心跳带出），
// 完成后把结果写成 JSON 产物，经 packages/server 的 OSS 适配器上传到
// `uploads/generated/{ownerUserId}/{jobId}/result.json`，并登记一行
// status='available' 的 Asset（这样才能复用 WP-3.2 的 getAssetDownloadUrl
// 签发签名 URL 下载，满足 WP-3.4 验收 1"结果 Asset 可查可下载"）。
//
// 与 application/jobs.ts 的 SampleEchoInput 是同一份契约的两端。
import type { JobHandler } from './types.ts';
import type { SampleEchoInput, JobSummary } from '@petscape/server/application';

/** completeJob 的 resultRef 形状（sample.echo 专属约定）。 */
export interface SampleEchoResultRef {
  assetId: string;
  ossKey: string;
}

// 长任务分段 sleep 的步长：足够小以便在 sleepMs 较大时产生多次进度上报
// （覆盖多次心跳周期是 spec 明确要求的验证点），又不至于让极短 sleepMs
// 的样例任务被步长本身拖慢太多。
const PROGRESS_STEP_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const sampleEchoHandler: JobHandler = async (job, ctx) => {
  const input = job.input as SampleEchoInput;
  const sleepMs = input.sleepMs ?? 0;

  const steps = sleepMs > 0 ? Math.ceil(sleepMs / PROGRESS_STEP_MS) : 0;
  for (let i = 0; i < steps; i += 1) {
    const remaining = sleepMs - i * PROGRESS_STEP_MS;
    await sleep(Math.min(PROGRESS_STEP_MS, remaining));
    ctx.reportProgress({ step: i + 1, totalSteps: steps, percent: Math.round(((i + 1) / steps) * 100) });
  }

  const { prisma, oss } = ctx.server;

  // 产物内容：原样回显输入文本 + 执行元数据，够验证"产物文件经 OSS 适配器上传、
  // resultRef 记 ossKey、经签名 URL 下载后内容可核验"这条端到端链路。
  const resultPayload = {
    echo: input.text,
    sleepMs,
    jobId: job.id,
    processedAt: new Date().toISOString(),
  };
  const resultJson = JSON.stringify(resultPayload, null, 2);
  const ossKey = `uploads/generated/${job.ownerUserId}/${job.id}/result.json`;

  await oss.put(ossKey, resultJson);

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

  const resultRef: SampleEchoResultRef = { assetId: asset.id, ossKey };
  return resultRef;
};

export type { JobSummary };
