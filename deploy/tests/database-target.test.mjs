import assert from 'node:assert/strict';
import test from 'node:test';
import { databaseTarget } from '../../packages/server/src/infra/config/database-target.mjs';

test('preserves the existing default public schema', () => {
  assert.equal(databaseTarget('postgresql://user:secret@localhost/db').schema, 'public');
});

test('applies the explicit schema to the driver search path without a public fallback', () => {
  const target = databaseTarget('postgresql://user:secret@localhost/db?schema=petscape_miniapp');
  assert.equal(target.schema, 'petscape_miniapp');
  assert.equal(new URL(target.connectionString).searchParams.get('options'), '-c search_path=petscape_miniapp');
  assert.equal(new URL(target.connectionString).password, 'secret');
});

test('rejects schema injection and malformed URLs without echoing credentials', () => {
  for (const url of ['postgresql://u:secret@localhost/db?schema=public%2Cother', 'secret']) {
    assert.throws(() => databaseTarget(url), (error) => /invalid_database_target/.test(error.message) && !error.message.includes('secret'));
  }
});
