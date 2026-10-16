// Windows-only, isolated PostgreSQL lifecycle. Never consumes an ambient DATABASE_URL.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { verifyLocalMigrations } from './verify-local-migrations.mjs';

const exec = promisify(execFile);
const repo = fileURLToPath(new URL('../', import.meta.url));
const server = path.join(repo, 'packages/server');
const requireServer = createRequire(path.join(server, 'package.json'));
const { Client } = requireServer('pg');
const runtime = path.resolve(process.env.PETSCAPE_PG_RUNTIME_DIR || 'G:/Max麦麦/codex/petscape-dev-runtime/postgres16');
let data = path.join(runtime, 'data');
let bin = path.join(runtime, 'pgsql/bin');
let pgRuntime = runtime;
let runtimeDrive;
const credentialsFile = path.join(runtime, 'local-credentials.json');
const host = '127.0.0.1';
const port = 55432;
const archiveName = 'postgresql-16.15-5-windows-x64-binaries.zip';
const archiveUrl = 'https://get.enterprisedb.com/postgresql/' + archiveName;
// Pinned after downloading the archive linked by EDB's official Windows x64 entry.
const archiveSha256 = '43bb45f173a6f08cf1d29a97a6d8deb119e8e8093a24c00d2d1001a0ccaa8281';
const action = process.argv[2];
let credentials;
let prismaLogDirectory;
let prismaCommandIndex = 0;
const exists = (target) => access(target).then(() => true, () => false);
const redact = (value) => credentials ? String(value).replaceAll(credentials.password, '[REDACTED]') : String(value);

async function command(executable, args, options = {}) {
  try {
    return await exec(executable, args, { windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120000, ...options });
  } catch (error) {
    throw new Error(redact(`${path.basename(executable)} failed (${error.code}): ${error.stdout ?? ''}\n${error.stderr ?? ''}`));
  }
}

async function startPostgres(args) {
  // On Windows the detached postgres process can retain execFile's pipe handles.
  // pg_ctl writes the server log to disk; ignore stdio and observe its own exit.
  await new Promise((resolve, reject) => {
    const child = spawn(path.join(bin, 'pg_ctl.exe'), args, { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); reject(new Error('pg_ctl startup timed out; inspect the local postgresql.log')); }, 35000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`pg_ctl startup failed (${code}); inspect the local postgresql.log`)); });
  });
}

async function secureRuntime() {
  await mkdir(runtime, { recursive: true });
  const { stdout } = await command('whoami.exe', []);
  await command('icacls.exe', [runtime, '/inheritance:r', '/grant:r', `${stdout.trim()}:(OI)(CI)F`]);
}

async function preparePgPaths() {
  if (/^[\x00-\x7f]+$/.test(runtime)) return;
  // EDB bootstrap interpolates its install path into SQL using the Windows code page.
  // SUBST provides an ASCII path to the same physical directory, with no data move/service.
  const record = path.join(runtime, 'windows-runtime-drive.json');
  if (await exists(record)) {
    const saved = JSON.parse(await readFile(record, 'utf8'));
    assert.equal(saved.runtime, runtime);
    assert.match(saved.drive, /^[D-Z]:$/);
    runtimeDrive = saved.drive;
    if (!await exists(runtimeDrive + '/')) await command('subst.exe', [runtimeDrive, runtime]);
  } else {
    for (const letter of 'PQRSTUVWXYZ') {
      const candidate = letter + ':';
      if (await exists(candidate + '/')) continue;
      try { await command('subst.exe', [candidate, runtime]); } catch { continue; }
      runtimeDrive = candidate;
      break;
    }
    assert.ok(runtimeDrive, 'No unused temporary drive letter is available');
    await writeFile(record, JSON.stringify({ runtime, drive: runtimeDrive }) + '\n', { flag: 'wx' });
  }
  const [actual, alias] = await Promise.all([stat(runtime), stat(runtimeDrive + '/')]);
  assert.equal(actual.dev, alias.dev, 'Temporary drive belongs to another volume');
  assert.equal(actual.ino, alias.ino, 'Temporary drive belongs to another directory');
  pgRuntime = runtimeDrive + '/';
  data = path.join(pgRuntime, 'data');
  bin = path.join(pgRuntime, 'pgsql/bin');
}

