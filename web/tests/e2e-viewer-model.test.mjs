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

test('登录后确认模型并完成不可变内存场景确认', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  try {
    await login(page);
    await page.goto(`${BASE_URL}/viewer`);
    await page.getByRole('heading', { name: '先选择一个明确项目' }).waitFor();

    const title = `Viewer B5 QA ${Date.now()}`;
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
    await page.getByRole('heading', { name: '布置笼舍' }).waitFor();
    await page.getByText(`项目 · ${title}`).waitFor();
    assert.equal(await page.locator('.viewer-role.is-target').count(), 1);
    await page.getByText('香蕉小床').waitFor();
    await page.getByText(/最终尺寸 X 292\.6 · Y 125\.0 · Z 118\.4 mm/).waitFor();

    await page.getByRole('button', { name: /加入 云朵苔藓台/ }).click();
    await page.getByRole('button', { name: /环境.*云朵苔藓台/ }).click();
    const sceneScale = page.getByRole('slider', { name: '等比缩放' });
    await sceneScale.fill('1.1');
    await page.getByText(/最终尺寸 X 217\.8 · Y 63\.0 · Z 73\.7 mm/).waitFor();

    await page.getByLabel('位置 X (mm)').fill('0');
    await page.getByLabel('位置 Z (mm)').fill('0');
    await page.getByText('本次操作会与其他物品碰撞').waitFor();
    assert.equal(await page.getByLabel('位置 Z (mm)').inputValue(), '130');
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/viewer-scene-collision-blocked.png', fullPage: true });
    await page.getByRole('button', { name: '重置当前物品' }).click();

    const ratToggle = page.getByRole('checkbox', { name: '显示通用花枝鼠比例参照' });
    await ratToggle.uncheck();
    await ratToggle.check();
    await page.getByRole('button', { name: /比例参照.*通用成年花枝鼠/ }).click();
    await page.getByText(/尺寸固定为 220 × 110 × 80 mm/).waitFor();

    await page.getByLabel('长度 X').fill('200');
    await page.getByText(/超出笼舍边界/).waitFor();
    assert.equal(await page.getByRole('button', { name: '确认场景（仅内存）' }).isDisabled(), true);
    await page.getByLabel('长度 X').fill('800');

    await page.getByRole('button', { name: /环境.*云朵苔藓台/ }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    assert.equal(await page.evaluate(() => navigator.maxTouchPoints), 5);
    const rotation = page.getByRole('slider', { name: 'Y 轴旋转' });
    await rotation.scrollIntoViewIfNeeded();
    const rotationBox = await rotation.boundingBox();
    assert.ok(rotationBox);
    const touchY = rotationBox.y + rotationBox.height / 2;
    const touchStartX = rotationBox.x + rotationBox.width * 0.25;
    const touchEndX = rotationBox.x + rotationBox.width * 0.75;
    const beforeTouchRotation = await rotation.inputValue();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchStartX, y: touchY }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchEndX, y: touchY }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.notEqual(await rotation.inputValue(), beforeTouchRotation);
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/viewer-scene-touch.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByRole('button', { name: '重置当前物品' }).click();

    const sceneConfirm = page.getByRole('button', { name: '确认场景（仅内存）' });
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('确认场景（仅内存）'));
      return button instanceof HTMLButtonElement && !button.disabled;
    });
    await sceneConfirm.click();
    await page.getByText(/已在当前浏览器内存冻结场景预览/).waitFor();
    await page.getByRole('button', { name: '回到原点' }).click();
    await page.getByText(/未保存 · 未写入数据库 · 不代表可制造/).waitFor();

    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/viewer-scene-confirmation.png', fullPage: true });
  } finally {
    await context.close();
  }
});
