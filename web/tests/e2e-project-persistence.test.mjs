// web/tests/e2e-project-persistence.test.mjs —— WP-G1 项目持久化。
//
// spec: docs/plans/g-line-execution-plan.md WP-G1。
// 覆盖：
//   1. v1 项目归属越权返回 404（GET /api/v1/projects/:id，spec 点名的既有口径，此前无专门测试）。
//   2. landing 数据源行为：已登录建项目 → kill 真实 dev server 进程 → 重启 →
//      同一 ?project= URL 恢复出同一项目（进程重启不丢项目，走 v1 而非内存 store）。
//   3. 未登录进入生成流程（landing 首屏）被引导登录，不静默建立匿名项目。
//
// 前置：调用方需先起一个 Postgres（本地容器或 SSH 隧道到 RDS 均可）并跑
// `prisma migrate deploy`，再通过 DATABASE_URL 环境变量传入本测试进程。
// 缺 DATABASE_URL 时测试直接失败（不静默 skip——与 packages/server CI 纪律一致）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const webRoot = fileURLToPath(new URL('../', import.meta.url));
const PORT = process.env.E2E_PROJECT_PERSISTENCE_PORT ?? '3415';
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PHONE_OWNER = '13700005131';
const PHONE_FOREIGN = '13700005132';
const PHONE_PERSISTENCE = '13700005133';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL 未设置：e2e-project-persistence 测试需要一个已跑过 prisma migrate deploy 的 Postgres（本地容器或 SSH 隧道），不静默 skip。',
  );
}

let serverProcess;
let serverLog = '';
let browser;

function spawnServer() {
  const child = spawn('pnpm', ['exec', 'next', 'dev', '--webpack', '-H', '127.0.0.1', '-p', PORT], {
    cwd: webRoot,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      WATCHPACK_POLLING: 'true',
      SMS_CHANNEL: 'log',
      BETTER_AUTH_SECRET: 'g1-e2e-only-secret-at-least-thirty-two-characters',
      BETTER_AUTH_URL: BASE_URL,
      ALIBABA_CLOUD_ACCESS_KEY_ID: 'g1-e2e-unused-access-key',
      ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'g1-e2e-unused-access-secret',
      ALIBABA_CLOUD_OSS_BUCKET: 'g1-e2e-unused-bucket',
      ALIBABA_CLOUD_OSS_ENDPOINT: 'oss-cn-hangzhou.aliyuncs.com',
      ALIBABA_CLOUD_REGION: 'cn-hangzhou',
      PORT,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
  child.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });
  return child;
}

