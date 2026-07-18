// packages/server/tests/auth.integration.test.mjs
// spec: docs/plans/phase-b-execution-plan.md WP-3.1 验收 1/3：
//   - 真实 RDS 上 OTP 登录闭环：send-otp（SMS_CHANNEL=log）→ verify → 受保护路由 200，
//     无 session 401；
//   - migration 后 User 与 credential 表关系符合 ADR-0004（手机号换绑不改 User.id）。
//
// 无 DATABASE_URL 时本地显式 skip、CI 里直接报错（CI 由 service container 提供一次性
// PostgreSQL 真跑，见 .github/workflows/ci.yml 与 db.integration.test.mjs 的先例）。
// 本地/演练机跑法：先建 SSH 隧道到 RDS，导出 DATABASE_URL 指向 localhost 转发端口，
// 再执行 `pnpm test`（同 db.integration.test.mjs 的编排约定）。
//
// OTP 提取：本测试不经 Next.js Route Handler（那只是薄 `toNextJsHandler` 包装），
// 直接调用 auth.handler（Better Auth 的 Fetch API 标准 handler，同一段逻辑），
// 并劫持 console.log 捕获 infra/sms 的 log 通道输出（"[SMS:log] OTP for X => code"），
// 做法对应 tracer 的 login-loop.mjs（该版本是从服务器日志文件里读，这里直接劫持
// 进程内 console.log，因为测试与 handler 同进程运行，无需过日志文件这一层）。
//
// Better Auth CSRF：需要在请求头带 Origin，否则 send-otp 返回 403
// MISSING_OR_NULL_ORIGIN（tracer README 踩坑 4，本测试同样处理）。

