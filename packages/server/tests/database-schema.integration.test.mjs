import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { createPrismaClient } from '../src/infra/db/index.ts';
import { databaseTarget } from '../src/infra/config/database-target.mjs';
import { readDatabaseHistory, readImageMigrations, assessMigrationHistory } from '../scripts/verify-deploy-migration-history.mjs';

const url = process.env.DATABASE_URL;
if (!url) {
  if (process.env.CI) throw new Error('CI requires PostgreSQL for schema isolation acceptance');
  test('schema isolation requires local PostgreSQL', (t) => t.skip('DATABASE_URL not configured'));
} else {
  if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname)) throw new Error('Schema isolation tests require loopback PostgreSQL');
  test('isolated migration, Prisma reads/writes and raw SQL never fall back to public', async () => {
    const schema = 'petscape_miniapp_test_' + randomUUID().replaceAll('-', '').slice(0, 16);
    const base = new Client({ connectionString: url });
    await base.connect();
    const before = await base.query('SELECT migration_name, checksum FROM public._prisma_migrations ORDER BY migration_name');
    const userId = randomUUID();
    const isolatedUrl = new URL(url); isolatedUrl.searchParams.set('schema', schema);
    let prisma;
    try {
      await base.query(`CREATE SCHEMA "${schema}"`);
      assert.deepEqual(await readDatabaseHistory(isolatedUrl.href), []);
      const require = createRequire(import.meta.url);
      const { stdout } = await promisify(execFile)(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        env: { ...process.env, DATABASE_URL: isolatedUrl.href }, windowsHide: true, timeout: 120000,
      });
      assert.match(stdout, /applied|No pending migrations/);
      const history = await readDatabaseHistory(isolatedUrl.href);
      assert.equal(history.length, (await readImageMigrations()).length);
      assert.deepEqual(assessMigrationHistory(history, await readImageMigrations()), []);
      prisma = createPrismaClient({ connectionString: isolatedUrl.href, poolMax: 2 });
      await prisma.user.create({ data: { id: userId, name: 'Isolated acceptance user' } });
      assert.equal(await prisma.user.count(), 1);
      assert.equal((await prisma.$queryRaw`SELECT current_schema() AS schema`)[0].schema, schema);
      assert.equal((await base.query('SELECT count(*)::int AS n FROM public."user" WHERE id=$1', [userId])).rows[0].n, 0);
      assert.deepEqual((await base.query('SELECT migration_name, checksum FROM public._prisma_migrations ORDER BY migration_name')).rows, before.rows);
      const driver = new Client({ connectionString: databaseTarget(isolatedUrl.href).connectionString });
      await driver.connect();
      try { assert.equal((await driver.query('SELECT count(*)::int AS n FROM "user"')).rows[0].n, 1); }
      finally { await driver.end(); }
    } finally {
      if (prisma) await prisma.$disconnect();
      await base.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await base.end();
    }
  });
}
