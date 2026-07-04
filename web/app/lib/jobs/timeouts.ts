export class JobTimeoutError extends Error {
  readonly jobType: string;
  readonly timeoutMs: number;

  constructor(jobType: string, timeoutMs: number) {
    super(`${jobType} timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'JobTimeoutError';
    this.jobType = jobType;
    this.timeoutMs = timeoutMs;
  }
}

export const JOB_TIMEOUT_MS = {
  agentReply: 180_000,
  renderImage: 120_000, // fal.ai nano-banana 实测 ~8-12s，留足重试/网络余量
  cleanItem: 120_000,
  revise: 120_000, // fal edit 改图，~10-12s，留足重试/网络余量
  meshy: 15 * 60_000,
  slice: 10 * 60_000,
} as const;

export type TimedJobType = keyof typeof JOB_TIMEOUT_MS;

export function userTimeoutMessage(jobType: TimedJobType) {
  if (jobType === 'cleanItem' || jobType === 'renderImage' || jobType === 'agentReply' || jobType === 'revise')
    return '生成超时，请再发一条消息重试';
  if (jobType === 'meshy') return '3D 生成超时，请回复“重试”再试一次';
  if (jobType === 'slice') return '切片超时，请回复“重试切片”再试一次';
  return '处理超时，请再试一次';
}

export async function withTimeout<T>(
  jobType: TimedJobType,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new JobTimeoutError(jobType, timeoutMs));
      }, timeoutMs);
      run(controller.signal).then(resolve, reject);
    });
  } finally {
    if (timeout) clearTimeout(timeout);
    // Ensure downstream SDK/child process is signalled even if Promise.race rejects first.
    if (!controller.signal.aborted) controller.abort();
  }
}

export async function runCodexTurn<T>(
  jobType: TimedJobType,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const started = Date.now();
  console.log(`[codex] start type=${jobType} timeoutMs=${timeoutMs}`);
  try {
    const result = await withTimeout(jobType, timeoutMs, run);
    console.log(`[codex] success type=${jobType} elapsedMs=${Date.now() - started}`);
    return result;
  } catch (error) {
    const timeout = error instanceof JobTimeoutError;
    console.log(`[codex] ${timeout ? 'timeout' : 'fail'} type=${jobType} elapsedMs=${Date.now() - started} error=${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}
