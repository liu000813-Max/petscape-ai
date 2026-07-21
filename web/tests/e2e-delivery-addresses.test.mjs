// WP-C5-1 — real Next + PostgreSQL 16 + Chromium address save/confirm/edit boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  B7_SANDBOX_SCENE_CONFIRMATION_ID,
  acceptQuote,
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
const PORT = process.env.E2E_C5_PORT ?? '3425';
const BASE_URL = `http://127.0.0.1:${PORT}`;
const EVIDENCE_DIR = fileURLToPath(new URL('../test-results/c5-delivery-addresses/', import.meta.url));
const PHONES = ['13700004251', '13700004252'];

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 未设置：C5 browser e2e 需要 PostgreSQL 16。');
const prisma = createPrismaClient({ connectionString: process.env.DATABASE_URL, poolMax: 8 });
let serverProcess;
let serverLog = '';
let browser;

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return Promise.race([new Promise((resolve) => child.once('exit', () => resolve(true))), sleep(timeoutMs).then(() => false)]);
}
function signalGroup(child, signal) {
  if (!child.pid) return;
  try { if (process.platform === 'win32') child.kill(signal); else process.kill(-child.pid, signal); }
  catch (error) { if (error?.code !== 'ESRCH') throw error; }
}
async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const graceful = waitForExit(child, 2_000); signalGroup(child, 'SIGTERM');
  if (await graceful) return;
  const forced = waitForExit(child, 2_000); signalGroup(child, 'SIGKILL');
  if (!(await forced)) throw new Error('C5 e2e server process group did not exit');
}
async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE_URL}/api/v1/commerce/delivery-addresses`)).status === 401) return; } catch {}
    await sleep(300);
  }
  throw new Error(`C5 server 未就绪\n${serverLog.slice(-5000)}`);
}
async function waitForOtp(phone, offset) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const matches = [...serverLog.slice(offset).matchAll(new RegExp(`\\[SMS:log\\] OTP for \\+86${phone} => (\\d+)`, 'g'))];
    if (matches.at(-1)?.[1]) return matches.at(-1)[1];
    await sleep(150);
  }
  throw new Error(`未捕获 ${phone} OTP\n${serverLog.slice(-5000)}`);
}
async function login(page, phone) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel('手机号').fill(phone);
  const offset = serverLog.length;
  await page.getByRole('button', { name: '获取验证码' }).click();
  await page.getByLabel('验证码').fill(await waitForOtp(phone, offset));
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL(`${BASE_URL}/account`);
}
async function browserApi(page, path, init = {}) {
  return page.evaluate(async ({ path, init }) => {
    const response = await fetch(path, init);
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { path, init });
}

async function createAcceptedQuote(ownerUserId) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const request = (await createCustomizationRequest({
    prisma, ownerUserId,
    input: {
      sceneConfirmationId: B7_SANDBOX_SCENE_CONFIRMATION_ID,
      idempotencyKey: `c5-e2e-request-${suffix}`,
      contactName: 'C5 浏览器用户', contactPhone: '13800138000',
      usageDescription: 'C5 沙箱配送确认浏览器验收。', additionalRequirements: null,
    },
  })).request;
  let admin = await prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' } });
  if (!admin) {
    await bootstrapFirstAdmin({ prisma, targetUserId: ownerUserId, reason: 'C5 browser QA bootstrap' });
    admin = await prisma.user.findUniqueOrThrow({ where: { id: ownerUserId } });
  }
  const check = (await createCheckRun({ prisma, actorUserId: admin.id, input: { requestId: request.id } })).checkRun;
  await startCheckRun({ prisma, actorUserId: admin.id, checkRunId: check.id });
  await completeCheckRun({
    prisma, actorUserId: admin.id, checkRunId: check.id,
    input: {
      result: 'approved', issues: [], adjustmentSuggestions: [], note: '仅供 C5 沙箱浏览器验收',
      evidence: [{ kind: 'note', ref: 'manual://c5-browser', summary: 'C5 沙箱浏览器审核证据' }],
    },
  });
  const estimate = await createSandboxEstimateJob({
    prisma, ownerUserId, sceneConfirmationId: B7_SANDBOX_SCENE_CONFIRMATION_ID,
  });
  await prisma.job.update({
    where: { id: estimate.estimateJobId },
    data: { status: 'succeeded', resultRef: {
      schemaVersion: 'mesh-analysis-result.v0', algorithmVersion: 'trimesh-volume.v0', geometryUnit: 'millimeter',
      assetChecksum: '8191dcdaaa3d01993df661857e388c1cbe641b5d0443d47b692a856acf6d596d',
      dimensionsMm: { x: 120, y: 119.022, z: 53.865 }, volumeMm3: 240342.387,
      triangleCount: 103716, watertight: true,
    } },
  });
  const quote = (await createQuote({
    prisma, ownerUserId,
    input: { requestId: request.id, estimateJobId: estimate.estimateJobId, idempotencyKey: `c5-e2e-quote-${suffix}`, quoteMode: 'sandbox_test' },
  })).quote;
  return acceptQuote({ prisma, ownerUserId, quoteId: quote.id, input: { expectedStatus: 'active' } });
}

test.before(async () => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  serverProcess = spawn('pnpm', ['exec', 'next', 'dev', '--webpack', '-H', '127.0.0.1', '-p', PORT], {
    cwd: webRoot, detached: process.platform !== 'win32',
    env: {
      ...process.env, NODE_ENV: 'development', SMS_CHANNEL: 'log',
      BETTER_AUTH_SECRET: 'c5-e2e-only-secret-at-least-thirty-two-characters', BETTER_AUTH_URL: BASE_URL,
      ALIBABA_CLOUD_ACCESS_KEY_ID: 'c5-unused', ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'c5-unused-secret',
      ALIBABA_CLOUD_OSS_BUCKET: 'c5-unused-bucket', ALIBABA_CLOUD_OSS_ENDPOINT: 'oss-cn-hangzhou.aliyuncs.com',
      ALIBABA_CLOUD_REGION: 'cn-hangzhou', PORT,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
  serverProcess.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });
  await waitForServer();
  browser = await chromium.launch();
});

test.after(async () => {
  await browser?.close();
  await prisma.$disconnect();
  await stopServer(serverProcess);
});

test('accepted quote address is owner-only, explicitly confirmed, and editing clears confirmation', async () => {
  const anonymous = await fetch(`${BASE_URL}/api/v1/commerce/delivery-addresses`);
  assert.equal(anonymous.status, 401);
  assert.deepEqual(await anonymous.json(), { error: 'unauthorized' });

  const contextA = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    recordVideo: { dir: EVIDENCE_DIR, size: { width: 1280, height: 900 } },
  });
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  try {
    await login(pageA, PHONES[0]);
    const me = await browserApi(pageA, '/api/me');
    const quote = await createAcceptedQuote(me.body.userId);

    await pageA.goto(`${BASE_URL}/checkout`);
    await pageA.getByText('沙箱 · 支付入口关闭').waitFor();
    await pageA.getByText('这不是实际下单').waitFor();
    await pageA.getByLabel('收件人').fill('C5 浏览器收件人');
    await pageA.getByLabel('手机号').fill('13800138000');
    await pageA.getByLabel('省').fill('浙江省');
    await pageA.getByLabel('市').fill('杭州市');
    await pageA.getByLabel('区/县').fill('余杭区');
    await pageA.getByLabel('详细地址').fill('文一西路 969 号沙箱测试地址');
    await pageA.getByLabel(/邮政编码/).fill('311100');
    await pageA.getByRole('button', { name: '保存地址' }).click();
    await pageA.getByText('地址已保存，请核对后确认。').waitFor();
    await pageA.screenshot({ path: `${EVIDENCE_DIR}/c5-address-saved-unconfirmed.png`, fullPage: true });

    let listed = await browserApi(pageA, '/api/v1/commerce/delivery-addresses');
    assert.equal(listed.status, 200);
    const address = listed.body.deliveryAddresses.find((item) => item.quoteId === quote.id);
    assert.ok(address);
    assert.equal(address.confirmed, false);

    const injected = await browserApi(pageA, '/api/v1/commerce/delivery-addresses', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quoteId: quote.id, expectedVersion: address.version, confirmedAt: new Date().toISOString(), recipientName: '攻击者' }),
    });
    assert.equal(injected.status, 400);

    await pageA.getByRole('button', { name: '确认此地址' }).click();
    await pageA.getByText('沙箱配送地址已确认；支付入口仍关闭，不会产生真实交易。').waitFor();
    await pageA.getByText(/已确认 · v/).waitFor();
    assert.equal(await pageA.getByRole('button', { name: /支付/ }).count(), 0);
    await pageA.screenshot({ path: `${EVIDENCE_DIR}/c5-address-confirmed-no-payment.png`, fullPage: true });

    const mobileContext = await browser.newContext({
      storageState: await contextA.storageState(),
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    try {
      const mobilePage = await mobileContext.newPage();
      await mobilePage.goto(`${BASE_URL}/checkout`);
      await mobilePage.getByText('沙箱 · 支付入口关闭').waitFor();
      await mobilePage.getByText(/已确认 · v/).waitFor();
      assert.equal(await mobilePage.getByRole('button', { name: /支付/ }).count(), 0);
      await mobilePage.screenshot({ path: `${EVIDENCE_DIR}/c5-address-confirmed-mobile.png`, fullPage: true });
    } finally {
      await mobileContext.close();
    }

    listed = await browserApi(pageA, '/api/v1/commerce/delivery-addresses');
    const confirmed = listed.body.deliveryAddresses.find((item) => item.id === address.id);
    assert.equal(confirmed.confirmed, true);

    await pageA.getByLabel('详细地址').fill('文一西路 970 号沙箱修改地址');
    await pageA.getByRole('button', { name: '保存地址修改' }).click();
    await pageA.getByText('地址已更新，原确认已清除；请核对后重新确认。').waitFor();
    await pageA.getByText(/待确认 · v/).waitFor();
    listed = await browserApi(pageA, '/api/v1/commerce/delivery-addresses');
    assert.equal(listed.body.deliveryAddresses.find((item) => item.id === address.id).confirmed, false);

    await login(pageB, PHONES[1]);
    const foreignList = await browserApi(pageB, '/api/v1/commerce/delivery-addresses');
    assert.equal(foreignList.status, 200);
    assert.equal(foreignList.body.deliveryAddresses.some((item) => item.id === address.id), false);
    const foreignConfirm = await browserApi(pageB, `/api/v1/commerce/delivery-addresses/${address.id}/confirm`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedVersion: confirmed.version }),
    });
    assert.equal(foreignConfirm.status, 404);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