import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  if (process.env.CI) {
    // 同 db.integration.test.mjs：CI 缺 DATABASE_URL = 门禁静默失效，炸而不是跳过。
    throw new Error(
      'CI 缺少 DATABASE_URL：集成测试静默全 skip 意味着门禁失效，检查 ci.yml 的 postgres service 与 env 注入。'
    );
  }
  test('auth.integration.test.mjs skipped: DATABASE_URL not set (本地需 SSH 隧道连 RDS)', (t) => {
    t.skip('DATABASE_URL 未设置——本机需先建立到 RDS 的 SSH 隧道并导出 DATABASE_URL 才能跑此集成测试（CI 由一次性 PostgreSQL service container 提供，见 .github/workflows/ci.yml）。');
  });
} else {
  const { createPrismaClient } = await import('../src/infra/db/index.ts');
  const { createAuth } = await import('../src/infra/auth/index.ts');

  const baseURL = 'http://localhost:3100';
  const prisma = createPrismaClient({ connectionString: databaseUrl, poolMax: 5 });

  const auth = createAuth({
    prisma,
    secret: 'wp-3-1-integration-test-secret-not-for-prod',
    baseURL,
    smsChannel: 'log',
  });

  test.after(async () => {
    // 清理本测试文件创建的 User（及级联的 Session/Account），避免真实 RDS 残留脏数据。
    // 前缀专属本文件（+861380099），避免与其他并发测试/脚本使用的 +8613800 号段
    // 撞前缀导致误删他人数据（WP-3.2 报告遗留问题，本次一并修复）。
    await prisma.user.deleteMany({ where: { phoneNumber: { startsWith: '+861380099' } } });
    await prisma.$disconnect();
  });

  /** 劫持 console.log，从 infra/sms 的 log 通道输出中提取最近一次 OTP。 */
  async function captureOtp(fn) {
    const original = console.log;
    let captured;
    console.log = (...args) => {
      const line = args.join(' ');
      const m = line.match(/\[SMS:log\] OTP for (\S+) => (\S+)/);
      if (m) captured = { phone: m[1], code: m[2] };
      original(...args);
    };
    try {
      await fn();
    } finally {
      console.log = original;
    }
    if (!captured) throw new Error('未能从 log 通道捕获 OTP');
    return captured;
  }

  function extractSetCookies(res) {
    const raw = res.headers.getSetCookie?.() ?? [];
    return raw.map((c) => c.split(';')[0]);
  }

  test('OTP 登录闭环：send-otp(log) → verify → 受保护语义（有 session 200 / 无 session 401）', async () => {
    const phone = `+861380099${Date.now().toString().slice(-6)}`;

    // 1. send-otp
    const { code } = await captureOtp(async () => {
      const res = await auth.handler(
        new Request(`${baseURL}/api/auth/phone-number/send-otp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: baseURL },
          body: JSON.stringify({ phoneNumber: phone }),
        }),
      );
      assert.equal(res.status, 200, `send-otp 应返回 200，实际 ${res.status}: ${await res.text()}`);
    });
    assert.ok(code, 'log 通道应捕获到验证码');

    // 2. verify -> 建立 session（Set-Cookie）
    const verifyRes = await auth.handler(
      new Request(`${baseURL}/api/auth/phone-number/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: baseURL },
        body: JSON.stringify({ phoneNumber: phone, code }),
      }),
    );
    assert.equal(verifyRes.status, 200, `verify 应返回 200，实际 ${verifyRes.status}: ${await verifyRes.text()}`);
    const cookies = extractSetCookies(verifyRes);
    assert.ok(cookies.length > 0, 'verify 成功应下发至少一个 Session Cookie');
    const cookieHeader = cookies.join('; ');

    // 3a. 受保护语义：带 Session Cookie -> getSession 应返回该用户
    const authedSession = await auth.api.getSession({
      headers: new Headers({ cookie: cookieHeader }),
    });
    assert.ok(authedSession, '带有效 Session Cookie 应能查到 session');
    assert.ok(authedSession.user.id, 'session 应携带稳定的 User.id');
    assert.equal(authedSession.user.phoneNumber, phone);

    // 3b. 受保护语义：无 Session -> getSession 返回 null（对应 Route Handler 的 401 分支）
    const anonSession = await auth.api.getSession({ headers: new Headers() });
    assert.equal(anonSession, null, '无 Session Cookie 时 getSession 应返回 null（Route Handler 据此返回 401）');
  });

  test('ADR-0004：手机号换绑（更新 User.phoneNumber）不改变 User.id', async () => {
    const originalPhone = `+861380099${Date.now().toString().slice(-6)}1`;
    const newPhone = `+861380099${Date.now().toString().slice(-6)}2`;

    const { code } = await captureOtp(async () => {
      const res = await auth.handler(
        new Request(`${baseURL}/api/auth/phone-number/send-otp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: baseURL },
          body: JSON.stringify({ phoneNumber: originalPhone }),
        }),
      );
      assert.equal(res.status, 200);
    });

    const verifyRes = await auth.handler(
      new Request(`${baseURL}/api/auth/phone-number/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: baseURL },
        body: JSON.stringify({ phoneNumber: originalPhone, code }),
      }),
    );
    assert.equal(verifyRes.status, 200);
    const cookieHeader = extractSetCookies(verifyRes).join('; ');

    const sessionBefore = await auth.api.getSession({ headers: new Headers({ cookie: cookieHeader }) });
    assert.ok(sessionBefore, '换绑前应能查到 session');
    const userId = sessionBefore.user.id;

    // 直接以 repository 层面更新 phoneNumber，模拟"换绑"（本包验收范围内不实现换绑
    // 用例 UI/API，只验证数据模型层面 User.id 不随 phoneNumber 变化——ADR-0004
    // "手机号是可验证、可换绑的 credential，不是 User 主键"）。
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { phoneNumber: newPhone, phoneNumberVerified: true },
    });

    assert.equal(updated.id, userId, '换绑手机号后 User.id 必须保持不变');
    assert.equal(updated.phoneNumber, newPhone);

    const reloaded = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    assert.equal(reloaded.id, userId);
    assert.equal(reloaded.phoneNumber, newPhone);
  });
}
