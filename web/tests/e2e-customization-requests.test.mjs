// WP-C1-1 — 真实 Next + PostgreSQL + Chromium 的沙箱申请全流程。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { B7_SANDBOX_SCENE_CONFIRMATION_ID } from '../../packages/server/src/application/commerce-sandbox-fixtures.ts';

const webRoot = fileURLToPath(new URL('../', import.meta.url));
const PORT = process.env.E2E_C1_PORT ?? '3421';
const BASE_URL = `http://127.0.0.1:${PORT}`;
const EVIDENCE_DIR = fileURLToPath(new URL('../test-results/c1-requests/', import.meta.url));
const PHONES = ['13700004211', '13700004212'];

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL 未设置：C1 browser e2e 需要已执行最新 migration 的 PostgreSQL。');
}

let serverProcess;
let serverLog = '';
let browser;

function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    sleep(timeoutMs).then(() => false),
  ]);
}

function signalServerProcess(child, signal) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

async function stopServerProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  const gracefulExit = waitForProcessExit(child, 2_000);
  signalServerProcess(child, 'SIGTERM');
  if (await gracefulExit) return;

  const forcedExit = waitForProcessExit(child, 2_000);
  signalServerProcess(child, 'SIGKILL');
  if (!(await forcedExit)) throw new Error('C1 e2e Next process group did not exit after SIGKILL');
}

async function waitForServerReady(timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${BASE_URL}/api/v1/commerce/customization-requests`);
      if (response.status === 401) return;
    } catch {
      // 继续轮询。
    }
    await sleep(300);
  }
  throw new Error(`C1 e2e server 未就绪\n${serverLog.slice(-5000)}`);
}

async function waitForOtp(phone, afterIndex, timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const freshLog = serverLog.slice(afterIndex);
    const matches = [...freshLog.matchAll(new RegExp(`\\[SMS:log\\] OTP for \\+86${phone} => (\\d+)`, 'g'))];
    const code = matches.at(-1)?.[1];
    if (code) return code;
    await sleep(150);
  }
  throw new Error(`未捕获 ${phone} 的 OTP\n${serverLog.slice(-5000)}`);
}

async function login(page, phone) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel('手机号').fill(phone);
  const logIndex = serverLog.length;
  await page.getByRole('button', { name: '获取验证码' }).click();
  const code = await waitForOtp(phone, logIndex);
  await page.getByLabel('验证码').fill(code);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL(`${BASE_URL}/account`, { timeout: 10_000 });
}

async function browserApi(page, path, init = {}) {
  return page.evaluate(
    async ({ path, init }) => {
      const response = await fetch(path, init);
      return { status: response.status, body: await response.json().catch(() => null) };
    },
    { path, init },
  );
}

test.before(async () => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  serverProcess = spawn('pnpm', ['exec', 'next', 'dev', '-H', '127.0.0.1', '-p', PORT], {
    cwd: webRoot,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      SMS_CHANNEL: 'log',
      BETTER_AUTH_SECRET: 'c1-e2e-only-secret-at-least-thirty-two-characters',
      BETTER_AUTH_URL: BASE_URL,
      ALIBABA_CLOUD_ACCESS_KEY_ID: 'c1-e2e-unused-access-key',
      ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'c1-e2e-unused-access-secret',
      ALIBABA_CLOUD_OSS_BUCKET: 'c1-e2e-unused-bucket',
      ALIBABA_CLOUD_OSS_ENDPOINT: 'oss-cn-hangzhou.aliyuncs.com',
      ALIBABA_CLOUD_REGION: 'cn-hangzhou',
      PORT,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
  serverProcess.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });
  await waitForServerReady();
  browser = await chromium.launch();
});

test.after(async () => {
  await browser?.close();
  await stopServerProcess(serverProcess);
});

test('anonymous is 401; owner submits and resubmits immutable sandbox history; other user gets 404', async () => {
  const anonymous = await fetch(`${BASE_URL}/api/v1/commerce/customization-requests`);
  assert.equal(anonymous.status, 401);
  assert.deepEqual(await anonymous.json(), { error: 'unauthorized' });

  const contextA = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    recordVideo: { dir: EVIDENCE_DIR, size: { width: 390, height: 844 } },
  });
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  try {
    await login(pageA, PHONES[0]);
    await pageA.goto(`${BASE_URL}/requests`);
    await pageA.getByText('沙箱 · 不会真实交易').waitFor();
    await pageA.getByLabel('联系人').fill('C1 浏览器用户');
    await pageA.getByLabel('联系电话').fill('13800138000');
    await pageA.getByLabel('使用说明').fill('给成年仓鼠在室内笼舍日常休息使用。');
    await pageA.getByLabel(/补充要求/).fill('入口边缘保持圆润。');
    await pageA.getByRole('button', { name: '提交沙箱申请' }).click();
    await pageA.getByText('沙箱申请已提交。它不会生成真实报价、支付或订单。').waitFor();
    await pageA.getByText('C1 浏览器用户 · 13800138000').waitFor();

    const firstList = await browserApi(pageA, '/api/v1/commerce/customization-requests');
    assert.equal(firstList.status, 200);
    assert.equal(firstList.body.requests.length, 1);
    const first = firstList.body.requests[0];
    assert.equal(first.status, 'submitted');
    assert.equal(first.sandboxOnly, true);
    assert.equal(first.sceneConfirmation.sceneConfirmationId, B7_SANDBOX_SCENE_CONFIRMATION_ID);
    assert.equal(first.amountCent, undefined);

    await pageA.getByRole('button', { name: '修改并重提' }).click();
    await pageA.getByLabel('使用说明').fill('改为给老年仓鼠短时休息使用。');
    await pageA.getByRole('button', { name: '提交新版本' }).click();
    await pageA.getByText('已被新版本替代').waitFor();
    await pageA.screenshot({ path: `${EVIDENCE_DIR}/c1-request-history-mobile.png`, fullPage: true });

    const secondList = await browserApi(pageA, '/api/v1/commerce/customization-requests');
    assert.equal(secondList.status, 200);
    assert.equal(secondList.body.requests.length, 2);
    assert.equal(secondList.body.requests[0].status, 'submitted');
    assert.equal(secondList.body.requests[1].status, 'superseded');
    assert.equal(secondList.body.requests[1].usageDescription, first.usageDescription);

    await login(pageB, PHONES[1]);
    const foreign = await browserApi(pageB, `/api/v1/commerce/customization-requests/${first.id}`);
    assert.equal(foreign.status, 404);
    assert.equal(foreign.body.error, 'not_found');
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
