import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createPrismaClient } from '../../packages/server/src/infra/db/index.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('order recovery worker test 需要 PostgreSQL，不能静默 skip');

const workerRoot = fileURLToPath(new URL('../', import.meta.url));
const prisma = createPrismaClient({ connectionString: databaseUrl, poolMax: 4 });
let child;
let output = '';

async function stopWorker() {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(3000).then(() => child.kill('SIGKILL')),
  ]);
}

test.after(async () => {
  await stopWorker();
  await prisma.$disconnect();
});

test('order recovery failure becomes a durable needs_attention job and a structured worker log', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const job = await prisma.job.create({ data: {
    type: 'order_recovery',
    ownerUserId: `missing-owner-${suffix}`,
    idempotencyKey: `missing-payment-${suffix}`,
    input: { schemaVersion: 'order-recovery.v0', paymentIntentId: `missing-payment-${suffix}` },
    maxAttempts: 5,
  } });

  child = spawn('node', ['--experimental-strip-types', 'src/main.ts'], {
    cwd: workerRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      ALIBABA_CLOUD_ACCESS_KEY_ID: 'worker-test-key',
      ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'worker-test-secret',
      ALIBABA_CLOUD_OSS_BUCKET: 'worker-test-bucket',
      ALIBABA_CLOUD_OSS_ENDPOINT: 'oss-cn-hangzhou.aliyuncs.com',
      ALIBABA_CLOUD_REGION: 'cn-hangzhou',
      WORKER_JOB_TYPES: 'order_recovery',
      WORKER_POLL_INTERVAL_MS: '25',
      WORKER_LEASE_SECONDS: '5',
      WORKER_RECOVER_ORPHANS_INTERVAL_MS: '60000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });

  let stored;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    stored = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    if (stored.status === 'needs_attention') break;
    if (child.exitCode !== null) throw new Error(`worker exited early (${child.exitCode})\n${output}`);
    await sleep(25);
  }
  assert.equal(stored.status, 'needs_attention');
  assert.equal(stored.errorClass, 'manual');
  assert.match(stored.errorDetail.message, /订单补单需要检查/);

  let log;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    log = output.split('\n').filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).find((line) => line?.msg === 'worker.job.failed' && line.jobId === job.id);
    if (log) break;
    await sleep(10);
  }
  assert.ok(log, output);
  assert.equal(log.level, 'error');
  assert.equal(log.errorClass, 'manual');
  assert.equal(log.outcome, 'needs_attention');
});
