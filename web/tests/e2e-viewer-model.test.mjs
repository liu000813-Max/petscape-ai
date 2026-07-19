import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const webRoot = fileURLToPath(new URL('../', import.meta.url));
const PORT = process.env.E2E_VIEWER_PORT ?? '3415';
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PHONE = process.env.E2E_VIEWER_PHONE ?? '13700004315';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL 未设置：viewer model e2e 需要已迁移的 PostgreSQL。');
}

let serverProcess;
let serverLog = '';
let browser;

async function waitForServerReady(timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${BASE_URL}/viewer`, { redirect: 'manual' });
      if (response.status === 307) return;
    } catch {
      // 等待真实 Next server。
    }
    await sleep(300);
  }
  throw new Error(`viewer e2e server 未就绪\n${serverLog.slice(-5000)}`);
}

async function waitForOtp(afterIndex, timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const matches = [...serverLog.slice(afterIndex).matchAll(new RegExp(`\\[SMS:log\\] OTP for \\+86${PHONE} => (\\d+)`, 'g'))];
    const code = matches.at(-1)?.[1];
    if (code) return code;
    await sleep(150);
  }
  throw new Error(`未捕获 viewer QA OTP\n${serverLog.slice(-5000)}`);
}

async function login(page) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel('手机号').fill(PHONE);
  const logIndex = serverLog.length;
  await page.getByRole('button', { name: '获取验证码' }).click();
  await page.getByLabel('验证码').fill(await waitForOtp(logIndex));
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL(`${BASE_URL}/account`, { timeout: 10_000 });
}

test.before(async () => {
  serverProcess = spawn('pnpm', ['exec', 'next', 'dev', '-H', '127.0.0.1', '-p', PORT], {
    cwd: webRoot,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      SMS_CHANNEL: 'log',
      BETTER_AUTH_SECRET: 'viewer-e2e-only-secret-at-least-thirty-two-characters',
      BETTER_AUTH_URL: BASE_URL,
      ALIBABA_CLOUD_ACCESS_KEY_ID: 'viewer-e2e-unused-access-key',
      ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'viewer-e2e-unused-secret',
      ALIBABA_CLOUD_OSS_BUCKET: 'viewer-e2e-unused-bucket',
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
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    await sleep(500);
    if (!serverProcess.killed) serverProcess.kill('SIGKILL');
  }
});

test('登录后明确创建项目，检视缩放模型并生成不可变内存确认', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  try {
    await login(page);
    await page.goto(`${BASE_URL}/viewer`);
    await page.getByRole('heading', { name: '先选择一个明确项目' }).waitFor();

    const title = `Viewer B4 QA ${Date.now()}`;
    await page.getByLabel('创建新项目').fill(title);
    await page.getByRole('button', { name: '创建并进入' }).click();
    await page.getByRole('heading', { name: '选择一个目标物品' }).waitFor();
    assert.match(page.url(), /\/viewer\?projectId=/);
    await page.getByText(`项目 · ${title}`).waitFor();

    await page.getByRole('button', { name: /香蕉小床/ }).click();
    const confirm = page.getByRole('button', { name: /确认此模型，进入场景/ });
    await assert.doesNotReject(async () => {
      await confirm.waitFor({ state: 'visible' });
      await page.waitForFunction(() => {
        const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('确认此模型'));
        return button instanceof HTMLButtonElement && !button.disabled;
      });
    });

    const scale = page.getByRole('slider', { name: '统一比例' });
    await scale.fill('1.25');
    await page.getByText('最终 292.6 × 125.0 × 118.4 mm').waitFor();

    await confirm.click();
    await page.getByRole('heading', { name: '模型版本已冻结，准备进入场景' }).waitFor();
    await page.getByText(title).waitFor();
    await page.getByText('banana-bed').waitFor();
    await page.getByText('292.6 × 125.0 × 118.4 mm').waitFor();
    await page.getByText(/尚未写入数据库 · 不代表可制造/).waitFor();

    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/viewer-model-confirmation.png', fullPage: true });
  } finally {
    await context.close();
  }
});
