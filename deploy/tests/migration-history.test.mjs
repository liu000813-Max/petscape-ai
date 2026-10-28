import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assessMigrationHistory, readImageMigrations } from '../../packages/server/scripts/verify-deploy-migration-history.mjs';

const sql = 'CREATE TABLE "example" ("id" TEXT);\n';
const checksum = (text) => createHash('sha256').update(text).digest('hex');
const migration = (name, text = sql) => ({ name, checksums: [checksum(text)] });
const applied = (migrationName, overrides = {}) => ({
  migration_name: migrationName,
  checksum: checksum(sql),
  finished_at: new Date('2026-10-01T00:00:00Z'),
  rolled_back_at: null,
  ...overrides,
});

test('allows a fresh database and a target with additional pending migrations', () => {
  assert.deepEqual(assessMigrationHistory([], [migration('001')]), []);
  assert.deepEqual(assessMigrationHistory([applied('001')], [migration('001'), migration('002')]), []);
});

test('blocks an image missing any applied production migration', () => {
  assert.deepEqual(assessMigrationHistory([applied('001'), applied('002')], [migration('001')]), [
    { code: 'applied_migration_missing', migration: '002' },
  ]);
});

test('blocks changed migration SQL even when the migration name matches', () => {
  assert.deepEqual(assessMigrationHistory([applied('001')], [migration('001', 'SELECT 1;\n')]), [
    { code: 'applied_migration_modified', migration: '001' },
  ]);
});

test('blocks unresolved failures and ignores explicitly rolled back attempts', () => {
  assert.deepEqual(assessMigrationHistory([applied('001', { finished_at: null })], [migration('001')]), [
    { code: 'unresolved_migration', migration: '001' },
  ]);
  assert.deepEqual(assessMigrationHistory([applied('001', { finished_at: null, rolled_back_at: new Date() })], []), []);
});

test('accepts the Prisma-compatible line-ending checksum variants supplied by the image reader', () => {
  const windows = sql.replaceAll('\n', '\r\n');
  assert.deepEqual(assessMigrationHistory([applied('001', { checksum: checksum(windows) })], [
    { name: '001', checksums: [checksum(sql), checksum(windows)] },
  ]), []);
});

test('reads real migration files with both line-ending variants', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'petscape-history-files-'));
  await mkdir(path.join(directory, '001'));
  await writeFile(path.join(directory, '001', 'migration.sql'), sql.replaceAll('\n', '\r\n'));
  const files = await readImageMigrations(directory);
  assert.equal(files.length, 1);
  assert.deepEqual(assessMigrationHistory([applied('001')], files), []);
  assert.deepEqual(assessMigrationHistory([applied('001', { checksum: checksum(sql.replaceAll('\n', '\r\n')) })], files), []);
});

test('fails closed for an empty image migration directory', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'petscape-history-empty-'));
  await assert.rejects(readImageMigrations(directory), /image_migrations_missing/);
});
