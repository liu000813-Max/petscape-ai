import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const latestMigration = '20261126101356_community_post_photos';
const tables = ['content_article', 'community_post', 'community_post_photo', 'community_comment', 'community_post_like', 'care_log', 'care_reminder', 'service_provider', 'analytics_event', 'pet_growth_entry', 'pet_growth_entry_photo'];

export async function verifyLocalMigrations({ repo, runDirectory, fresh, upgrade, withClient, runPrisma }) {
  const source = path.join(repo, 'packages/server/prisma');
  const migrations = (await readdir(path.join(source, 'migrations'), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.equal(migrations.at(-1), latestMigration, 'Review the upgrade baseline when adding another migration');
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
    assert.equal((await client.query("SELECT to_regclass('public.miniapp_profile') IS NOT NULL AS present")).rows[0].present, true);
    assert.equal((await client.query("SELECT 1 FROM pg_constraint WHERE conrelid='miniapp_profile'::regclass AND contype='f'")).rowCount, 2);
    assert.equal((await client.query("SELECT 1 FROM pg_constraint WHERE conrelid='pet_growth_entry'::regclass AND contype='f'")).rowCount, 2);
    assert.equal((await client.query("SELECT 1 FROM pg_constraint WHERE conrelid='pet_growth_entry_photo'::regclass AND contype='f'")).rowCount, 2);
    const installed = await client.query('SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename=ANY($2) ORDER BY tablename', ['public', tables]);
    assert.deepEqual(installed.rows.map((row) => row.tablename), [...tables].sort());
    const checks = await client.query("SELECT conname FROM pg_constraint WHERE contype='c' AND conrelid IN (SELECT oid FROM pg_class WHERE relname=ANY($1)) ORDER BY conname", [tables]);
    assert.deepEqual(checks.rows.map((row) => row.conname), ['community_comment_status_valid', 'community_post_status_valid', 'content_article_status_valid', 'service_provider_status_valid']);
    const foreignKeys = await client.query("SELECT conname FROM pg_constraint WHERE contype='f' AND conrelid IN (SELECT oid FROM pg_class WHERE relname=ANY($1))", [tables]);
    assert.equal(foreignKeys.rowCount, 17);
    const lifeStages = await client.query('SELECT enumlabel FROM pg_enum WHERE enumtypid=\'"PetLifeStage"\'::regtype ORDER BY enumsortorder');
    assert.deepEqual(lifeStages.rows.map((row) => row.enumlabel).sort(), ['adult', 'juvenile', 'senior', 'subadult', 'unknown']);
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
      await client.query('INSERT INTO miniapp_profile ("userId",nickname,"updatedAt") VALUES ($1,$2,$3)', ['migration-check', '主人资料', now]);
      await client.query('INSERT INTO pet (id,"ownerUserId",name,"behaviorTraits","updatedAt") VALUES ($1,$2,$3,$4,$5)', ['migration-pet', 'migration-check', '成长记录宠物', [], now]);
      await client.query('INSERT INTO pet_growth_entry (id,"ownerUserId","petId",note,"recordedAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6)', ['migration-growth-entry', 'migration-check', 'migration-pet', null, now, now]);
      await client.query('INSERT INTO asset (id,"ownerUserId",kind,mime,size,"ossKey",status,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', ['migration-photo-asset', 'migration-check', 'growth_photo', 'image/png', 16, 'uploads/raw/migration-check/growth', 'available', now]);
      await client.query('INSERT INTO asset (id,"ownerUserId",kind,mime,size,"ossKey",status,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', ['migration-photo-asset-second', 'migration-check', 'growth_photo', 'image/png', 16, 'uploads/raw/migration-check/growth-second', 'available', now]);
      await client.query('INSERT INTO pet_growth_entry_photo (id,"entryId","assetId",position) VALUES ($1,$2,$3,$4)', ['migration-photo', 'migration-growth-entry', 'migration-photo-asset', 0]);
      const linkPostPhoto = 'INSERT INTO community_post_photo ("postId","assetId",position) VALUES ($1,$2,$3)';
      await client.query(linkPostPhoto, ['migration-post', 'migration-photo-asset', 0]);
      await rejectSql(linkPostPhoto, ['migration-post', 'migration-photo-asset-second', 0], '23505');
      await rejectSql(linkPostPhoto, ['migration-post', 'migration-photo-asset', 1], '23505');
      await rejectSql(linkPostPhoto, ['migration-post', 'missing-asset', 1], '23503');
      await rejectSql('INSERT INTO miniapp_profile ("userId",nickname,"updatedAt") VALUES ($1,$2,$3)', ['migration-check', '重复', now], '23505');
      await rejectSql('INSERT INTO miniapp_profile ("userId",nickname,"updatedAt") VALUES ($1,$2,$3)', ['missing-user', '跨账号', now], '23503');
      await rejectSql('UPDATE miniapp_profile SET "avatarAssetId"=$1 WHERE "userId"=$2', ['missing-asset', 'migration-check'], '23503');
      await rejectSql('INSERT INTO pet_growth_entry (id,"ownerUserId","petId","recordedAt","updatedAt") VALUES ($1,$2,$3,$4,$4)', ['growth-missing-pet', 'migration-check', 'missing-pet', now], '23503');
      await rejectSql('INSERT INTO pet_growth_entry_photo (id,"entryId","assetId",position) VALUES ($1,$2,$3,$4)', ['growth-missing-asset', 'migration-growth-entry', 'missing-growth-asset', 1], '23503');
      await rejectSql('INSERT INTO pet_growth_entry_photo (id,"entryId","assetId",position) VALUES ($1,$2,$3,$4)', ['growth-duplicate-asset', 'migration-growth-entry', 'migration-photo-asset', 1], '23505');
      await rejectSql('INSERT INTO pet_growth_entry_photo (id,"entryId","assetId",position) VALUES ($1,$2,$3,$4)', ['growth-duplicate-position', 'migration-growth-entry', 'migration-photo-asset-second', 0], '23505');
      await rejectSql('INSERT INTO community_post_like (id,"postId","ownerUserId") VALUES ($1,$2,$3)', ['migration-like-duplicate', 'migration-post', 'migration-check'], '23505');
      await rejectSql('INSERT INTO community_post_like (id,"postId","ownerUserId") VALUES ($1,$2,$3)', ['migration-like-foreign', 'missing-post', 'migration-check'], '23503');
      await rejectSql('UPDATE community_post SET status=$1 WHERE id=$2', ['draft', 'migration-post'], '23514');
      await rejectSql('INSERT INTO content_article (id,slug,title,summary,body,category,status,"updatedAt") VALUES ($1,$1,$1,$1,$1,$1,$2,$3)', ['migration-article', 'pending', now], '23514');
      await rejectSql('INSERT INTO community_comment (id,"postId","ownerUserId",body,status,"updatedAt") VALUES ($1,$2,$3,$1,$4,$5)', ['migration-comment', 'migration-post', 'migration-check', 'draft', now], '23514');
      await rejectSql('INSERT INTO service_provider (id,name,"serviceType",city,description,status,"updatedAt") VALUES ($1,$1,$1,$1,$1,$2,$3)', ['migration-provider', 'draft', now], '23514');
    } finally { await client.query('ROLLBACK'); }
  });

  console.log('Checking upgrade from the pre-subadult history with existing user/account/session/pet data...');
  const baseline = path.join(runDirectory, 'baseline');
  await mkdir(path.join(baseline, 'migrations'), { recursive: true });
  await cp(path.join(source, 'schema.prisma'), path.join(baseline, 'schema.prisma'));
  await cp(path.join(source, 'migrations/migration_lock.toml'), path.join(baseline, 'migrations/migration_lock.toml'));
  const baselineMigrations = migrations.slice(0, migrations.indexOf('20261116000000_pet_life_stage_subadult'));
  for (const migration of baselineMigrations) await cp(path.join(source, 'migrations', migration), path.join(baseline, 'migrations', migration), { recursive: true });
  await runPrisma(upgrade, ['migrate', 'deploy', '--schema', path.join(baseline, 'schema.prisma')]);
  await checkHistory(upgrade, baselineMigrations);
  const snapshot = async (client) => {
    const result = {};
    for (const table of ['user', 'account', 'session', 'pet', 'community_post']) result[table] = (await client.query(`SELECT * FROM "${table}" ORDER BY id`)).rows;
    return result;
  };
  const before = await withClient(upgrade, async (client) => {
    const now = new Date();
    await client.query('INSERT INTO "user" (id,name,"updatedAt") VALUES ($1,$2,$3)', ['upgrade-owner', '旧账号保留', now]);
    await client.query('INSERT INTO account (id,"accountId","providerId","userId","updatedAt") VALUES ($1,$2,$3,$4,$5)', ['upgrade-account', 'upgrade-openid', 'wechat-miniprogram', 'upgrade-owner', now]);
    await client.query('INSERT INTO session (id,token,"expiresAt","userId","updatedAt") VALUES ($1,$2,$3,$4,$5)', ['upgrade-session', 'local-upgrade-fixture-not-a-real-token', new Date(Date.now() + 86400000), 'upgrade-owner', now]);
    await client.query('INSERT INTO pet (id,"ownerUserId",name,"speciesCode","behaviorTraits","lifeStage","sizeLevel","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', ['upgrade-pet', 'upgrade-owner', '旧宠物花枝鼠', 'rat', ['亲人'], 'adult', 4, now]);
    await client.query('INSERT INTO community_post (id,"ownerUserId",title,body,topic,status,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7)', ['upgrade-post', 'upgrade-owner', '旧动态', '保留正文', '求助', 'published', now]);
    assert.equal((await client.query("SELECT to_regclass('public.content_article') IS NOT NULL AS present")).rows[0].present, true);
    const beforeStages = await client.query('SELECT enumlabel FROM pg_enum WHERE enumtypid=\'"PetLifeStage"\'::regtype');
    assert.equal(beforeStages.rows.some((row) => row.enumlabel === 'subadult'), false);
    return snapshot(client);
  });
  await runPrisma(upgrade, ['migrate', 'deploy']);
  await checkHistory(upgrade, migrations);
  await withClient(upgrade, async (client) => {
    assert.deepEqual(await snapshot(client), before, 'Upgrade must preserve existing rows exactly');
    await client.query('UPDATE pet SET "lifeStage"=$1 WHERE id=$2', ['subadult', 'upgrade-pet']);
    assert.equal((await client.query('SELECT "lifeStage","sizeLevel" FROM pet WHERE id=$1', ['upgrade-pet'])).rows[0].lifeStage, 'subadult');
  });
  // Pin a hash of the actual migration file in the receipt without copying SQL into docs.
  const { createHash } = await import('node:crypto');
  const migrationSha256 = createHash('sha256').update(await readFile(path.join(source, 'migrations', latestMigration, 'migration.sql'))).digest('hex');
  return { migrations: migrations.length, checkedTables: tables.length + 1, foreignKeys: 19, statusChecks: 4, sqlRejections: 16, repeatedDeploy: 'unchanged', oldDataUpgrade: 'preserved', migrationSha256 };
}
