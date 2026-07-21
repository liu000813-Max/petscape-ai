import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  B7_SANDBOX_SCENE_CONFIRMATION_ID,
  bootstrapFirstAdmin,
  completeCheckRun,
  createCheckRun,
  createCustomizationRequest,
  createQuote,
  createSandboxEstimateJob,
  startCheckRun,
} from '../../packages/server/src/application/index.ts';
import { createPrismaClient } from '../../packages/server/src/infra/db/index.ts';

const webRoot = fileURLToPath(new URL('../', import.meta.url));
const PORT = process.env.E2E_C3_PORT ?? '3428';
const BASE = `http://127.0.0.1:${PORT}`;
const DIR = fileURLToPath(new URL('../test-results/c3-payments/', import.meta.url));
const phoneSeed = Number(BigInt(Date.now()) % 100000000n);
const defaultPhones = `137${String(phoneSeed).padStart(8, '0')},137${String((phoneSeed + 1) % 100000000).padStart(8, '0')}`;
const PHONES = (process.env.E2E_C3_PHONES ?? defaultPhones).split(',');

if (!process.env.DATABASE_URL) throw new Error('C3 browser e2e 需要 PostgreSQL');
if (!process.env.SANDBOX_PAYMENT_SECRET) throw new Error('C3 browser e2e 需要动态测试 secret');

const prisma = createPrismaClient({ connectionString: process.env.DATABASE_URL, poolMax: 8 });
let child;
let log = '';
let browser;

const waitExit = (processHandle, milliseconds) => processHandle.exitCode !== null
  ? Promise.resolve(true)
  : Promise.race([
      new Promise((resolve) => processHandle.once('exit', () => resolve(true))),
      sleep(milliseconds).then(() => false),
    ]);

function signal(processHandle, signalName) {
  try {
    process.kill(-processHandle.pid, signalName);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

async function stop() {
  if (!child || child.exitCode !== null) return;
  const graceful = waitExit(child, 2000);
  signal(child, 'SIGTERM');
  if (await graceful) return;
  const forced = waitExit(child, 2000);
  signal(child, 'SIGKILL');
  await forced;
}

async function ready() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      if ((await fetch(`${BASE}/api/v1/commerce/payment-intents`)).status === 401) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(log.slice(-4000));
}

async function otp(phone, offset, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const code = [...log.slice(offset).matchAll(new RegExp(`\\[SMS:log\\] OTP for \\+86${phone} => (\\d+)`, 'g'))].at(-1)?.[1];
    if (code) return code;
    await sleep(150);
  }
  throw new Error(`OTP missing for ${phone} after ${timeoutMs}ms\n${log.slice(-4000)}`);
}

async function login(page, phone) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('手机号').fill(phone);
  const offset = log.length;
  await page.getByRole('button', { name: '获取验证码' }).click();
  await page.getByLabel('验证码').fill(await otp(phone, offset));
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL(`${BASE}/account`);
}

