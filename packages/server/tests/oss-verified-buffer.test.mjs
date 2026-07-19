import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { OssStorage } from '../src/infra/oss/index.ts';

function storageWithStream(chunks, capture) {
  const storage = new OssStorage({
    accessKeyId: 'test',
    accessKeySecret: 'test',
    bucket: 'test',
    endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
    region: 'cn-hangzhou',
  });
  storage.client = {
    async getStream(key, options) {
      capture.push({ key, options });
      return { stream: Readable.from(chunks), res: {} };
    },
  };
  return storage;
}

test('verified OSS read binds ETag and returns only the expected bounded bytes', async () => {
  const calls = [];
  const storage = storageWithStream([Buffer.from('abc'), Buffer.from('def')], calls);
  const result = await storage.getVerifiedBuffer({
    key: 'controlled/model.stl',
    etag: '"immutable-etag"',
    expectedBytes: 6,
    maxBytes: 6,
  });
  assert.equal(result.toString(), 'abcdef');
  assert.deepEqual(calls, [{
    key: 'controlled/model.stl',
    options: { headers: { 'If-Match': '"immutable-etag"' } },
  }]);
});

test('verified OSS read aborts when streamed content exceeds the limit or expected size', async () => {
  const overLimit = storageWithStream([Buffer.alloc(4), Buffer.alloc(4)], []);
  await assert.rejects(
    () => overLimit.getVerifiedBuffer({ key: 'x', etag: 'e', expectedBytes: 8, maxBytes: 6 }),
    /读取上限/,
  );

  const wrongLength = storageWithStream([Buffer.alloc(4)], []);
  await assert.rejects(
    () => wrongLength.getVerifiedBuffer({ key: 'x', etag: 'e', expectedBytes: 5, maxBytes: 6 }),
    /读取长度不一致/,
  );
});
