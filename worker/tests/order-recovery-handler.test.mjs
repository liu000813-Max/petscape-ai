import test from 'node:test';
import assert from 'node:assert/strict';
import { isRetryableOrderRecoveryError } from '../src/handlers/orderRecovery.ts';

test('order recovery classifies structured database and network failures as retryable', () => {
  for (const error of [
    { code: 'P1001', message: 'cannot reach database' },
    { code: 'P2024', message: 'connection pool timeout' },
    { code: 'P2034', message: 'transaction write conflict' },
    { code: '40001', message: 'serialization failure' },
    { code: '40P01', message: 'deadlock detected' },
    { code: 'ECONNRESET', message: 'socket reset' },
    { code: 'ETIMEDOUT', message: 'socket timeout' },
  ]) {
    assert.equal(isRetryableOrderRecoveryError(error), true, error.code);
  }
});

test('order recovery does not infer retryability from an English message', () => {
  assert.equal(isRetryableOrderRecoveryError(new Error('temporary connection timeout')), false);
  assert.equal(isRetryableOrderRecoveryError({ code: 'P2003', message: 'foreign key conflict' }), false);
});
