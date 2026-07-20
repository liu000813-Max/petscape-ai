import type { RecoverOrphanResult } from '@petscape/server/worker-api';

export function orphanRecoveryLogEvent(result: RecoverOrphanResult) {
  if (result.action === 'failed_exhausted') {
    return {
      level: 'error' as const,
      message: 'worker.job.failed',
      fields: {
        jobId: result.jobId,
        errorClass: 'retryable',
        outcome: 'failed',
        reason: 'lease_expired_max_attempts',
      },
    };
  }
  return {
    level: 'info' as const,
    message: 'worker.job.orphan-recovered',
    fields: { jobId: result.jobId, action: result.action },
  };
}
