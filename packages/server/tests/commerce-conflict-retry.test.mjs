// Quote 与 DeliveryAddress 的序列化冲突重试必须走 transaction-retry.ts 共享实现：
// driver-adapter 包装的 40P01（消息不含 40001/could not serialize/write conflict）
// 也要被识别并重试，穷尽后收敛为各自的领域冲突错误。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuote, QuoteConflictError } from '../src/application/quotes.ts';
import { saveDeliveryAddress, DeliveryAddressConflictError } from '../src/application/delivery-addresses.ts';

// 形如 Prisma driver-adapter 把 PostgreSQL 40P01 死锁包进 meta 的错误：
// code 与 message 都不命中旧版正则，只有结构化展开才能识别。
function wrappedDeadlockError() {
  return Object.assign(new Error('Transaction failed.'), {
    code: 'P2010',
    meta: { driverAdapterError: { cause: { originalCode: '40P01', originalMessage: 'deadlock detected' } } },
  });
}

const quoteInput = {
  requestId: 'request-1',
  estimateJobId: 'job-1',
  idempotencyKey: 'retry-unit-1',
  quoteMode: 'sandbox_test',
};

function quotePrismaFake(transaction) {
  return {
    quote: {
      updateMany: async () => ({ count: 0 }),
      findFirst: async () => null,
    },
    $transaction: transaction,
  };
}

const addressInput = {
  quoteId: 'quote-1',
  recipientName: '测试收件人',
  mobile: '13800000000',
  province: '上海市',
  city: '上海市',
  district: '浦东新区',
  detail: '测试路 1 号',
};

test('createQuote retries driver-adapter wrapped deadlocks and returns the successful attempt', async () => {
  let calls = 0;
  const settled = { quote: { id: 'quote-1' }, created: true };
  const prisma = quotePrismaFake(async () => {
    calls += 1;
    if (calls < 3) throw wrappedDeadlockError();
    return settled;
  });
  const result = await createQuote({ prisma, ownerUserId: 'user-1', input: quoteInput });
  assert.equal(result, settled);
  assert.equal(calls, 3);
});

test('createQuote converts exhausted serialization conflicts into QuoteConflictError', async () => {
  let calls = 0;
  const prisma = quotePrismaFake(async () => {
    calls += 1;
    throw wrappedDeadlockError();
  });
  await assert.rejects(
    () => createQuote({ prisma, ownerUserId: 'user-1', input: quoteInput }),
    QuoteConflictError,
  );
  assert.equal(calls, 5);
});

test('saveDeliveryAddress retries driver-adapter wrapped deadlocks and returns the successful attempt', async () => {
  let calls = 0;
  const settled = { deliveryAddress: { id: 'address-1' }, created: false };
  const prisma = {
    $transaction: async () => {
      calls += 1;
      if (calls < 3) throw wrappedDeadlockError();
      return settled;
    },
  };
  const result = await saveDeliveryAddress({ prisma, ownerUserId: 'user-1', input: addressInput });
  assert.equal(result, settled);
  assert.equal(calls, 3);
});

test('saveDeliveryAddress converts exhausted serialization conflicts into DeliveryAddressConflictError', async () => {
  let calls = 0;
  const prisma = {
    $transaction: async () => {
      calls += 1;
      throw wrappedDeadlockError();
    },
  };
  await assert.rejects(
    () => saveDeliveryAddress({ prisma, ownerUserId: 'user-1', input: addressInput }),
    DeliveryAddressConflictError,
  );
  assert.equal(calls, 5);
});