async function waitForServerReady(timeoutMs = 90_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${BASE_URL}/api/v1/projects`);
      if (response.status === 401) break;
    } catch {
      // 继续轮询。
    }
    await sleep(300);
  }
  if (Date.now() - startedAt >= timeoutMs) {
    throw new Error(`Project persistence e2e server 未就绪\n${serverLog.slice(-5000)}`);
  }
  // 预热首个页面编译（next dev webpack 首次访问 /login 常需数秒~十余秒），
  // 避免后续 login() 里的 page.goto 撞上编译期默认超时。
  await fetch(`${BASE_URL}/login`).catch(() => undefined);
  await fetch(`${BASE_URL}/`).catch(() => undefined);
}

async function killServer() {
  if (!serverProcess || serverProcess.killed) return;
  serverProcess.kill('SIGTERM');
  await sleep(500);
  if (!serverProcess.killed) serverProcess.kill('SIGKILL');
  await sleep(300);
}

async function waitForOtp(phone, afterIndex, timeoutMs = 30_000) {
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
  await page.goto(`${BASE_URL}/login`, { timeout: 60_000 });
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
  serverProcess = spawnServer();
  await waitForServerReady();
  browser = process.env.PLAYWRIGHT_WS_ENDPOINT
    ? await chromium.connect(process.env.PLAYWRIGHT_WS_ENDPOINT)
    : await chromium.launch();
});

test.after(async () => {
  await browser?.close();
  await killServer();
});

test('v1 项目归属越权返回 404（GET /api/v1/projects/:id）', async () => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  try {
    await login(pageA, PHONE_OWNER);
    const created = await browserApi(pageA, '/api/v1/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'A 的项目' }),
    });
    assert.equal(created.status, 201);

    await login(pageB, PHONE_FOREIGN);
    const foreign = await browserApi(pageB, `/api/v1/projects/${created.body.id}`);
    assert.equal(foreign.status, 404, 'B 访问 A 的项目应 404');
    assert.equal(foreign.body.error, 'not_found');

    const anonymous = await fetch(`${BASE_URL}/api/v1/projects/${created.body.id}`);
    assert.equal(anonymous.status, 401, '未登录访问应 401（不是 404，不泄漏资源是否存在）');
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('landing 建项目走 v1 且进程重启不丢：?project= URL 重启后仍能恢复同一项目', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await login(page, PHONE_PERSISTENCE);
    await page.goto(`${BASE_URL}/`, { timeout: 60_000 });

    // landing 首次挂载后应已把新建的 v1 project id 写回 URL（?project=<cuid>）。
    await page.waitForFunction(() => new URLSearchParams(window.location.search).has('project'), null, {
      timeout: 15_000,
    });
    const projectId = await page.evaluate(() => new URLSearchParams(window.location.search).get('project'));
    assert.ok(projectId, 'landing 应在 URL 写入新建的项目 id');

    // 项目必须真的经 v1 API 落库（不是内存 store 的 uuid）：直接查 v1 详情应 200。
    const viaV1 = await browserApi(page, `/api/v1/projects/${projectId}`);
    assert.equal(viaV1.status, 200, '?project= 写回的 id 应能通过 v1 详情接口读取');
    assert.equal(viaV1.body.id, projectId);

    // 进程重启（模拟服务重新部署）：内存 store 会丢失所有状态，v1 数据库不会。
    // 旧 page/context 上仍有 landing 各子组件的轮询定时器与挂起连接，杀服务器后
    // 这些连接的中止/重连会拖慢同一 page 上的后续导航——用全新 context/page 验证
    // 「重启后能恢复」这件事本身，避免测试脚手架的噪音混进红绿判定。
    await context.close();
    await killServer();
    serverProcess = spawnServer();
    await waitForServerReady();

    // 用同一 URL、全新浏览器上下文重新进入：应恢复到同一项目 id，而不是静默新建一个。
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    try {
      await freshPage.goto(`${BASE_URL}/?project=${projectId}`, { timeout: 60_000 });
      await freshPage.waitForFunction(
        (expected) => new URLSearchParams(window.location.search).get('project') === expected,
        projectId,
        { timeout: 15_000 },
      );
      const restoredId = await freshPage.evaluate(() => new URLSearchParams(window.location.search).get('project'));
      assert.equal(restoredId, projectId, '重启后同一 URL 应恢复同一项目，而非新建');
    } finally {
      await freshContext.close();
    }
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
});

test('未登录访问 landing：不静默建立项目，生成流程入口引导登录', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const projectCreationRequests = [];
  page.on('request', (request) => {
    const method = request.method();
    const url = request.url();
    if (method === 'POST' && (url.endsWith('/api/project') || url.endsWith('/api/v1/projects'))) {
      projectCreationRequests.push(url);
    }
  });
  try {
    await page.goto(`${BASE_URL}/`);
    await page.waitForTimeout(1500); // 给 boot() 足够时间跑完（若会误建项目，此处能捕获到）。

    assert.deepEqual(
      projectCreationRequests,
      [],
      `未登录不应触发任何项目创建请求，实际捕获：${JSON.stringify(projectCreationRequests)}`,
    );

    const projectParam = await page.evaluate(() => new URLSearchParams(window.location.search).get('project'));
    assert.equal(projectParam, null, '未登录不应在 URL 写入项目 id');

    // 生成流程入口（宠物档案创建区）应出现「登录后继续」类引导 CTA，指向 /login。
    const creatorSection = page.locator('.pet-creator-section');
    await creatorSection.scrollIntoViewIfNeeded();
    const authGate = creatorSection.getByRole('link', { name: /登录/ });
    await authGate.waitFor({ timeout: 5000 });
  } finally {
    await context.close();
  }
});
