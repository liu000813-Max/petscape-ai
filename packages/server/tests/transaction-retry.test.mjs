import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSerializableTransactionConflict,
  withSerializableTransactionRetry,
} from '../src/application/transaction-retry.ts';

test('recognizes Prisma and driver-adapter serializable conflict shapes', () => {
  assert.equal(isSerializableTransactionConflict(Object.assign(new Error('write conflict'), { code: 'P2034' })), true);
  assert.equal(isSerializableTransactionConflict(Object.assign(new Error('adapter failure'), {
    name: 'DriverAdapterError',
    cause: { kind: 'TransactionWriteConflict', originalCode: '40001', originalMessage: 'could not serialize access' },
  })), true);
  assert.equal(isSerializableTransactionConflict({
    code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '40001' } } },
  }), true);
  assert.equal(isSerializableTransactionConflict({ cause: { originalCode: '40P01' } }), true);
  assert.equal(isSerializableTransactionConflict(new Error('ordinary validation failure')), false);
  assert.equal(isSerializableTransactionConflict(new Error('provider write conflict')), false);
  assert.equal(isSerializableTransactionConflict({
    cause: new Error('could not serialize provider request after deadlock'),
  }), false);
});

test('retries only serializable conflicts and returns the successful attempt', async () => {
  let calls = 0;
  const value = await withSerializableTransactionRetry(async () => {
    calls += 1;
    if (calls < 3) throw Object.assign(new Error('Transaction failed due to a write conflict'), { code: 'P2034' });
    return 'ok';
  });
  assert.equal(value, 'ok');
  assert.equal(calls, 3);

  let ordinaryCalls = 0;
  await assert.rejects(() => withSerializableTransactionRetry(async () => {
    ordinaryCalls += 1;
    throw new Error('ordinary failure');
  }), /ordinary failure/);
  assert.equal(ordinaryCalls, 1);
});
