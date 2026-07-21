import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const webRoot = fileURLToPath(new URL('../', import.meta.url));
const evidenceRoot = fileURLToPath(new URL('../../screenshots/browser-qa/wp-b45-2/', import.meta.url));
const ciEvidenceRoot = fileURLToPath(new URL('../test-results/ui-polish-pack-a/', import.meta.url));
const PORT = process.env.E2E_VIEWER_PORT ?? '3415';
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PHONE = process.env.E2E_VIEWER_PHONE ?? '13700004315';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL 未设置：viewer model e2e 需要已迁移的 PostgreSQL。');
}

let serverProcess;
let serverLog = '';
let browser;

async function startServer() {
  serverLog = '';
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
}

async function stopServer() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    await sleep(800);
    if (!serverProcess.killed) serverProcess.kill('SIGKILL');
  }
}

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
  await startServer();
  browser = await chromium.launch();
});

test.after(async () => {
  await browser?.close();
  await stopServer();
});

test('真实数据库 Viewer：自动保存、恢复、revision 冲突与不可变确认历史', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const testStartedAt = performance.now();
  let stageStartedAt = testStartedAt;
  function checkpoint(name) {
    const now = performance.now();
    console.log(`viewer-stage ${name}: ${Math.round(now - stageStartedAt)}ms (total ${Math.round(now - testStartedAt)}ms)`);
    stageStartedAt = now;
  }
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
    checkpoint('login-and-project');

    const confirm = page.getByRole('button', { name: /确认此模型，进入场景/ });
    async function waitForModelReady() {
      await confirm.waitFor({ state: 'visible' });
      await page.waitForFunction(() => {
        const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('确认此模型'));
        return button instanceof HTMLButtonElement && !button.disabled;
      });
    }

    await waitForModelReady();
    await mkdir(evidenceRoot, { recursive: true });
    await mkdir(ciEvidenceRoot, { recursive: true });
    await page.screenshot({ path: `${evidenceRoot}/ui-polish-stage1-cheese-lounge-bed.png`, fullPage: true });
    await page.screenshot({ path: `${ciEvidenceRoot}/stage1-cheese-lounge-bed.png`, fullPage: true });

    await page.getByRole('button', { name: /奶酪游戏垫/ }).click();
    await waitForModelReady();
    await page.screenshot({ path: `${ciEvidenceRoot}/stage1-cheese-play-mat.png`, fullPage: true });

    await page.getByRole('button', { name: /香蕉小床/ }).click();
    await waitForModelReady();
    await page.screenshot({ path: `${ciEvidenceRoot}/stage1-banana-bed.png`, fullPage: true });

    const scale = page.getByRole('slider', { name: '统一比例' });
    await scale.fill('1.25');
    await page.getByText('最终 292.6 × 125 × 118.4 mm').waitFor();

    await confirm.click();
    await page.getByRole('heading', { name: '布置笼舍' }).waitFor();
    await page.getByText('已自动保存').waitFor();
    await page.getByText(`项目 · ${title}`).waitFor();
    assert.equal(await page.locator('.viewer-role.is-target').count(), 1);
    await page.getByText('香蕉小床').waitFor();
    await page.getByText('最终尺寸 292.6 × 125 × 118.4 mm').waitFor();
    checkpoint('model-selection-and-confirmation');

    await page.getByRole('button', { name: /加入 云朵苔藓台/ }).click();
    await page.getByRole('button', { name: /环境.*云朵苔藓台/ }).click();
    const sceneScale = page.getByRole('slider', { name: '等比缩放' });
    await sceneScale.fill('1.1');
    await page.getByText('最终尺寸 92.9 × 63 × 92.2 mm').waitFor();

    await page.getByLabel('位置 X (mm)').fill('0');
    await page.getByLabel('位置 Z (mm)').fill('0');
    await page.getByText('本次操作会与其他物品碰撞').waitFor();
    assert.equal(await page.getByLabel('位置 Z (mm)').inputValue(), '130');
    await page.screenshot({ path: `${evidenceRoot}/viewer-scene-collision-blocked.png`, fullPage: true });
    await page.getByRole('button', { name: '重置当前物品' }).click();

    const ratToggle = page.getByRole('checkbox', { name: '显示通用花枝鼠比例参照' });
    await ratToggle.uncheck();
    await ratToggle.check();
    await page.getByRole('button', { name: /比例参照.*通用成年花枝鼠/ }).click();
    await page.getByText(/尺寸固定为 220 × 110 × 80 mm/).waitFor();

    await page.getByLabel('长度 X').fill('200');
    await page.getByText(/超出笼舍边界/).waitFor();
    assert.equal(await page.getByRole('button', { name: '确认此场景' }).isDisabled(), true);
    await page.getByLabel('长度 X').fill('800');
    checkpoint('scene-edit-and-collision');

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
    await page.screenshot({ path: `${evidenceRoot}/viewer-scene-touch.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByRole('button', { name: '重置当前物品' }).click();
    await page.getByRole('button', { name: /加入 星星螺旋坡道/ }).click();
    await page.getByRole('button', { name: /环境.*星星螺旋坡道/ }).waitFor();
    await page.screenshot({ path: `${evidenceRoot}/ui-polish-stage2-edges-layout.png`, fullPage: true });
    await page.screenshot({ path: `${ciEvidenceRoot}/stage2-edges-layout.png`, fullPage: true });

    await page.getByText('已自动保存').waitFor({ timeout: 15_000 });
    checkpoint('touch-layout-and-autosave');

    // 可见失败与人工重试：只注入一次网络失败，随后仍由真实 Route + DB 保存。
    let abortedOnce = false;
    await page.route('**/api/v1/projects/*/scene', async (route) => {
      if (!abortedOnce && route.request().method() === 'PUT') {
        abortedOnce = true;
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });
    await page.getByLabel('高度 Y').fill('510');
    await page.getByText('保存失败，可重试').waitFor({ timeout: 15_000 });
    await page.unroute('**/api/v1/projects/*/scene');
    await page.getByRole('button', { name: '重试保存' }).click();
    await page.getByText('已自动保存').waitFor({ timeout: 15_000 });

    const sceneConfirm = page.getByRole('button', { name: '确认此场景' });
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('确认此场景'));
      return button instanceof HTMLButtonElement && !button.disabled;
    });
    const firstConfirmationResponse = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().includes('/api/v1/scenes/')
      && response.url().endsWith('/confirmations')
    ));
    await sceneConfirm.click();
    const firstConfirmationId = (await (await firstConfirmationResponse).json()).id;
    assert.ok(firstConfirmationId);
    await page.getByText('最近确认已保存').waitFor();
    await page.getByRole('button', { name: '回到原点' }).click();
    await page.getByText(/确认已保存到服务器；不代表可制造/).waitFor();
    checkpoint('save-retry-and-first-confirmation');

    await page.screenshot({ path: `${evidenceRoot}/viewer-scene-confirmation.png`, fullPage: true });

    // 两个标签从同一 revision 开始；A 先保存，B 的旧 revision 不得覆盖。
    const stalePage = await context.newPage();
    await stalePage.goto(page.url());
    await stalePage.getByRole('heading', { name: '布置笼舍' }).waitFor();
    await stalePage.getByText('已自动保存').waitFor();

    await page.getByLabel('长度 X').fill('820');
    await page.getByText(/当前场景已有新变化/).waitFor();
    await page.getByText(/有未保存更改|保存中/).waitFor();
    await page.getByText('已自动保存').waitFor({ timeout: 15_000 });
    const secondConfirmationResponse = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().includes('/api/v1/scenes/')
      && response.url().endsWith('/confirmations')
    ));
    await sceneConfirm.click();
    const secondConfirmationId = (await (await secondConfirmationResponse).json()).id;
    assert.ok(secondConfirmationId);
    assert.notEqual(secondConfirmationId, firstConfirmationId);

    const staleSaveResponse = stalePage.waitForResponse((response) => (
      response.request().method() === 'PUT'
      && response.url().includes('/api/v1/projects/')
      && response.url().endsWith('/scene')
      && response.status() === 409
    ));
    await stalePage.getByLabel('宽度 Z').fill('520');
    await staleSaveResponse;
    await stalePage.getByRole('status').filter({ hasText: '检测到保存冲突，未覆盖服务器内容' }).waitFor();
    await stalePage.getByRole('alert').filter({ hasText: '其他标签页已保存更新；当前草稿没有覆盖服务器内容。' }).waitFor();
    assert.equal(await stalePage.getByRole('button', { name: '确认此场景' }).isDisabled(), true);
    await stalePage.screenshot({ path: `${evidenceRoot}/viewer-revision-conflict.png`, fullPage: true });

    const oldSnapshot = await page.evaluate(async (id) => {
      const response = await fetch(`/api/v1/scene-confirmations/${id}`);
      return { status: response.status, json: await response.json() };
    }, firstConfirmationId);
    assert.equal(oldSnapshot.status, 200);
    assert.equal(oldSnapshot.json.snapshot.cageMm.width, 800);
    assert.equal(oldSnapshot.json.id, firstConfirmationId);
    await stalePage.close();
    checkpoint('revision-conflict-and-history');

    // 刷新与实际 Next 服务重启后都从 PostgreSQL 恢复同一最新 revision。
    await page.reload();
    await page.getByRole('heading', { name: '布置笼舍' }).waitFor();
    assert.equal(await page.getByLabel('长度 X').inputValue(), '820');
    assert.equal(await page.evaluate(async (projectId) => {
      const response = await fetch(`/api/v1/projects/${projectId}/viewer-state`);
      return (await response.json()).latestSceneConfirmation.id;
    }, new URL(page.url()).searchParams.get('projectId')), secondConfirmationId);
    checkpoint('page-reload-restore');

    const persistedViewerUrl = page.url();
    await stopServer();
    await startServer();
    await page.goto(persistedViewerUrl);
    await page.getByRole('heading', { name: '布置笼舍' }).waitFor({ timeout: 20_000 });
    assert.equal(await page.getByLabel('长度 X').inputValue(), '820');
    assert.equal(await page.evaluate(async (projectId) => {
      const response = await fetch(`/api/v1/projects/${projectId}/viewer-state`);
      return (await response.json()).latestSceneConfirmation.id;
    }, new URL(page.url()).searchParams.get('projectId')), secondConfirmationId);
    await page.screenshot({ path: `${evidenceRoot}/viewer-server-restart-restored.png`, fullPage: true });
    checkpoint('server-restart-restore');

    await page.goto(BASE_URL);
    await page.getByRole('heading', { name: /为爱宠定制/ }).waitFor();
    await page.getByRole('button', { name: '开始定制' }).waitFor();
    await page.getByRole('button', { name: '浏览标品' }).waitFor();
    await page.screenshot({ path: `${evidenceRoot}/landing-first-fold.png`, fullPage: false });
    checkpoint('landing-page');
  } finally {
    await context.close();
  }
});
