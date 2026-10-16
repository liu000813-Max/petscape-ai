import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export async function verifyMiniappHttp({ repo, runDirectory, databaseUrl, redact }) {
  const web = path.join(repo, 'web');
  // Next can load .env files after inheriting env. Refuse cloud keys there rather
  // than silently enabling integrations or editing the user's configuration.
  for (const directory of [repo, web]) for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    let contents;
    try { contents = await readFile(path.join(directory, name), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    assert.equal(/^\s*(?:export\s+)?(?:ALIBABA_CLOUD_|WECHAT_MINIPROGRAM_)[A-Z0-9_]*\s*=/m.test(contents), false,
      `Isolated HTTP acceptance requires no cloud/WeChat keys in ${path.join(directory, name)}; existing configuration was left untouched`);
  }
  const next = createRequire(path.join(web, 'package.json')).resolve('next/dist/bin/next');
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  const baseUrl = `http://127.0.0.1:${port}`;
  const secret = randomBytes(32).toString('hex');
  const env = { ...process.env, NODE_ENV: 'production', DATABASE_URL: databaseUrl, BETTER_AUTH_SECRET: secret,
    BETTER_AUTH_URL: baseUrl, SMS_CHANNEL: 'log', MAIL_CHANNEL: 'log', NEXT_TELEMETRY_DISABLED: '1',
    PETSCAPE_HTTP_TEST_URL: baseUrl };
  // Deliberately verify database-only routes with no cloud/WeChat credentials.
  for (const key of Object.keys(env)) if (/^(ALIBABA_CLOUD_|WECHAT_MINIPROGRAM_)/i.test(key)) delete env[key];
  const sanitize = (output) => redact(String(output)).replaceAll(secret, '[REDACTED]');
  async function run(args, log, cwd = web) {
    let result;
    try {
      result = await exec(process.execPath, args, { cwd, env, windowsHide: true, encoding: 'utf8', timeout: 600000, maxBuffer: 16 * 1024 * 1024 });
    } catch (error) {
      await writeFile(path.join(runDirectory, log), sanitize((error.stdout || '') + (error.stderr || '') + '\n' + error.message), { flag: 'wx' });
      throw new Error(`HTTP acceptance command failed; inspect ${path.join(runDirectory, log)}`);
    }
    await writeFile(path.join(runDirectory, log), sanitize(result.stdout + result.stderr), { flag: 'wx' });
    return result.stdout;
  }
  console.log('Building the current Web API for isolated HTTP acceptance...');
  await run([next, 'build'], 'http-build.log');
  let output = '';
  let startupError;
  const child = spawn(process.execPath, [next, 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: web, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.once('error', (error) => { startupError = error; });
  const append = (chunk) => { output = (output + chunk.toString()).slice(-8 * 1024 * 1024); };
  child.stdout.on('data', append); child.stderr.on('data', append);
  const closed = new Promise((resolve) => child.once('close', resolve));
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (startupError) throw startupError;
      assert.equal(child.exitCode, null, 'Next server exited before readiness');
      try {
        const response = await fetch(baseUrl + '/api/healthz', { signal: AbortSignal.timeout(2500) });
        const health = await response.json();
        if (response.ok && health.ok && health.db) { ready = true; break; }
      } catch { /* bounded readiness retry */ }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(ready, 'Web API did not become database-ready');
    const tap = await run(['--test', '--test-reporter=tap', '--test-concurrency=1', 'web/tests/e2e-miniapp-content.test.mjs'], 'http-tests.tap', repo);
    const summary = Object.fromEntries([...tap.matchAll(/^# (tests|pass|fail|skipped) (\d+)$/gm)].map((match) => [match[1], Number(match[2])]));
    assert.ok(summary.tests > 0 && summary.tests === summary.pass && summary.fail === 0 && summary.skipped === 0, 'HTTP tests must pass with zero skips');
    console.log(`PASS: ${summary.pass} real HTTP acceptance tests, zero skips.`);
    return { at: new Date().toISOString(), node: process.version, database: new URL(databaseUrl).pathname.slice(1), transport: 'HTTP on loopback; native request.js with wx HTTP/storage adapter', ossConfigured: false, wechatConfigured: false, fixtureSessions: true, realWechatLogin: false, integration: summary };
  } finally {
    // Only terminate the Next process started above; never kill another listener.
    if (child.exitCode === null && !startupError) child.kill();
    await closed;
    await writeFile(path.join(runDirectory, 'http-server.log'), sanitize(output), { flag: 'wx' });
  }
}
