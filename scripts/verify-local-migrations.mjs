import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const contentMigration = '20261016000000_p1_content_community_care';
const tables = ['content_article', 'community_post', 'community_comment', 'community_post_like', 'care_log', 'care_reminder', 'service_provider', 'analytics_event'];

export async function verifyLocalMigrations({ repo, runDirectory, fresh, upgrade, withClient, runPrisma }) {
  const source = path.join(repo, 'packages/server/prisma');
  const migrations = (await readdir(path.join(source, 'migrations'), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.equal(migrations.at(-1), contentMigration, 'Review the upgrade baseline when adding another migration');
  const checkHistory = async (database, expected) => withClient(database, async (client) => {
    const result = await client.query('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name');
    assert.deepEqual(result.rows.map((row) => row.migration_name), expected);
    assert.equal((await client.query('SELECT 1 FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL')).rowCount, 0);
  });
  console.log('Checking all migrations on an empty PostgreSQL database...');
  await runPrisma(fresh, ['migrate', 'deploy']);
  await checkHistory(fresh, migrations);
  const historyBefore = await withClient(fresh, (client) => client.query('SELECT * FROM _prisma_migrations ORDER BY migration_name'));
  await runPrisma(fresh, ['migrate', 'deploy']);
  const historyAfter = await withClient(fresh, (client) => client.query('SELECT * FROM _prisma_migrations ORDER BY migration_name'));
  assert.deepEqual(historyAfter.rows, historyBefore.rows, 'Repeated deploy must be a no-op');

  await withClient(fresh, async (client) => {
    const installed = await client.query('SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename=ANY($2) ORDER BY tablename', ['public', tables]);
    assert.deepEqual(installed.rows.map((row) => row.tablename), [...tables].sort());
    const checks = await client.query("SELECT conname FROM pg_constraint WHERE contype='c' AND conrelid IN (SELECT oid FROM pg_class WHERE relname=ANY($1)) ORDER BY conname", [tables]);
    assert.deepEqual(checks.rows.map((row) => row.conname), ['community_comment_status_valid', 'community_post_status_valid', 'content_article_status_valid', 'service_provider_status_valid']);
    const foreignKeys = await client.query("SELECT conname FROM pg_constraint WHERE contype='f' AND conrelid IN (SELECT oid FROM pg_class WHERE relname=ANY($1))", [tables]);
    assert.equal(foreignKeys.rowCount, 11);
    const now = new Date();
    await client.query('BEGIN');
    try {
      await client.query('INSERT INTO "user" (id,name,"updatedAt") VALUES ($1,$2,$3)', ['migration-check', '约束测试', now]);
      await client.query('INSERT INTO community_post (id,"ownerUserId",title,body,topic,status,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7)', ['migration-post', 'migration-check', '测试', '正文', '约束', 'published', now]);
      await client.query('INSERT INTO community_post_like (id,"postId","ownerUserId") VALUES ($1,$2,$3)', ['migration-like', 'migration-post', 'migration-check']);
      const rejectSql = async (sql, values, code) => {
        await client.query('SAVEPOINT rejection');
        await assert.rejects(() => client.query(sql, values), (error) => error.code === code);
        await client.query('ROLLBACK TO SAVEPOINT rejection');
      };
      await rejectSql('INSERT INTO community_post_like (id,"postId","ownerUserId") VALUES ($1,$2,$3)', ['migration-like-duplicate', 'migration-post', 'migration-check'], '23505');
      await rejectSql('INSERT INTO community_post_like (id,"postId","ownerUserId") VALUES ($1,$2,$3)', ['migration-like-foreign', 'missing-post', 'migration-check'], '23503');
      await rejectSql('UPDATE community_post SET status=$1 WHERE id=$2', ['draft', 'migration-post'], '23514');
      await rejectSql('INSERT INTO content_article (id,slug,title,summary,body,category,status,"updatedAt") VALUES ($1,$1,$1,$1,$1,$1,$2,$3)', ['migration-article', 'pending', now], '23514');
      await rejectSql('INSERT INTO community_comment (id,"postId","ownerUserId",body,status,"updatedAt") VALUES ($1,$2,$3,$1,$4,$5)', ['migration-comment', 'migration-post', 'migration-check', 'draft', now], '23514');
      await rejectSql('INSERT INTO service_provider (id,name,"serviceType",city,description,status,"updatedAt") VALUES ($1,$1,$1,$1,$1,$2,$3)', ['migration-provider', 'draft', now], '23514');
    } finally { await client.query('ROLLBACK'); }
  });

  console.log('Checking upgrade from the pre-P1 migration history with existing user/account/session/pet data...');
  const baseline = path.join(runDirectory, 'baseline');
  await mkdir(path.join(baseline, 'migrations'), { recursive: true });
  await cp(path.join(source, 'schema.prisma'), path.join(baseline, 'schema.prisma'));
  await cp(path.join(source, 'migrations/migration_lock.toml'), path.join(baseline, 'migrations/migration_lock.toml'));
  for (const migration of migrations.slice(0, -1)) await cp(path.join(source, 'migrations', migration), path.join(baseline, 'migrations', migration), { recursive: true });
  await runPrisma(upgrade, ['migrate', 'deploy', '--schema', path.join(baseline, 'schema.prisma')]);
  await checkHistory(upgrade, migrations.slice(0, -1));
  const snapshot = async (client) => {
    const result = {};
    for (const table of ['user', 'account', 'session', 'pet']) result[table] = (await client.query(`SELECT * FROM "${table}" ORDER BY id`)).rows;
    return result;
  };
  const before = await withClient(upgrade, async (client) => {
    const now = new Date();
    await client.query('INSERT INTO "user" (id,name,"updatedAt") VALUES ($1,$2,$3)', ['upgrade-owner', '旧账号保留', now]);
    await client.query('INSERT INTO account (id,"accountId","providerId","userId","updatedAt") VALUES ($1,$2,$3,$4,$5)', ['upgrade-account', 'upgrade-openid', 'wechat-miniprogram', 'upgrade-owner', now]);
    await client.query('INSERT INTO session (id,token,"expiresAt","userId","updatedAt") VALUES ($1,$2,$3,$4,$5)', ['upgrade-session', 'local-upgrade-fixture-not-a-real-token', new Date(Date.now() + 86400000), 'upgrade-owner', now]);
    await client.query('INSERT INTO pet (id,"ownerUserId",name,"speciesCode","behaviorTraits","updatedAt") VALUES ($1,$2,$3,$4,$5,$6)', ['upgrade-pet', 'upgrade-owner', '旧宠物花枝鼠', 'rat', ['亲人'], now]);
    assert.equal((await client.query("SELECT to_regclass('public.content_article') AS name")).rows[0].name, null);
    return snapshot(client);
  });
  await runPrisma(upgrade, ['migrate', 'deploy']);
  await checkHistory(upgrade, migrations);
  await withClient(upgrade, async (client) => assert.deepEqual(await snapshot(client), before, 'Upgrade must preserve existing rows exactly'));
  // Pin a hash of the actual migration file in the receipt without copying SQL into docs.
  const { createHash } = await import('node:crypto');
  const migrationSha256 = createHash('sha256').update(await readFile(path.join(source, 'migrations', contentMigration, 'migration.sql'))).digest('hex');
  return { migrations: migrations.length, newTables: tables.length, foreignKeys: 11, statusChecks: 4, sqlRejections: 6, repeatedDeploy: 'unchanged', oldDataUpgrade: 'preserved', migrationSha256 };
}