async function install() {
  await secureRuntime();
  if (await exists(path.join(bin, 'pg_ctl.exe'))) {
    const { stdout } = await command(path.join(bin, 'postgres.exe'), ['--version']);
    assert.match(stdout, /PostgreSQL\) 16\./);
    console.log(stdout.trim());
    return;
  }
  const archive = path.join(runtime, archiveName);
  if (!await exists(archive)) {
    console.log('Downloading the pinned PostgreSQL 16 Windows archive from EDB...');
    const response = await fetch(archiveUrl);
    assert.equal(response.ok, true, `EDB download returned ${response.status}`);
    const partial = archive + '.partial';
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: 'wx' }));
    const { rename } = await import('node:fs/promises');
    await rename(partial, archive);
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  assert.equal(hash.digest('hex'), archiveSha256, 'Archive SHA-256 mismatch; nothing extracted');
  // Expand only server runtime files, not pgAdmin/docs. No overwrites of existing files.
  const extractScript = `Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($env:PETSCAPE_PG_ARCHIVE)
try {
  foreach ($entry in $zip.Entries) {
    if ($entry.FullName -notmatch '^pgsql/(bin|lib|share)/' -or $entry.FullName.EndsWith('/')) { continue }
    $target = [IO.Path]::GetFullPath([IO.Path]::Combine($env:PETSCAPE_PG_EXTRACT, $entry.FullName))
    if (-not $target.StartsWith($env:PETSCAPE_PG_EXTRACT + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive entry escapes runtime' }
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
    if (-not [IO.File]::Exists($target)) { [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $false) }
  }
} finally { $zip.Dispose() }`;
  await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', extractScript], {
    env: { ...process.env, PETSCAPE_PG_ARCHIVE: archive, PETSCAPE_PG_EXTRACT: runtime }, timeout: 300000,
  });
  const { stdout } = await command(path.join(bin, 'postgres.exe'), ['--version']);
  assert.match(stdout, /PostgreSQL\) 16\./);
  console.log(stdout.trim());
}

async function loadCredentials() {
  credentials = JSON.parse(await readFile(credentialsFile, 'utf8'));
  assert.equal(credentials.version, 1);
  assert.equal(credentials.host, host);
  assert.equal(credentials.port, port);
  assert.equal(credentials.user, 'petscape_local');
  assert.equal(credentials.devDatabase, 'petscape_miniapp_dev');
  assert.match(credentials.password, /^[a-f0-9]{64}$/);
  return credentials;
}

function connection(database = 'postgres') {
  return { host, port, user: credentials.user, password: credentials.password, database };
}

function databaseUrl(database) {
  const url = new URL(`postgresql://${host}:${port}/${database}`);
  url.username = credentials.user;
  url.password = credentials.password;
  url.searchParams.set('sslmode', 'disable');
  return url.href;
}

async function withClient(database, callback) {
  const client = new Client(connection(database));
  await client.connect();
  try { return await callback(client); } finally { await client.end(); }
}

