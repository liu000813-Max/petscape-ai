import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';

const databaseUrl = process.env.DATABASE_URL;
const sandboxSecret = process.env.SANDBOX_PAYMENT_SECRET;

if (!databaseUrl) throw new Error('validate:payment-recovery 需要 DATABASE_URL，集成测试不得静默 skip');
if (!sandboxSecret || sandboxSecret.length < 32) {
  throw new Error('validate:payment-recovery 需要至少 32 字符的 SANDBOX_PAYMENT_SECRET');
}

const parsedDatabaseUrl = new URL(databaseUrl);
if (!['127.0.0.1', 'localhost', '::1'].includes(parsedDatabaseUrl.hostname)) {
  throw new Error('validate:payment-recovery 只允许本机一次性 PostgreSQL，禁止连接生产数据库');
}
const databaseName = decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\//, ''));
if (!/(^|_)(ci|test)(_|$)/i.test(databaseName)) {
  throw new Error('validate:payment-recovery 要求数据库名明确包含 ci 或 test');
}

const { chromium } = await import('../web/node_modules/playwright/index.mjs');
try {
  await access(chromium.executablePath(), constants.X_OK);
} catch {
  throw new Error('validate:payment-recovery 缺少 Playwright Chromium；浏览器测试不得静默 skip');
}

const env = { ...process.env, NODE_ENV: 'test' };

async function run(label, args, cwd = process.cwd()) {
  process.stdout.write(`\n[validate:payment-recovery] ${label}\n`);
  await new Promise((resolve, reject) => {
    const child = spawn('pnpm', args, { cwd, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} 失败（code=${code ?? 'null'}, signal=${signal ?? 'none'}）`));
    });
  });
}

await run('生成 Prisma client', ['--filter', '@petscape/server', 'db:generate']);
await run('应用全部 migration', ['--filter', '@petscape/server', 'db:migrate:deploy']);
await run('配置一次性 sandbox provider trust', ['--filter', '@petscape/server', 'db:configure:sandbox-payment-test']);
await run('server lint', ['--filter', '@petscape/server', 'lint']);
await run('server typecheck', ['--filter', '@petscape/server', 'typecheck']);
await run('worker lint', ['--filter', '@petscape/worker', 'lint']);
await run('worker typecheck', ['--filter', '@petscape/worker', 'typecheck']);
await run('web typecheck', ['--dir', 'web', 'exec', 'tsc', '--noEmit']);
await run('web lint baseline', ['--filter', 'web', 'lint:baseline']);
await run('payment UI targeted lint', [
  '--dir', 'web', 'exec', 'eslint',
  'app/(app)/payments/PaymentsClient.tsx',
  'app/(app)/sandbox-pay/[id]/SandboxPayClient.tsx',
  'app/(app)/admin/payments/AdminPaymentAttentionClient.tsx',
  'app/api/v1/admin/payment-attention/route.ts',
  'app/api/v1/commerce/payment-intents/route.ts',
  'app/api/v1/commerce/payment-intents/[id]/route.ts',
  'app/api/v1/commerce/payment-intents/[id]/retry/route.ts',
  'app/api/v1/commerce/payment-intents/[id]/reconcile/route.ts',
]);
await run('payment contract', [
  '--dir', 'packages/server', 'exec', 'node', '--test', 'tests/payments-contract.test.mjs',
]);
await run('durable order recovery worker failure', [
  '--dir', 'worker', 'exec', 'node', '--test', '--test-concurrency=1', 'tests/order-recovery-worker.test.mjs',
]);
await run('payment and order integration', [
  '--dir', 'packages/server', 'exec', 'node', '--test', '--test-concurrency=1',
  'tests/payments.integration.test.mjs', 'tests/orders.integration.test.mjs',
]);
await run('payment browser E2E', [
  '--dir', 'web', 'exec', 'node', '--test', '--test-concurrency=1', 'tests/e2e-payments.test.mjs',
]);
await run('production web build', ['--filter', 'web', 'build']);

process.stdout.write('\n[validate:payment-recovery] PASS\n');
