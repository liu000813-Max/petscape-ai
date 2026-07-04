import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexSerialQueue } from '../app/lib/jobs/codexQueue.ts';
import { JobTimeoutError, withTimeout } from '../app/lib/jobs/timeouts.ts';

test('hung Codex-like job times out and releases queue slot for the next message', async () => {
  const queue = new CodexSerialQueue();
  const events = [];

  const hung = queue.enqueue('s1', async () => {
    events.push('hung:start');
    await withTimeout('cleanItem', 25, () => new Promise(() => undefined));
  });

  await assert.rejects(hung, JobTimeoutError);
  assert.equal(queue.position('s1'), undefined);

  const next = await queue.enqueue('s1', async () => {
    events.push('next:start');
    return 'recovered';
  });

  assert.equal(next, 'recovered');
  assert.deepEqual(events, ['hung:start', 'next:start']);
});
