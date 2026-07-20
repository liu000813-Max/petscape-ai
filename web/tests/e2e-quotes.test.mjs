// WP-C2-1 — real Next + PostgreSQL + Chromium sandbox quote flow.
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
  createSandboxEstimateJob,
  startCheckRun,
} from '../../packages/server/src/application/index.ts';
import { createPrismaClient } from '../../packages/server/src/infra/db/index.ts';

const webRoot = fileURLToPath(new URL('../', import.meta.url));
const PORT = process.env.E2E_C2_PORT ?? '3423';
const BASE_URL = `http://127.0.0.1:${PORT}`;
const EVIDENCE_DIR = fileURLToPath(new URL('../test-results/ui-polish-pack-b/', import.meta.url));
const OWNER_PHONE = '13700004231';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 未设置：C2 browser e2e 需要 PostgreSQL。');

const prisma = createPrismaClient({ connectionString: process.env.DATABASE_URL, poolMax: 6 });
let serverProcess;
let serverLog = '';
let browser;

function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return Promise.race([new Promise((resolve) => child.once('exit', () => resolve(true))), sleep(timeoutMs).then(() => false)]);
}

function signalProcessGroup(child, signal) {
  if (!child.pid) return;
  try { if (process.platform === 'win32') child.kill(signal); else process.kill(-child.pid, signal); }
  catch (error) { if (error?.code !== 'ESRCH') throw error; }
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const graceful = waitForProcessExit(child, 2_000); signalProcessGroup(child, 'SIGTERM');
  if (await graceful) return;
  const forced = waitForProcessExit(child, 2_000); signalProcessGroup(child, 'SIGKILL');
  if (!(await forced)) throw new Error('C2 e2e server process group did not exit');
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE_URL}/api/v1/commerce/quotes`)).status === 401) return; } catch {}
    await sleep(300);
  }
  throw new Error(`C2 server 未就绪\n${serverLog.slice(-5000)}`);
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

test.before(async () => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  serverProcess = spawn('pnpm', ['exec', 'next', 'dev', '--webpack', '-H', '127.0.0.1', '-p', PORT], {
    cwd: webRoot,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      NODE_ENV: 'development', WATCHPACK_POLLING: 'true', SMS_CHANNEL: 'log',
      BETTER_AUTH_SECRET: 'c2-e2e-only-secret-at-least-thirty-two-characters', BETTER_AUTH_URL: BASE_URL,
      ALIBABA_CLOUD_ACCESS_KEY_ID: 'c2-unused', ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'c2-unused-secret',
      ALIBABA_CLOUD_OSS_BUCKET: 'c2-unused-bucket', ALIBABA_CLOUD_OSS_ENDPOINT: 'oss-cn-hangzhou.aliyuncs.com',
      ALIBABA_CLOUD_REGION: 'cn-hangzhou', PORT,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
  serverProcess.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });
  await waitForServer();
  browser = process.env.PLAYWRIGHT_WS_ENDPOINT
    ? await chromium.connect(process.env.PLAYWRIGHT_WS_ENDPOINT)
    : await chromium.launch();
});

test.after(async () => {
  await browser?.close();
  await prisma.$disconnect();
  await stopServer(serverProcess);
});

test('approved request creates a server-priced sandbox quote and exposes the sandbox payment handoff', async () => {
  const anonymous = await browser.newPage();
  await anonymous.goto(`${BASE_URL}/quotes`);
  await anonymous.waitForURL(`${BASE_URL}/login`);
  await anonymous.close();

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    recordVideo: { dir: EVIDENCE_DIR, size: { width: 1280, height: 900 } },
  });
  const page = await context.newPage();
  try {
    await login(page, OWNER_PHONE);
    const me = await browserApi(page, '/api/me');
    assert.equal(me.status, 200);

    await page.goto(`${BASE_URL}/requests`);
    await page.getByLabel('联系人').fill('C2 浏览器用户');
    await page.getByLabel('联系电话').fill('13800138000');
    await page.getByLabel('使用说明').fill('C2 沙箱报价浏览器验收。');
    await page.getByRole('button', { name: '提交申请' }).click();
    await page.getByText('C2 浏览器用户 · 13800138000').waitFor();
    const requests = await browserApi(page, '/api/v1/commerce/customization-requests');
    const request = requests.body.requests.find((item) => item.contactName === 'C2 浏览器用户');
    assert.ok(request);

    let admin = await prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' } });
    if (!admin) {
      await bootstrapFirstAdmin({ prisma, targetUserId: me.body.userId, reason: 'C2 browser QA bootstrap' });
      admin = await prisma.user.findUniqueOrThrow({ where: { id: me.body.userId } });
    }
    const queued = (await createCheckRun({ prisma, actorUserId: admin.id, input: { requestId: request.id } })).checkRun;
    await startCheckRun({ prisma, actorUserId: admin.id, checkRunId: queued.id });
    await completeCheckRun({
      prisma, actorUserId: admin.id, checkRunId: queued.id,
      input: {
        result: 'approved', issues: [], adjustmentSuggestions: [], note: '仅供 C2 沙箱浏览器验收',
        evidence: [{ kind: 'note', ref: 'manual://c2-browser', summary: 'C2 沙箱浏览器审核证据' }],
      },
    });
    const estimate = await createSandboxEstimateJob({
      prisma, ownerUserId: me.body.userId, sceneConfirmationId: B7_SANDBOX_SCENE_CONFIRMATION_ID,
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

    await page.goto(`${BASE_URL}/quotes`);
    await page.getByText('沙箱 · 不可真实支付').waitFor();
    await page.getByRole('button', { name: '生成测试报价' }).click();
    await page.locator('.psx-quote-money strong').filter({ hasText: '330' }).waitFor();
    await page.getByText('向上取整到整元').waitFor();
    await page.getByText('沙箱交期未验证，不构成履约承诺').waitFor();

    const quotes = await browserApi(page, '/api/v1/commerce/quotes');
    assert.equal(quotes.status, 200);
    assert.equal(quotes.body.quotes.length, 1);
    const quote = quotes.body.quotes[0];
    assert.equal(quote.amountCent, 33000);
    assert.equal(new Date(quote.expiresAt).getTime() - new Date(quote.validFrom).getTime(), 7 * 86_400_000);
    const injected = await browserApi(page, '/api/v1/commerce/quotes', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: request.id, estimateJobId: estimate.estimateJobId, idempotencyKey: 'c2-browser-injected', quoteMode: 'sandbox_test', amountCent: 1 }),
    });
    assert.equal(injected.status, 400);
    await page.screenshot({ path: `${EVIDENCE_DIR}/c2-active-sandbox-quote.png`, fullPage: true });

    await page.getByRole('button', { name: '接受测试报价' }).click();
    await page.getByText('已接受测试报价。下一步确认配送地址，再创建沙箱支付意图。').waitFor();
    await page.getByText('已接受', { exact: true }).waitFor();
    await page.getByText('确认配送地址 → 创建支付意图 → 沙箱支付页').waitFor();
    await page.getByRole('link', { name: '填写并确认配送地址' }).waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${EVIDENCE_DIR}/c2-accepted-payment-entry.png`, fullPage: true });
  } finally {
    await context.close();
  }
});
