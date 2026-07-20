// web/tests/e2e-pets.test.mjs —— A4 Pet HTTP contracts + owner 隔离。
// 真实 Next dev + PostgreSQL；浏览器上下文持真实 session cookie，不 mock Route Handler。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const webRoot = fileURLToPath(new URL('../', import.meta.url));
const evidenceRoot = fileURLToPath(new URL('../test-results/ui-polish-pack-b/', import.meta.url));
const PORT = process.env.E2E_PETS_PORT ?? '3413';
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PHONES = ['13700004131', '13700004132', '13700004133'];
const UI_PHONE = '13700004134';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL 未设置：e2e-pets 需要已执行最新 migration 的 PostgreSQL。');
}

let serverProcess;
let serverLog = '';
let browser;

async function waitForServerReady(timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${BASE_URL}/api/v1/pets`);
      if (response.status === 401) return;
    } catch {
      // 继续轮询。
    }
    await sleep(300);
  }
  throw new Error(`Pet e2e server 未就绪\n${serverLog.slice(-5000)}`);
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
  await mkdir(evidenceRoot, { recursive: true });
  serverProcess = spawn('pnpm', ['exec', 'next', 'dev', '--webpack', '-H', '127.0.0.1', '-p', PORT], {
    cwd: webRoot,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      WATCHPACK_POLLING: 'true',
      SMS_CHANNEL: 'log',
      BETTER_AUTH_SECRET: 'a4-e2e-only-secret-at-least-thirty-two-characters',
      BETTER_AUTH_URL: BASE_URL,
      ALIBABA_CLOUD_ACCESS_KEY_ID: 'a4-e2e-unused-access-key',
      ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'a4-e2e-unused-access-secret',
      ALIBABA_CLOUD_OSS_BUCKET: 'a4-e2e-unused-bucket',
      ALIBABA_CLOUD_OSS_ENDPOINT: 'oss-cn-hangzhou.aliyuncs.com',
      ALIBABA_CLOUD_REGION: 'cn-hangzhou',
      PORT,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
  serverProcess.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });
  await waitForServerReady();
  browser = process.env.PLAYWRIGHT_WS_ENDPOINT
    ? await chromium.connect(process.env.PLAYWRIGHT_WS_ENDPOINT)
    : await chromium.launch();
});

test.after(async () => {
  await browser?.close();
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    await sleep(500);
    if (!serverProcess.killed) serverProcess.kill('SIGKILL');
  }
});

test('未登录 401；坏 JSON/坏 shape 400；公开 response 不泄漏内部字段', async () => {
  const anonymous = await fetch(`${BASE_URL}/api/v1/pets`);
  assert.equal(anonymous.status, 401);
  assert.deepEqual(await anonymous.json(), { error: 'unauthorized' });

  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await login(page, PHONES[0]);

    const malformed = await browserApi(page, '/api/v1/pets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error, 'invalid_json');

    const invalid = await browserApi(page, '/api/v1/pets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '小椒', ownerUserId: 'must-not-pass' }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, 'invalid_request');

    const created = await browserApi(page, '/api/v1/pets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '  A4 HTTP 小椒  ' }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.name, 'A4 HTTP 小椒');
    assert.equal(created.body.ownerUserId, undefined);
    assert.equal(created.body.ossKey, undefined);
    assert.match(created.body.createdAt, /^\d{4}-\d{2}-\d{2}T/);

    const listed = await browserApi(page, '/api/v1/pets');
    assert.equal(listed.status, 200);
    assert.ok(listed.body.pets.some((pet) => pet.id === created.body.id));
  } finally {
    await context.close();
  }
});

test('跨账号读取/修改/删除都是 404；owner 可编辑并软删除', async () => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  try {
    await login(pageA, PHONES[2]);
    const created = await browserApi(pageA, '/api/v1/pets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A 的隔离档案' }),
    });
    assert.equal(created.status, 201);

    await login(pageB, PHONES[1]);
    for (const [method, body] of [['GET'], ['PATCH', { name: '越权' }], ['DELETE']]) {
      const response = await browserApi(pageB, `/api/v1/pets/${created.body.id}`, {
        method,
        ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
      assert.equal(response.status, 404, `${method} foreign Pet 应返回 404`);
      assert.equal(response.body.error, 'not_found');
    }

    const updated = await browserApi(pageA, `/api/v1/pets/${created.body.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A 的已编辑档案', speciesCode: 'gecko', sizeLevel: 3 }),
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.name, 'A 的已编辑档案');

    const deleted = await browserApi(pageA, `/api/v1/pets/${created.body.id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.body, { deleted: true, id: created.body.id });
    assert.equal((await browserApi(pageA, `/api/v1/pets/${created.body.id}`)).status, 404);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('390×844 宠物建档为整页表单，上传区紧凑且 sticky 保存条持续可见', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await login(page, UI_PHONE);
    await page.goto(`${BASE_URL}/pets`);
    await page.getByRole('heading', { name: '宠物档案', level: 1 }).waitFor();
    await page.screenshot({ path: `${evidenceRoot}/pets-empty-mobile.png`, fullPage: true });
    await page.getByRole('button', { name: '新建宠物档案' }).first().click();

    const form = page.locator('.psx-pet-page-form');
    const coverPicker = page.locator('.psx-pet-cover-picker');
    const saveButton = page.getByRole('button', { name: '保存档案' });
    await page.getByRole('heading', { name: '新建宠物档案' }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);

    const coverBox = await coverPicker.boundingBox();
    assert.ok(coverBox);
    assert.ok(coverBox.height >= 100 && coverBox.height <= 124, `上传区高度应约为 108px，实际 ${coverBox.height}px`);

    const scrollMetrics = await form.evaluate((element) => ({
      formHeight: element.getBoundingClientRect().height,
      viewportHeight: window.innerHeight,
      bodyOverflow: document.body.style.overflow,
    }));
    assert.ok(scrollMetrics.formHeight > scrollMetrics.viewportHeight, '整页表单应由页面自然滚动');
    assert.equal(scrollMetrics.bodyOverflow, '');

    await page.evaluate(() => window.scrollTo(0, 720));
    await page.waitForFunction(() => window.scrollY > 0);
    const saveBox = await saveButton.boundingBox();
    assert.ok(saveBox);
    assert.ok(saveBox.y >= 0, '保存按钮顶部应位于视口内');
    assert.ok(saveBox.y + saveBox.height <= 844, '保存按钮底部应完整位于视口内');

    await page.screenshot({ path: `${evidenceRoot}/pet-full-page-mobile.png`, fullPage: true });

    const created = await browserApi(page, '/api/v1/pets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '小椒' }),
    });
    assert.equal(created.status, 201);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE_URL}/pets`);
    await page.getByRole('heading', { name: '宠物档案', level: 1 }).waitFor();
    await page.getByText('小椒').waitFor();
    await page.screenshot({ path: `${evidenceRoot}/pets-list-desktop.png`, fullPage: true });
    await browserApi(page, `/api/v1/pets/${created.body.id}`, { method: 'DELETE' });
  } finally {
    await context.close();
  }
});
