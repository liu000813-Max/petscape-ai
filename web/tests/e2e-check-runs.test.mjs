// WP-B6-0 — real Next + PostgreSQL + Chromium admin review flow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { bootstrapFirstAdmin } from '../../packages/server/src/application/index.ts';
import { createPrismaClient } from '../../packages/server/src/infra/db/index.ts';

const webRoot = fileURLToPath(new URL('../', import.meta.url));
const PORT = process.env.E2E_B6_PORT ?? '3422';
const BASE_URL = `http://127.0.0.1:${PORT}`;
const EVIDENCE_DIR = fileURLToPath(new URL('../test-results/b6-reviews/', import.meta.url));
const OWNER_PHONE = '13700004221';
const OPERATOR_PHONE = '13700004222';
const REVIEWER_PHONE = '13700004223';
const FOREIGN_OWNER_PHONE = '13700004224';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 未设置：B6 browser e2e 需要 PostgreSQL。');

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
  if (!(await forced)) throw new Error('B6 e2e server process group did not exit');
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE_URL}/api/v1/admin/check-runs`)).status === 401) return; } catch {}
    await sleep(300);
  }
  throw new Error(`B6 server 未就绪\n${serverLog.slice(-5000)}`);
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
      NODE_ENV: 'development', SMS_CHANNEL: 'log',
      BETTER_AUTH_SECRET: 'b6-e2e-only-secret-at-least-thirty-two-characters', BETTER_AUTH_URL: BASE_URL,
      ALIBABA_CLOUD_ACCESS_KEY_ID: 'b6-unused', ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'b6-unused-secret',
      ALIBABA_CLOUD_OSS_BUCKET: 'b6-unused-bucket', ALIBABA_CLOUD_OSS_ENDPOINT: 'oss-cn-hangzhou.aliyuncs.com',
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

test('ordinary user is forbidden; admin reviews; owner sees rejection and resubmits', async () => {
  const anonymous = await fetch(`${BASE_URL}/api/v1/admin/check-runs`);
  assert.equal(anonymous.status, 401);

  const ownerContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, recordVideo: { dir: EVIDENCE_DIR, size: { width: 390, height: 844 } } });
  const operatorContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const reviewerContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: EVIDENCE_DIR, size: { width: 1280, height: 900 } } });
  const foreignOwnerContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const ownerPage = await ownerContext.newPage();
  const operatorPage = await operatorContext.newPage();
  const reviewerPage = await reviewerContext.newPage();
  const foreignOwnerPage = await foreignOwnerContext.newPage();
  try {
    await login(ownerPage, OWNER_PHONE);
    await ownerPage.goto(`${BASE_URL}/requests`);
    await ownerPage.getByLabel('联系人').fill('B6 浏览器申请人');
    await ownerPage.getByLabel('联系电话').fill('13800138000');
    await ownerPage.getByLabel('使用说明').fill('给成年仓鼠日常休息，等待人工可信审核。');
    await ownerPage.getByLabel(/补充要求/).fill('入口必须圆润。');
    await ownerPage.getByRole('button', { name: '提交申请' }).click();
    await ownerPage.getByText('B6 浏览器申请人 · 13800138000').waitFor();
    const ownerRequests = await browserApi(ownerPage, '/api/v1/commerce/customization-requests');
    assert.equal(ownerRequests.status, 200);
    const requestId = ownerRequests.body.requests.find((request) => request.contactName === 'B6 浏览器申请人').id;

    await login(reviewerPage, REVIEWER_PHONE);
    const forbidden = await browserApi(reviewerPage, '/api/v1/admin/check-runs');
    assert.equal(forbidden.status, 403);
    const reviewerMe = await browserApi(reviewerPage, '/api/me');
    assert.equal(reviewerMe.status, 200);

    const existingOperator = await prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' } });
    if (existingOperator) {
      await prisma.user.update({
        where: { id: existingOperator.id },
        data: { phoneNumber: `+86${OPERATOR_PHONE}`, phoneNumberVerified: true },
      });
    } else {
      await login(operatorPage, OPERATOR_PHONE);
      const operatorMe = await browserApi(operatorPage, '/api/me');
      assert.equal(operatorMe.status, 200);
      await bootstrapFirstAdmin({
        prisma,
        targetUserId: operatorMe.body.userId,
        reason: 'B6 CI bootstrap operator for browser QA',
      });
    }
    if (operatorPage.url() === 'about:blank') await login(operatorPage, OPERATOR_PHONE);
    const roleGrant = await browserApi(operatorPage, `/api/v1/admin/users/${reviewerMe.body.userId}/role`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'admin', expectedRole: 'user', reason: 'B6 browser QA reviewer grant' }),
    });
    assert.equal(roleGrant.status, 200);
    assert.equal(roleGrant.body.role, 'admin');

    await reviewerPage.goto(`${BASE_URL}/admin/reviews`);
    const card = reviewerPage.locator('article').filter({ hasText: '给成年仓鼠日常休息，等待人工可信审核。' });
    await card.getByRole('button', { name: '加入审核队列' }).click();
    await card.getByRole('button', { name: '认领并开始审核' }).click();
    await card.getByLabel('结论').waitFor();
    const observerCandidates = await browserApi(operatorPage, '/api/v1/admin/check-runs');
    assert.equal(observerCandidates.status, 200);
    const observed = observerCandidates.body.candidates.find((candidate) => candidate.request.customizationRequestId === requestId);
    assert.equal(observed.checkRun.status, 'in_review');
    assert.equal(observed.canComplete, false);
    await operatorPage.goto(`${BASE_URL}/admin/reviews`);
    const observerCard = operatorPage.locator('article').filter({ hasText: '给成年仓鼠日常休息，等待人工可信审核。' });
    await observerCard.waitFor();
    assert.equal(await observerCard.getByRole('button', { name: '完成沙箱审核' }).count(), 0);
    await card.getByLabel('结论').selectOption('rejected');
    await card.getByLabel(/发现的问题/).fill('入口边缘过薄');
    await card.getByLabel('证据摘要').fill('沙箱人工目视检查记录');
    await card.getByLabel(/调整建议/).fill('入口边缘加厚 2mm');
    await card.getByLabel('审核说明').fill('仅沙箱审核，不代表真实制造结论。');
    await card.getByRole('button', { name: '完成沙箱审核' }).click();
    await card.getByText('拒绝', { exact: true }).waitFor();
    await card.screenshot({ path: `${EVIDENCE_DIR}/b6-admin-rejected.png` });

    await ownerPage.reload();
    const rejectedRequestCard = ownerPage.locator('article').filter({ hasText: '给成年仓鼠日常休息，等待人工可信审核。' });
    await rejectedRequestCard.getByText('已提交', { exact: true }).waitFor();
    await rejectedRequestCard.getByText('审核未通过', { exact: true }).waitFor();
    await rejectedRequestCard.getByText('调整建议：入口边缘加厚 2mm', { exact: true }).waitFor();
    await ownerPage.waitForTimeout(1_000);
    await ownerPage.screenshot({ path: `${EVIDENCE_DIR}/b6-owner-review-result.png`, fullPage: true });
    await rejectedRequestCard.getByRole('button', { name: '修改并重提' }).click();
    await ownerPage.getByRole('status').getByText('正在基于旧申请创建新版本；旧内容仍会留在历史里。', { exact: true }).waitFor();
    await ownerPage.getByRole('button', { name: '取消重提' }).waitFor();
    await ownerPage.getByLabel('使用说明').fill('按审核建议调整后重新提交。');
    await ownerPage.getByRole('button', { name: '提交新版本' }).click();
    await rejectedRequestCard.getByText('已被新版本替代', { exact: true }).waitFor();
    await rejectedRequestCard.getByText('旧内容已保留', { exact: true }).waitFor();
    const resubmittedRequestCard = ownerPage.locator('article').filter({ hasText: '按审核建议调整后重新提交。' });
    await resubmittedRequestCard.getByText('已提交', { exact: true }).waitFor();
    await resubmittedRequestCard.getByText('等待审核', { exact: true }).waitFor();

    const audits = await prisma.roleChangeAudit.findMany({ where: { targetUserId: reviewerMe.body.userId } });
    assert.equal(audits.length, 1);
    assert.equal(audits[0].source, 'admin_api');
    assert.notEqual(audits[0].actorUserId, reviewerMe.body.userId);
    const ownerRuns = await browserApi(ownerPage, '/api/v1/commerce/check-runs');
    assert.equal(ownerRuns.status, 200);
    assert.equal(ownerRuns.body.checkRuns.some((run) => run.result === 'rejected'), true);

    await login(foreignOwnerPage, FOREIGN_OWNER_PHONE);
    const foreignRuns = await browserApi(foreignOwnerPage, '/api/v1/commerce/check-runs');
    assert.equal(foreignRuns.status, 200);
    assert.deepEqual(foreignRuns.body.checkRuns, []);
    const foreignRequest = await browserApi(foreignOwnerPage, `/api/v1/commerce/customization-requests/${requestId}`);
    assert.equal(foreignRequest.status, 404);
  } finally {
    await ownerContext.close();
    await operatorContext.close();
    await reviewerContext.close();
    await foreignOwnerContext.close();
  }
});
