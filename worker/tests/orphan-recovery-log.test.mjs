import test from 'node:test';
import assert from 'node:assert/strict';
import { orphanRecoveryLogEvent } from '../src/orphanRecoveryLog.ts';

test('an exhausted crashed job maps to the structured worker failure event', () => {
  assert.deepEqual(orphanRecoveryLogEvent({ jobId: 'job-1', action: 'failed_exhausted' }), {
    level: 'error',
    message: 'worker.job.failed',
    fields: {
      jobId: 'job-1', errorClass: 'retryable', outcome: 'failed', reason: 'lease_expired_max_attempts',
    },
  });
});

test('recoverable and vendor-check orphans keep the normal recovery event', () => {
  for (const action of ['requeued', 'needs_vendor_check']) {
    assert.deepEqual(orphanRecoveryLogEvent({ jobId: 'job-2', action }), {
      level: 'info', message: 'worker.job.orphan-recovered', fields: { jobId: 'job-2', action },
    });
  }
});