async function createDatabase(database) {
  assert.match(database, /^petscape_[a-z0-9_]+$/);
  await withClient('postgres', async (client) => {
    if (!(await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount) {
      await client.query(`CREATE DATABASE "${database}"`);
    }
  });
}

async function verifyServerSettings() {
  await withClient('postgres', async (client) => {
    assert.equal((await client.query('SHOW listen_addresses')).rows[0].listen_addresses, host);
    assert.equal((await client.query('SHOW port')).rows[0].port, String(port));
    assert.equal((await client.query('SHOW server_encoding')).rows[0].server_encoding, 'UTF8');
  });
}

async function status() {
  try {
    const { stdout } = await command(path.join(bin, 'pg_ctl.exe'), ['status', '-D', data]);
    console.log(stdout.trim());
    return true;
  } catch (error) {
    if (error.message.includes('failed (3)')) return false;
    throw error;
  }
}

async function portOccupied() {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

async function start() {
  await secureRuntime();
  await preparePgPaths();
  assert.ok(await exists(path.join(bin, 'pg_ctl.exe')), 'Run install first');
  if (!await exists(credentialsFile)) {
    assert.equal(await exists(path.join(data, 'PG_VERSION')), false, 'Existing database has no PETSCAPE credentials; refusing initialization');
    credentials = { version: 1, host, port, user: 'petscape_local', password: randomBytes(32).toString('hex'), devDatabase: 'petscape_miniapp_dev' };
    await writeFile(credentialsFile, JSON.stringify(credentials, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  } else await loadCredentials();
  if (await exists(path.join(data, 'PG_VERSION'))) {
    assert.equal((await readFile(path.join(data, 'PG_VERSION'), 'utf8')).trim(), '16');
    if (await status()) {
      await verifyServerSettings();
      await createDatabase(credentials.devDatabase);
      return;
    }
  }
  assert.equal(await portOccupied(), false, `Port ${port} is already used; refusing to replace another listener`);
  if (!await exists(path.join(data, 'PG_VERSION'))) {
    const passwordFile = path.join(pgRuntime, 'init-password.tmp');
    await writeFile(passwordFile, credentials.password, { flag: 'wx', mode: 0o600 });
    try {
      await command(path.join(bin, 'initdb.exe'), ['-D', data, '-U', credentials.user, '--pwfile', passwordFile, '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C']);
    } finally { await unlink(passwordFile); }
  }
  await startPostgres(['start', '-D', data, '-l', path.join(pgRuntime, 'postgresql.log'), '-w', '-t', '30', '-o', `-h ${host} -p ${port} -c max_connections=30 -c shared_buffers=64MB`]);
  await verifyServerSettings();
  await createDatabase(credentials.devDatabase);
  console.log(`PostgreSQL ready on ${host}:${port}; credentials remain outside Git.`);
}

async function runPrisma(database, args) {
  const result = await command(process.execPath, [requireServer.resolve('prisma/build/index.js'), ...args], {
    cwd: server, env: { ...process.env, DATABASE_URL: databaseUrl(database) },
  });
  if (prismaLogDirectory) await writeFile(path.join(prismaLogDirectory, `prisma-${++prismaCommandIndex}.log`), redact(result.stdout + result.stderr), { flag: 'wx' });
  console.log(redact(result.stdout.split(/\r?\n/).filter((line) => /Generated|migrations found|Applying migration|All migrations|No pending/.test(line)).join('\n')));
  return result;
}

async function testDatabase() {
  await start();
  const run = new Date().toISOString().replace(/[-:.TZ]/g, '') + '_' + randomBytes(3).toString('hex');
  const fresh = 'petscape_fresh_' + run;
  const upgrade = 'petscape_upgrade_' + run;
  await createDatabase(fresh);
  await createDatabase(upgrade);
  const runDirectory = path.join(runtime, 'runs', run);
  await mkdir(runDirectory, { recursive: true });
  prismaLogDirectory = runDirectory;
  await runPrisma(fresh, ['generate']);
  const migrationResult = await verifyLocalMigrations({ repo, runDirectory, fresh, upgrade, withClient, runPrisma });
  const tests = ['packages/server/tests/community-content.integration.test.mjs', 'packages/server/tests/pets.integration.test.mjs'];
  let result;
  try {
    result = await command(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', ...tests], {
      cwd: repo, env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl(fresh) },
    });
  } catch (error) {
    const failureLog = path.join(runDirectory, 'integration-failed.log');
    await writeFile(failureLog, redact(error.message), { flag: 'wx' });
    throw new Error(`Integration tests failed; full redacted output: ${failureLog}`);
  }
  console.log(redact(result.stdout));
  const summary = Object.fromEntries([...result.stdout.matchAll(/^# (tests|pass|fail|skipped) (\d+)$/gm)].map((match) => [match[1], Number(match[2])]));
  assert.ok(summary.tests > 0 && summary.pass === summary.tests && summary.fail === 0 && summary.skipped === 0, 'Integration run must pass with zero skips');
  await writeFile(path.join(runDirectory, 'integration.tap'), redact(result.stdout), { flag: 'wx' });
  await runPrisma(credentials.devDatabase, ['migrate', 'deploy']);
  const receipt = { at: new Date().toISOString(), node: process.version, postgres: (await command(path.join(bin, 'postgres.exe'), ['--version'])).stdout.trim(), host, port, fresh, upgrade, migration: migrationResult, integration: summary, devDatabase: credentials.devDatabase };
  await writeFile(path.join(runDirectory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(`PASS: ${summary.pass} integration tests, zero skips. Receipt: ${path.join(runDirectory, 'receipt.json')}`);
}

try {
  assert.equal(process.platform, 'win32', 'This runtime launcher targets Windows');
  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
  assert.ok(nodeMajor > 24 || (nodeMajor === 24 && nodeMinor >= 7), 'Use Node >=24.7');
  const canonicalRuntime = runtime.toLowerCase();
  const canonicalRepo = path.resolve(repo).toLowerCase();
  assert.equal(canonicalRuntime === canonicalRepo || canonicalRuntime.startsWith(canonicalRepo + path.sep), false, 'Runtime must stay outside the Git checkout');
  if (action === 'install') await install();
  else if (action === 'start') await start();
  else if (action === 'test') await testDatabase();
  else if (action === 'status') {
    await loadCredentials();
    console.log(await status() ? 'running' : 'stopped');
  } else if (action === 'stop') {
    await loadCredentials();
    await preparePgPaths();
    if (await status()) await command(path.join(bin, 'pg_ctl.exe'), ['stop', '-D', data, '-m', 'fast', '-w', '-t', '30']);
    if (runtimeDrive) await command('subst.exe', [runtimeDrive, '/d']);
    console.log('PostgreSQL stopped; all data retained.');
  } else throw new Error('Usage: node scripts/local-postgres.mjs install|start|test|status|stop');
} catch (error) {
  console.error(redact(error.message));
  process.exitCode = 1;
}
