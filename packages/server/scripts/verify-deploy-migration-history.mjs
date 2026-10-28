import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Read-only release gate. An older image must not silently deploy against a
// database whose applied migration history that image does not contain.
export function assessMigrationHistory(history, imageMigrations) {
  const available = new Map(imageMigrations.map((item) => [item.name, new Set(item.checksums)]));
  const issues = [];
  for (const item of history) {
    if (item.rolled_back_at) continue;
    const migration = item.migration_name;
    if (!item.finished_at) {
      issues.push({ code: 'unresolved_migration', migration });
    } else if (!available.has(migration)) {
      issues.push({ code: 'applied_migration_missing', migration });
    } else if (!available.get(migration).has(item.checksum)) {
      issues.push({ code: 'applied_migration_modified', migration });
    }
  }
  return issues;
}

export async function readImageMigrations(directory = fileURLToPath(new URL('../prisma/migrations/', import.meta.url))) {
  const entries = await readdir(directory, { withFileTypes: true });
  const migrations = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const text = await readFile(path.join(directory, entry.name, 'migration.sql'), 'utf8');
    const lf = text.replaceAll('\r\n', '\n');
    migrations.push({
      name: entry.name,
      checksums: [...new Set([text, lf, lf.replaceAll('\n', '\r\n')].map((sql) => createHash('sha256').update(sql).digest('hex')))],
    });
  }
  if (!migrations.length) throw new Error('image_migrations_missing');
  return migrations;
}

export async function readDatabaseHistory(connectionString) {
  if (!connectionString) throw new Error('database_url_missing');
  const { Client } = await import('pg');
  const client = new Client({ connectionString, connectionTimeoutMillis: 10000, statement_timeout: 15000 });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const { rows } = await client.query("SELECT to_regclass('_prisma_migrations') AS history");
    let history = [];
    if (rows[0].history) {
      history = (await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at, id')).rows;
    } else {
      const tables = await client.query('SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = current_schema() LIMIT 1');
      if (tables.rowCount) throw new Error('history_missing_in_nonempty_schema');
    }
    await client.query('COMMIT');
    return history;
  } finally {
    await client.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--history-file')) throw new Error('invalid_arguments');
  const history = args.length ? JSON.parse(await readFile(args[1], 'utf8')) : await readDatabaseHistory(process.env.DATABASE_URL);
  if (!Array.isArray(history) || history.some((row) => !row || typeof row.migration_name !== 'string' || typeof row.checksum !== 'string')) {
    throw new Error('invalid_migration_history');
  }
  const migrations = await readImageMigrations();
  const issues = assessMigrationHistory(history, migrations);
  console.log(JSON.stringify({ check: 'deploy_migration_history', ok: !issues.length, databaseMigrations: history.filter((row) => row.finished_at && !row.rolled_back_at).length, imageMigrations: migrations.length, issues }));
  if (issues.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = String(error?.message || '');
    const code = /^(database_url_missing|image_migrations_missing|history_missing_in_nonempty_schema|invalid_arguments|invalid_migration_history)$/.test(message) ? message : 'migration_history_check_failed';
    console.error(JSON.stringify({ check: 'deploy_migration_history', ok: false, error: code }));
    process.exitCode = 1;
  });
}
