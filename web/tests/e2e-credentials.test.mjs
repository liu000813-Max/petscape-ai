// web/tests/e2e-credentials.test.mjs —— WP-A3-2 邮箱 OTP 登录 + 双向凭证绑定端到端。
//
// 起真实 next dev（SMS_CHANNEL=log + MAIL_CHANNEL=log，DB 指向调用方注入的一次性 Postgres）→
// headless Chromium 走三条闭环：
//   ① 邮箱注册→登录闭环（新邮箱建号 → 落 /account → 展示脱敏邮箱）；
//   ② 手机号注册→账户页绑定邮箱→（不退出即时展示新邮箱）→退出→邮箱登录→断言同一 User.id；
//   ③ 邮箱注册→账户页绑定手机号→（不退出即时展示新手机号）→退出→手机号登录→断言同一 User.id。
// 验证码从 dev server stdout 抓（[SMS:log] / [MAIL:log] OTP for <target> => <code>）。
//
// 前置：调用方先起 Postgres（本地容器或隧道）+ prisma migrate deploy，DATABASE_URL 传入。
// 缺 DATABASE_URL 直接失败（与 packages/server CI 纪律一致，不静默 skip）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import pg from 'pg';

const webRoot = fileURLToPath(new URL('../', import.meta.url));
const PORT = process.env.E2E_CRED_PORT ?? '3412';
const BASE_URL = `http://127.0.0.1:${PORT}`;

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL 未设置：e2e-credentials 测试需要一个已跑过 prisma migrate deploy 的 Postgres，不静默 skip。',
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
      // not listening yet
    }
    await sleep(300);
  }
  throw new Error(`dev server 在 ${timeoutMs}ms 内未就绪\n${serverLog.slice(-4000)}`);
}

function extractLatestOtp(target) {
  const lines = serverLog
    .split('\n')
    .filter((l) => /\[(?:SMS|MAIL):log\] OTP for/.test(l) && l.includes(target));
  const last = lines.at(-1);
  if (!last) return null;
  const m = last.match(/=>\s*(\d+)\s*$/);
  return m ? m[1] : null;
}

async function waitForOtp(target, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const code = extractLatestOtp(target);
    if (code) return code;
    await sleep(200);
  }
  throw new Error(`在 ${timeoutMs}ms 内未捕获 ${target} 的验证码\n${serverLog.slice(-3000)}`);
}

/** 从 /account 页读取 User.id（脚注 "ID · <id>"）。 */
async function readAccountUserId(page) {
  const body = await page.textContent('body');
  const m = /ID\s*·\s*(\S+)/.exec(body ?? '');
  assert.ok(m, `账户页应含 "ID · <id>" 脚注，实际 body 片段：${(body ?? '').slice(0, 200)}`);
  return m[1];
}

/** 邮箱登录/注册：/login 切邮箱 → 填邮箱 → 发码 → 抓码 → 填码 → 落 /account。 */
async function emailLogin(page, email) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByRole('button', { name: '邮箱登录' }).click();
  await page.getByLabel('邮箱').fill(email);
  await page.getByRole('button', { name: '获取验证码' }).click();
  await page.getByLabel('验证码').waitFor({ state: 'visible', timeout: 10_000 });
  const code = await waitForOtp(email);
  await page.getByLabel('验证码').fill(code);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL(`${BASE_URL}/account`, { timeout: 10_000 });
}

/** 手机号登录/注册：/login 手机号 → 发码 → 抓码 → 填码 → 落 /account。 */
async function phoneLogin(page, phone) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel('手机号').fill(phone);
  await page.getByRole('button', { name: '获取验证码' }).click();
  await page.getByLabel('验证码').waitFor({ state: 'visible', timeout: 10_000 });
  const code = await waitForOtp(`+86${phone}`);
  await page.getByLabel('验证码').fill(code);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL(`${BASE_URL}/account`, { timeout: 10_000 });
}

async function signOut(page) {
  await page.getByRole('button', { name: '退出登录' }).click();
  await page.waitForURL(`${BASE_URL}/login`, { timeout: 10_000 });
}

/**
 * 清掉某目标的发送节流记录：绑定与随后立即用同一凭证登录会撞 60s 冷却
 * （节流对同一 target 跨端点聚合），e2e 里手动清账绕过，不改产品语义
 * （真实用户不会在 60s 内既绑定又重新登录同一凭证）。
 */
async function clearThrottle(target) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('DELETE FROM otp_send_record WHERE target = $1', [target]);
  } finally {
    await client.end();
  }
}

