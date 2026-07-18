// web/tests/e2e-login.test.mjs —— WP-A2 手机号 OTP 登录闭环端到端测试。
//
// 起一个真实 `next dev`（SMS_CHANNEL=log，DB 指向调用方注入的一次性 Postgres）→
// headless Chromium 打开 /login → 填手机号 → 点获取验证码 → 从 dev server
// stdout 抓验证码（log 通道行 `[SMS:log] OTP for <phone> => <code>`）→ 填码提交 →
// 断言落在 /account 且含脱敏手机号 → 点退出 → 断言回 /login。
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
const PORT = process.env.E2E_LOGIN_PORT ?? '3411';
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PHONE = '13800001234';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL 未设置：e2e-login 测试需要一个已跑过 prisma migrate deploy 的 Postgres（本地容器或 SSH 隧道），不静默 skip。',
  );
}

let serverProcess;
let serverLog = '';
let browser;

async function waitForServerReady(timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/api/me`);
      if (res.status === 401 || res.status === 200) return;
    } catch {
      // 服务器尚未监听，继续轮询。
    }
    await sleep(300);
  }
  throw new Error(`dev server 在 ${timeoutMs}ms 内未就绪（累计日志见下）\n${serverLog.slice(-4000)}`);
}

function extractLatestOtp(phone) {
  const lines = serverLog.split('\n').filter((l) => l.includes('[SMS:log] OTP for') && l.includes(phone));
  const last = lines.at(-1);
  if (!last) return null;
  const m = last.match(/=>\s*(\d+)\s*$/);
  return m ? m[1] : null;
}

async function waitForOtp(phone, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const code = extractLatestOtp(phone);
    if (code) return code;
    await sleep(200);
  }
  throw new Error(`在 ${timeoutMs}ms 内未从 dev server 日志中捕获到手机号 ${phone} 的验证码\n${serverLog.slice(-4000)}`);
}

test.before(async () => {
  serverProcess = spawn('pnpm', ['exec', 'next', 'dev', '-H', '127.0.0.1', '-p', PORT], {
    cwd: webRoot,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      SMS_CHANNEL: 'log',
      // Better Auth 的 sign-out（cookie 鉴权请求）会校验 Origin 是否匹配
      // trustedOrigins（默认即 baseURL）；根 .env 未设置 BETTER_AUTH_URL 时
      // Better Auth 回落到 http://localhost:3000，与本测试实际监听的
      // 127.0.0.1:${PORT} 不符，会让已登录态的写操作全部 403 INVALID_ORIGIN。
      // 这里为测试进程显式传入，不改 packages/server 或根 .env。
      BETTER_AUTH_URL: BASE_URL,
      PORT,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout.on('data', (chunk) => {
    serverLog += chunk.toString();
  });
  serverProcess.stderr.on('data', (chunk) => {
    serverLog += chunk.toString();
  });

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

test('unauthenticated GET /api/me returns 401', async () => {
  const res = await fetch(`${BASE_URL}/api/me`);
  assert.equal(res.status, 401);
});

test('unauthenticated GET /account redirects to /login (307)', async () => {
  const res = await fetch(`${BASE_URL}/account`, { redirect: 'manual' });
  assert.equal(res.status, 307);
  assert.match(res.headers.get('location') ?? '', /\/login$/);
});

test('phone OTP login closes the loop: send code -> verify -> /account -> sign out -> /login', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${BASE_URL}/login`);

    await page.getByLabel('手机号').fill(PHONE);
    await page.getByRole('button', { name: '获取验证码' }).click();

    // 验证码步骤 UI 出现（60s 重发倒计时按钮进入禁用态）。
    const resendButton = page.getByRole('button', { name: /重新发送/ });
    await resendButton.waitFor({ state: 'visible', timeout: 10_000 });
    await assert.doesNotReject(async () => {
      const disabled = await resendButton.isDisabled();
      if (!disabled) throw new Error('刚发送验证码后重发按钮应处于倒计时禁用态');
    });

    const code = await waitForOtp(PHONE);

    await page.getByLabel('短信验证码').fill(code);
    await page.getByRole('button', { name: '登录' }).click();

    await page.waitForURL(`${BASE_URL}/account`, { timeout: 10_000 });

    const bodyText = await page.textContent('body');
    assert.match(bodyText ?? '', /138\*\*\*\*1234/, '账户页应显示脱敏手机号 138****1234');

    await page.getByRole('button', { name: '退出登录' }).click();
    await page.waitForURL(`${BASE_URL}/login`, { timeout: 10_000 });
  } finally {
    await page.close();
  }
});

test('wrong OTP shows inline error, not a browser alert', async () => {
  const page = await browser.newPage();
  let dialogFired = false;
  page.on('dialog', async (dialog) => {
    dialogFired = true;
    await dialog.dismiss();
  });

  try {
    const otherPhone = '13900005678';
    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel('手机号').fill(otherPhone);
    await page.getByRole('button', { name: '获取验证码' }).click();
    await page.getByLabel('短信验证码').waitFor({ state: 'visible', timeout: 10_000 });

    // 等真实验证码落地日志后再确保输入的是错误码（避免偶发撞对）。
    await waitForOtp(otherPhone);
    await page.getByLabel('短信验证码').fill('000000');
    await page.getByRole('button', { name: '登录' }).click();

    await page.waitForSelector('text=/验证码.*(错误|无效|不正确)/', { timeout: 10_000 });
    assert.equal(dialogFired, false, '错误提示应为内联文案，不应触发浏览器 alert');
    assert.equal(page.url(), `${BASE_URL}/login`, '校验失败不应跳转');
  } finally {
    await page.close();
  }
});
