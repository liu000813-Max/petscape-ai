import test from 'node:test';
import assert from 'node:assert/strict';
import { getServerContext } from '../src/application/context.ts';
import { loadWebConfig } from '../src/infra/config/index.ts';

test('database-only context works without OSS; file operations still require real OSS configuration', async () => {
  const base = loadWebConfig({ NODE_ENV: 'test', BETTER_AUTH_SECRET: 'context-test-only-secret-not-for-production' });
  assert.throws(() => getServerContext(base), /DATABASE_URL/);
  // No network request is issued: only construct and disconnect the connection pool.
  const context = getServerContext({ ...base, DATABASE_URL: 'postgresql://context_test@127.0.0.1:1/context_test' });
  assert.ok(context.prisma);
  assert.equal(getServerContext(base), context);
  assert.throws(() => context.oss, /OSS.*ALIBABA_CLOUD_ACCESS_KEY_ID/);
  assert.throws(() => context.oss, /ALIBABA_CLOUD_OSS_BUCKET/);
  await context.prisma.$disconnect();
});