test.before(async () => {
  // Next dev 只在 web/ 内查找 .env*，本仓库 .env 在仓库根（web/ 上一级），
  // 因此显式把根 .env 载入本进程 env 再透传给 dev server（需要 BETTER_AUTH_SECRET
  // 等身份键；DATABASE_URL 由调用方注入，优先于文件值）。
  const injectedDbUrl = process.env.DATABASE_URL; // 调用方注入的一次性 PG，优先级最高
  const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
  try {
    process.loadEnvFile(rootEnv);
  } catch {
    // 根 .env 不存在时（CI 用环境变量注入）忽略。
  }
  if (injectedDbUrl) process.env.DATABASE_URL = injectedDbUrl; // 不让 .env 里的 RDS 串覆盖测试 PG
  serverProcess = spawn('pnpm', ['exec', 'next', 'dev', '-H', '127.0.0.1', '-p', PORT], {
    cwd: webRoot,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      SMS_CHANNEL: 'log',
      MAIL_CHANNEL: 'log',
      BETTER_AUTH_URL: BASE_URL,
      PORT,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout.on('data', (c) => (serverLog += c.toString()));
  serverProcess.stderr.on('data', (c) => (serverLog += c.toString()));
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

// 唯一化前缀，避免与并发/历史数据撞号。
const tag = `e2ec${Date.now().toString().slice(-8)}`;

test('① 邮箱注册→登录闭环：新邮箱建号并落账户页', async () => {
  const page = await browser.newPage();
  try {
    const email = `${tag}-loop@e2e.local`;
    await emailLogin(page, email);
    const body = await page.textContent('body');
    // 账户页邮箱行应显示已绑定（脱敏形式含域名）。
    assert.match(body ?? '', /@e2e\.local/, '账户页应展示已绑定邮箱域名');
    assert.match(body ?? '', /已绑定/, '账户页邮箱行应标记已绑定');
  } finally {
    await page.close();
  }
});

test('② 手机号注册→绑定邮箱→即时展示→退出→邮箱登录→同一 User.id', async () => {
  const page = await browser.newPage();
  try {
    const phone = `139${tag.slice(-8)}`.slice(0, 11).padEnd(11, '0');
    await phoneLogin(page, phone);
    const idBefore = await readAccountUserId(page);

    // 账户页绑定邮箱（两步流）。
    const email = `${tag}-bind@e2e.local`;
    await page.locator('[data-bind-kind="email"] >> text=绑定邮箱').click();
    await page.getByLabel('绑定邮箱').fill(email);
    await page.locator('[data-bind-kind="email"]').getByRole('button', { name: '获取验证码' }).click();
    await page.getByLabel('绑定邮箱验证码').waitFor({ state: 'visible', timeout: 10_000 });
    const code = await waitForOtp(email);
    await page.getByLabel('绑定邮箱验证码').fill(code);
    await page.getByRole('button', { name: '确认绑定邮箱' }).click();

    // 即时会话断言：绑定成功后不退出，当前 session 的账户页立即展示新邮箱。
    await page.waitForSelector('text=@e2e.local', { timeout: 10_000 });
    const bodyAfterBind = await page.textContent('body');
    assert.match(bodyAfterBind ?? '', /@e2e\.local/, '绑定后当前 session 账户页应立即展示新邮箱');
    assert.equal(await readAccountUserId(page), idBefore, '绑定邮箱后 User.id 不应改变');

    // 退出 → 用刚绑定的邮箱登录 → 断言同一 User.id。
    await signOut(page);
    await clearThrottle(email); // 绕过绑定发码与重新登录发码之间的 60s 冷却
    await emailLogin(page, email);
    assert.equal(await readAccountUserId(page), idBefore, '邮箱登录应落在同一 User.id（双向绑定同账户）');
  } finally {
    await page.close();
  }
});

test('③ 邮箱注册→绑定手机号→即时展示→退出→手机号登录→同一 User.id', async () => {
  const page = await browser.newPage();
  try {
    const email = `${tag}-e3@e2e.local`;
    await emailLogin(page, email);
    const idBefore = await readAccountUserId(page);

    const phone = `138${tag.slice(-8)}`.slice(0, 11).padEnd(11, '0');
    await page.locator('[data-bind-kind="phone"] >> text=绑定手机号').click();
    await page.getByLabel('绑定手机号').fill(phone);
    await page.locator('[data-bind-kind="phone"]').getByRole('button', { name: '获取验证码' }).click();
    await page.getByLabel('绑定手机号验证码').waitFor({ state: 'visible', timeout: 10_000 });
    const code = await waitForOtp(`+86${phone}`);
    await page.getByLabel('绑定手机号验证码').fill(code);
    await page.getByRole('button', { name: '确认绑定手机号' }).click();

    // 即时会话断言：绑定成功后不退出，账户页立即展示脱敏手机号。
    const masked = `${phone.slice(0, 3)}****${phone.slice(7)}`;
    await page.waitForSelector(`text=${masked}`, { timeout: 10_000 });
    assert.equal(await readAccountUserId(page), idBefore, '绑定手机号后 User.id 不应改变');

    await signOut(page);
    await clearThrottle(`+86${phone}`); // 绕过绑定发码与重新登录发码之间的 60s 冷却
    await phoneLogin(page, phone);
    assert.equal(await readAccountUserId(page), idBefore, '手机号登录应落在同一 User.id（双向绑定同账户）');
  } finally {
    await page.close();
  }
});