async function api(page, path, init = {}) {
  return page.evaluate(async ({ requestPath, requestInit }) => {
    const response = await fetch(requestPath, requestInit);
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { requestPath: path, requestInit: init });
}

async function fixture(ownerUserId) {
  const suffix = `${Date.now()}-${Math.random()}`;
  const request = (await createCustomizationRequest({
    prisma,
    ownerUserId,
    input: {
      sceneConfirmationId: B7_SANDBOX_SCENE_CONFIRMATION_ID,
      idempotencyKey: `c3-e2e-r-${suffix}`,
      contactName: 'C3 浏览器用户',
      contactPhone: '13800138000',
      usageDescription: 'C3 沙箱支付',
      additionalRequirements: null,
    },
  })).request;

  let admin = await prisma.user.findFirst({ where: { role: 'admin' } });
  if (!admin) {
    await bootstrapFirstAdmin({ prisma, targetUserId: ownerUserId, reason: 'C3 e2e' });
    admin = await prisma.user.findUniqueOrThrow({ where: { id: ownerUserId } });
  }
  const check = (await createCheckRun({ prisma, actorUserId: admin.id, input: { requestId: request.id } })).checkRun;
  await startCheckRun({ prisma, actorUserId: admin.id, checkRunId: check.id });
  await completeCheckRun({
    prisma,
    actorUserId: admin.id,
    checkRunId: check.id,
    input: {
      result: 'approved',
      issues: [],
      adjustmentSuggestions: [],
      note: 'C3 e2e',
      evidence: [{ kind: 'note', ref: 'manual://c3-e2e', summary: 'C3' }],
    },
  });

  const estimate = await createSandboxEstimateJob({
    prisma,
    ownerUserId,
    sceneConfirmationId: B7_SANDBOX_SCENE_CONFIRMATION_ID,
  });
  await prisma.job.update({
    where: { id: estimate.estimateJobId },
    data: {
      status: 'succeeded',
      resultRef: {
        schemaVersion: 'mesh-analysis-result.v0',
        algorithmVersion: 'trimesh-volume.v0',
        geometryUnit: 'millimeter',
        assetChecksum: '8191dcdaaa3d01993df661857e388c1cbe641b5d0443d47b692a856acf6d596d',
        dimensionsMm: { x: 120, y: 119.022, z: 53.865 },
        volumeMm3: 240342.387,
        triangleCount: 103716,
        watertight: true,
      },
    },
  });
  return (await createQuote({
    prisma,
    ownerUserId,
    input: {
      requestId: request.id,
      estimateJobId: estimate.estimateJobId,
      idempotencyKey: `c3-e2e-q-${suffix}`,
      quoteMode: 'sandbox_test',
    },
  })).quote;
}

test.before(async () => {
  await mkdir(DIR, { recursive: true });
  child = spawn('pnpm', ['exec', 'next', 'dev', '--webpack', '-H', '127.0.0.1', '-p', PORT], {
    cwd: webRoot,
    detached: true,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      WATCHPACK_POLLING: 'true',
      SMS_CHANNEL: 'log',
      BETTER_AUTH_SECRET: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      BETTER_AUTH_URL: BASE,
      PAYMENT_PROVIDER_MODE: 'sandbox',
      ALIBABA_CLOUD_ACCESS_KEY_ID: 'c3-unused',
      ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'c3-unused-secret',
      ALIBABA_CLOUD_OSS_BUCKET: 'c3-unused-bucket',
      ALIBABA_CLOUD_OSS_ENDPOINT: 'oss-cn-hangzhou.aliyuncs.com',
      ALIBABA_CLOUD_REGION: 'cn-hangzhou',
      PORT,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  await ready();
  browser = process.env.PLAYWRIGHT_WS_ENDPOINT
    ? await chromium.connect(process.env.PLAYWRIGHT_WS_ENDPOINT)
    : await chromium.launch();
});

test.after(async () => {
  await browser?.close();
  await prisma.$disconnect();
  await stop();
});

test('accepts a quote, confirms checkout, retries sandbox payment, and hands success to one recoverable order', async () => {
  assert.equal((await fetch(`${BASE}/api/v1/commerce/payment-intents`)).status, 401);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    recordVideo: { dir: DIR, size: { width: 1280, height: 900 } },
  });
  const otherContext = await browser.newContext();
  const page = await context.newPage();
  const otherPage = await otherContext.newPage();
  // This flow visits several routes that Next compiles lazily on a clean CI
  // runner. The assertions stay unchanged; only cold compilation gets room.
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(60_000);
  try {
    await login(page, PHONES[0]);
    const me = await api(page, '/api/me');
    const quote = await fixture(me.body.userId);

    await page.goto(`${BASE}/quotes`);
    await page.getByRole('button', { name: '接受测试报价' }).click();
    await page.getByText('已接受测试报价。下一步确认配送地址，再创建沙箱支付意图。').waitFor();
    await page.getByRole('link', { name: '填写并确认配送地址' }).click();
    await page.getByRole('heading', { name: '配送确认' }).waitFor();

    await page.getByLabel('收件人').fill('C3 收件人');
    await page.getByLabel('手机号').fill('13800138000');
    await page.getByLabel('省').fill('浙江省');
    await page.getByLabel('市').fill('杭州市');
    await page.getByLabel('区/县').fill('余杭区');
    await page.getByLabel('详细地址').fill('文一西路 C3 沙箱地址');
    await page.getByLabel(/邮政编码/).fill('311100');
    await page.getByRole('button', { name: '保存地址' }).click();
    await page.getByText('地址已保存，请核对后确认。').waitFor();
    await page.getByRole('button', { name: '确认此地址' }).click();
    await page.getByText('沙箱配送地址已确认；支付入口仍关闭，不会产生真实交易。').waitFor();

    await page.goto(`${BASE}/payments`);
    await page.getByText('交易功能仍关闭').waitFor();
    await page.getByRole('button', { name: '创建沙箱支付' }).click();
    await page.getByText('¥330.00').waitFor();
    await page.getByRole('link', { name: '进入沙箱支付页' }).click();
    await page.getByText('模拟支付渠道').waitFor();
    await page.screenshot({ path: `${DIR}/c3-sandbox-requires-action.png`, fullPage: true });

    await page.getByRole('button', { name: '模拟失败' }).click();
    await page.getByText(/当前状态：failed/).waitFor();
    await page.getByRole('link', { name: '返回支付结果' }).click();
    await page.getByRole('button', { name: '重试支付' }).click();
    await page.getByText('已创建新的沙箱支付尝试。').waitFor();
    await page.getByRole('link', { name: '进入沙箱支付页' }).click();
    await page.getByRole('button', { name: '模拟成功' }).click();
    await page.getByText(/当前状态：succeeded/).waitFor();
    await page.getByText('沙箱订单已由服务端幂等生成。').waitFor();
    await page.getByRole('link', { name: '返回支付结果' }).click();
    await page.getByText('沙箱成功', { exact: true }).waitFor();
    await page.getByText('沙箱成功只会生成可识别的沙箱订单，不代表真实支付、成交或履约。', { exact: true }).waitFor();
    await page.getByRole('link', { name: '查看沙箱订单' }).click();
    await page.getByRole('heading', { name: '沙箱订单', level: 1 }).waitFor();
    await page.getByText('已支付（沙箱）', { exact: true }).waitFor();
    await page.getByText('文一西路').waitFor();
    await page.getByText('¥330.00', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /真实支付|微信支付|支付宝/ }).count(), 0);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${DIR}/c3-sandbox-succeeded-with-order.png`, fullPage: true });

    const list = await api(page, '/api/v1/commerce/payment-intents');
    const intent = list.body.paymentIntents.find((item) => item.quoteId === quote.id);
    assert.equal(intent.status, 'succeeded');
    assert.equal(intent.amountCent, quote.amountCent);
    assert.equal(intent.attempts.length, 2);
    assert.equal(await prisma.order.count({ where: { paymentIntentId: intent.id } }), 1);

    await login(otherPage, PHONES[1]);
    const foreign = await api(otherPage, `/api/v1/commerce/payment-intents/${intent.id}`);
    assert.equal(foreign.status, 404);
  } finally {
    await context.close();
    await otherContext.close();
  }
});
