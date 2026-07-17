import test from 'node:test';
import assert from 'node:assert/strict';
import { JobTimeoutError, withTimeout } from '../app/lib/jobs/timeouts.ts';

test('hung job times out and aborts downstream work', async () => {
  let capturedSignal;

  const hung = withTimeout('cleanItem', 25, (signal) => {
    capturedSignal = signal;
    return new Promise(() => undefined);
  });

  await assert.rejects(hung, (error) => {
    assert.ok(error instanceof JobTimeoutError);
    assert.equal(error.jobType, 'cleanItem');
    assert.equal(error.timeoutMs, 25);
    return true;
  });
  assert.equal(capturedSignal?.aborted, true);
});

test('completed job returns its value and closes its abort scope', async () => {
  let capturedSignal;
  const result = await withTimeout('renderImage', 1_000, async (signal) => {
    capturedSignal = signal;
    return 'completed';
  });

  assert.equal(result, 'completed');
  assert.equal(capturedSignal?.aborted, true);
});
