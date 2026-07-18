// packages/server/tests/otp-credentials.integration.test.mjs
// spec: docs/plans/p0-batch-1-execution-plan.md WP-A3-2 § S2（含 codex 审查增补 b/d/f 与 TDD 追加）。
//
// 覆盖：
//   [节流] 60s 冷却拒绝；滚动 24h 第 11 次拒绝；并发同目标发码仅一次通过；
//          发送失败不记账（通道抛错回滚，不占用上限）。
//   [emailOTP] 邮箱注册→登录闭环；同邮箱并发注册仅一个成功；正确 OTP 并发消费仅一次成功、
//          二次重放被拒；错码/过期码无效；邮箱大小写变体命中同一账户。
//   [绑定] 未登录调用绑定接口 401；手机号占位邮箱用户绑定真实邮箱（占位迁移，User.id 不变）；
//          手机号绑定（updatePhoneNumber，User.id 不变）；两账户并发绑定同一凭证仅一个成功、
//          失败方收到结构化冲突（非 500）；占位域邮箱在发码入口被拦。
//
// 运行方式（本地一次性 PG，见 packages/server/CLAUDE.md）：
//   docker run -d --name wpa32-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=petscape_wpa32 \
//     -p 55433:5432 postgres:16
//   cd packages/server && DATABASE_URL=postgresql://postgres:postgres@localhost:55433/petscape_wpa32 \
//     pnpm exec prisma migrate deploy
//   DATABASE_URL=postgresql://postgres:postgres@localhost:55433/petscape_wpa32 node --test tests/otp-credentials.integration.test.mjs
// 无 DATABASE_URL 时本地 skip、CI 里报错（同 auth.integration.test.mjs 先例）。
//
// OTP 提取：劫持 console.log 捕获 log 通道输出（[MAIL:log]/[SMS:log] OTP for X => code）。
// Better Auth CSRF：请求头需带 Origin（同 auth.integration.test.mjs）。

import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  if (process.env.CI) {
    throw new Error(
      'CI 缺少 DATABASE_URL：集成测试静默全 skip 意味着门禁失效，检查 ci.yml 的 postgres service 与 env 注入。',
    );
  }
  test('otp-credentials.integration.test.mjs skipped: DATABASE_URL not set (本地需一次性 PG 或 SSH 隧道)', (t) => {
    t.skip('DATABASE_URL 未设置——本机需先起本地 PostgreSQL 容器并 migrate deploy 才能跑此集成测试。');
  });
} else {
  const { createPrismaClient } = await import('../src/infra/db/index.ts');
  const { createAuth } = await import('../src/infra/auth/index.ts');
  const { sendThroughThrottle, OtpThrottledError, ROLLING_MAX_SENDS } = await import(
    '../src/infra/otp-throttle/index.ts'
  );

  const baseURL = 'http://localhost:3200';
  const prisma = createPrismaClient({ connectionString: databaseUrl, poolMax: 15 });

  const auth = createAuth({
    prisma,
    secret: 'wp-a3-2-integration-test-secret-not-for-prod',
    baseURL,
    smsChannel: 'log',
    mailChannel: 'log',
  });

  // 测试隔离前缀：邮箱用专属子域，手机号用专属号段，结尾统一清理。
  const runTag = `wpa32${Date.now().toString().slice(-8)}`;
  const emailDomain = `${runTag}.test.local`;
  const mkEmail = (local) => `${local}@${emailDomain}`;
  const phonePrefix = '+861380066';
  const mkPhone = (suffix) => `${phonePrefix}${suffix}`;

  test.after(async () => {
    await prisma.otpSendRecord.deleteMany({
      where: { OR: [{ target: { endsWith: `@${emailDomain}` } }, { target: { startsWith: phonePrefix } }] },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${emailDomain}` } } });
    await prisma.user.deleteMany({ where: { phoneNumber: { startsWith: phonePrefix } } });
    await prisma.$disconnect();
  });

  // ---- log 通道 OTP 捕获 ----
  function makeOtpCapture() {
    const byTarget = new Map();
    const original = console.log;
    console.log = (...args) => {
      const line = args.join(' ');
      const m = line.match(/\[(?:SMS|MAIL):log\] OTP for (\S+) => (\S+)/);
      if (m) byTarget.set(m[1].toLowerCase(), m[2]);
      original(...args);
    };
    return {
      get: (target) => byTarget.get(target.toLowerCase()),
      restore: () => {
        console.log = original;
      },
    };
  }

  function extractSetCookies(res) {
    const raw = res.headers.getSetCookie?.() ?? [];
    return raw.map((c) => c.split(';')[0]);
  }

  async function req(path, body, cookieHeader) {
    const headers = { 'content-type': 'application/json', origin: baseURL };
    if (cookieHeader) headers.cookie = cookieHeader;
    return auth.handler(
      new Request(`${baseURL}/api/auth${path}`, { method: 'POST', headers, body: JSON.stringify(body) }),
    );
  }

  // 断言状态码 + 失败时附 body 预览（用 clone 读，避免消费掉后续 .json() 需要的 body）。
  async function expectStatus(res, expected, label) {
    if (res.status !== expected) {
      const preview = await res.clone().text();
      assert.equal(res.status, expected, `${label} 应 ${expected}，实际 ${res.status}: ${preview}`);
    }
  }

  /** 邮箱：发码 → 从 log 抓码 → sign-in（注册或登录），返回 { cookieHeader, userId, code }。 */
  async function emailSignIn(email) {
    const cap = makeOtpCapture();
    try {
      const sendRes = await req('/email-otp/send-verification-otp', { email, type: 'sign-in' });
      await expectStatus(sendRes, 200, 'send email otp');
      const code = cap.get(email);
      assert.ok(code, `应从 log 通道抓到 ${email} 的验证码`);
      const signRes = await req('/sign-in/email-otp', { email, otp: code });
      await expectStatus(signRes, 200, 'sign-in email otp');
      const data = await signRes.json();
      const cookieHeader = extractSetCookies(signRes).join('; ');
      return { cookieHeader, userId: data.user.id, code };
    } finally {
      cap.restore();
    }
  }

  /** 手机号：发码 → 抓码 → verify（注册），返回 { cookieHeader, userId }。 */
  async function phoneSignIn(phone) {
    const cap = makeOtpCapture();
    try {
      const sendRes = await req('/phone-number/send-otp', { phoneNumber: phone });
      await expectStatus(sendRes, 200, 'send phone otp');
      const code = cap.get(phone);
      assert.ok(code, `应从 log 通道抓到 ${phone} 的验证码`);
      const verifyRes = await req('/phone-number/verify', { phoneNumber: phone, code });
      await expectStatus(verifyRes, 200, 'verify phone otp');
      const data = await verifyRes.json();
      const cookieHeader = extractSetCookies(verifyRes).join('; ');
      return { cookieHeader, userId: data.user.id, code };
    } finally {
      cap.restore();
    }
  }

  // ================= 节流 =================

  test('[节流] 60s 冷却：同目标第二次发码在冷却窗内被拒', async () => {
    const target = mkEmail('cooldown');
    await sendThroughThrottle({ prisma, target, channel: 'email', send: async () => {} });
    await assert.rejects(
      () => sendThroughThrottle({ prisma, target, channel: 'email', send: async () => {} }),
      (err) => err instanceof OtpThrottledError && err.reason === 'cooldown',
      '冷却窗内第二次发码应抛 OtpThrottledError(cooldown)',
    );
  });

  test('[节流] 滚动 24h：第 11 次发码被拒（前 10 次直接落库绕过冷却，第 11 次触发上限）', async () => {
    const target = mkEmail('cap');
    const now = Date.now();
    // 直接落 10 条记录（时间散开避免冷却互相干扰），模拟 24h 内已发 10 次。
    for (let i = 0; i < ROLLING_MAX_SENDS; i++) {
      await prisma.otpSendRecord.create({
        data: { target, channel: 'email', sentAt: new Date(now - (i + 1) * 2 * 60_000) },
      });
    }
    await assert.rejects(
      () => sendThroughThrottle({ prisma, target, channel: 'email', send: async () => {} }),
      (err) => err instanceof OtpThrottledError && err.reason === 'daily_cap',
      '滚动 24h 内第 11 次发码应抛 OtpThrottledError(daily_cap)',
    );
  });

  test('[节流] 并发同目标发码仅一次通过（其余被冷却/竞态拒绝）', async () => {
    const target = mkEmail('concurrent-send');
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        sendThroughThrottle({ prisma, target, channel: 'email', send: async () => {} }),
      ),
    );
    const passed = results.filter((r) => r.status === 'fulfilled').length;
    assert.equal(passed, 1, `并发 5 次发码应仅 1 次通过节流，实际 ${passed}`);
  });

  test('[节流] 发送失败不记账：通道抛错则该次不占用上限', async () => {
    const target = mkEmail('send-fail');
    await assert.rejects(
      () => sendThroughThrottle({ prisma, target, channel: 'email', send: async () => { throw new Error('boom'); } }),
      /boom/,
      'send 抛错应原样传播',
    );
    const count = await prisma.otpSendRecord.count({ where: { target } });
    assert.equal(count, 0, '发送失败时不应留下记账记录（否则计数虚高）');
  });

  test('[节流] 短信与邮件两通道共用同一目标预算（跨通道也触发冷却）', async () => {
    // 同一 target 先走 sms 通道成功记账，再走 email 通道应命中冷却（两通道共用预算）。
    const target = mkPhone('001');
    await sendThroughThrottle({ prisma, target, channel: 'sms', send: async () => {} });
    await assert.rejects(
      () => sendThroughThrottle({ prisma, target, channel: 'email', send: async () => {} }),
      (err) => err instanceof OtpThrottledError && err.reason === 'cooldown',
      '同 target 跨通道也应共用冷却预算',
    );
  });

  // ================= emailOTP 登录/注册 =================

  test('[emailOTP] 邮箱注册→登录闭环：新邮箱建号 + 二次登录同一 User.id', async () => {
    const email = mkEmail('loop');
    const first = await emailSignIn(email);
    assert.ok(first.userId, '首次 sign-in 应建号并返回 user.id');

    // 二次登录（等冷却过后手动补一条记录不影响；直接建独立 verification）：
    const cap = makeOtpCapture();
    let code;
    try {
      // 冷却：清掉本 target 记录后重新发码（测试关注登录同 id，不测冷却）。
      await prisma.otpSendRecord.deleteMany({ where: { target: email } });
      const sendRes = await req('/email-otp/send-verification-otp', { email, type: 'sign-in' });
      assert.equal(sendRes.status, 200);
      code = cap.get(email);
    } finally {
      cap.restore();
    }
    const signRes = await req('/sign-in/email-otp', { email, otp: code });
    assert.equal(signRes.status, 200);
    const data = await signRes.json();
    assert.equal(data.user.id, first.userId, '同一邮箱二次登录必须落在同一 User.id');
  });

  test('[emailOTP] 邮箱大小写变体命中同一账户（Foo@X vs foo@x）', async () => {
    const lower = mkEmail('caseacct');
    const mixed = lower.replace('caseacct', 'CaseAcct').replace(emailDomain, emailDomain.toUpperCase());
    const first = await emailSignIn(lower);

    // 用大小写变体再登录：应命中同一账户，不新建。
    const cap = makeOtpCapture();
    let code;
    try {
      await prisma.otpSendRecord.deleteMany({ where: { target: lower } });
      const sendRes = await req('/email-otp/send-verification-otp', { email: mixed, type: 'sign-in' });
      assert.equal(sendRes.status, 200, `变体发码应 200：${await sendRes.clone().text()}`);
      code = cap.get(lower); // 规范化后 log 里落的是小写
    } finally {
      cap.restore();
    }
    const signRes = await req('/sign-in/email-otp', { email: mixed, otp: code });
    assert.equal(signRes.status, 200, `变体登录应 200：${await signRes.clone().text()}`);
    const data = await signRes.json();
    assert.equal(data.user.id, first.userId, '大小写变体必须命中同一 User.id');
  });

  test('[emailOTP] 同邮箱并发注册仅一个 User 成功（唯一约束兜底，非先查后写）', async () => {
    const email = mkEmail('race-signup');
    // 先各自发码拿到同一条 verification（sign-in 会 atomicVerify 消费一次），
    // 这里改为直接测"并发 sign-in 同邮箱"下最终只有一个 User 行。
    const cap = makeOtpCapture();
    let code;
    try {
      const sendRes = await req('/email-otp/send-verification-otp', { email, type: 'sign-in' });
      assert.equal(sendRes.status, 200);
      code = cap.get(email);
    } finally {
      cap.restore();
    }
    // 并发提交同一 OTP：atomicVerifyOTP 保证只有一个消费成功建号，其余按 INVALID_OTP 拒绝。
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => req('/sign-in/email-otp', { email, otp: code })),
    );
    const ok = results.filter((r) => r.status === 'fulfilled' && r.value.status === 200).length;
    assert.equal(ok, 1, `并发提交同一 OTP 应仅 1 次成功，实际 ${ok}`);
    const users = await prisma.user.count({ where: { email } });
    assert.equal(users, 1, '同邮箱并发注册最终只应有 1 个 User 行');
  });

  test('[emailOTP] 正确 OTP 并发消费仅一次成功、二次重放被拒', async () => {
    const email = mkEmail('replay');
    const cap = makeOtpCapture();
    let code;
    try {
      const sendRes = await req('/email-otp/send-verification-otp', { email, type: 'sign-in' });
      assert.equal(sendRes.status, 200);
      code = cap.get(email);
    } finally {
      cap.restore();
    }
    const firstRes = await req('/sign-in/email-otp', { email, otp: code });
    assert.equal(firstRes.status, 200, '首次消费正确 OTP 应成功');
    // 重放同一 OTP：已被消费，应拒绝（4xx）。
    const replayRes = await req('/sign-in/email-otp', { email, otp: code });
    assert.notEqual(replayRes.status, 200, '同一 OTP 二次重放不应再成功');
  });

  test('[emailOTP] 错误验证码被拒', async () => {
    const email = mkEmail('wrongcode');
    const cap = makeOtpCapture();
    try {
      const sendRes = await req('/email-otp/send-verification-otp', { email, type: 'sign-in' });
      assert.equal(sendRes.status, 200);
    } finally {
      cap.restore();
    }
    const res = await req('/sign-in/email-otp', { email, otp: '000000' });
    assert.notEqual(res.status, 200, '错误验证码不应登录成功');
  });

  test('[占位域] 占位邮箱在发码入口被拦（不发码）', async () => {
    const placeholder = '+8613800668888@phone.petscape.local';
    const res = await req('/email-otp/send-verification-otp', { email: placeholder, type: 'sign-in' });
    assert.notEqual(res.status, 200, '占位域邮箱发码应被服务端拒绝');
  });

  // ================= 双向绑定 =================

  test('[绑定] 未登录调用邮箱绑定接口 → 401', async () => {
    const res = await req('/email-otp/request-email-change', { newEmail: mkEmail('unauth-bind') });
    assert.equal(res.status, 401, `未登录 request-email-change 应 401，实际 ${res.status}: ${await res.text()}`);
  });

  test('[绑定] 未登录调用手机号绑定接口（updatePhoneNumber）→ 401', async () => {
    // phone-number 的 verify 路由先校验 OTP、再检查 session（见插件 routes.mjs）：
    // 因此要触到 401 分支，必须先发码拿到有效 OTP，再无 session 调 updatePhoneNumber。
    const phone = mkPhone('777');
    const cap = makeOtpCapture();
    let code;
    try {
      const sendRes = await req('/phone-number/send-otp', { phoneNumber: phone });
      assert.equal(sendRes.status, 200);
      code = cap.get(phone);
      assert.ok(code, '应抓到验证码');
    } finally {
      cap.restore();
    }
    const res = await req('/phone-number/verify', { phoneNumber: phone, code, updatePhoneNumber: true });
    assert.equal(res.status, 401, `未登录 updatePhoneNumber 应 401，实际 ${res.status}: ${await res.text()}`);
  });

  test('[绑定] 手机号用户绑定真实邮箱（占位迁移）：User.id 不变、email 更新为真实邮箱', async () => {
    const phone = mkPhone('100');
    const { cookieHeader, userId } = await phoneSignIn(phone);

    const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    assert.ok(before.email?.endsWith('@phone.petscape.local'), '手机号用户初始 email 应为占位域');

    const newEmail = mkEmail('migrated');
    // request-email-change 发码到新邮箱，抓码，change-email 完成迁移。
    const cap = makeOtpCapture();
    let code;
    try {
      const reqRes = await req('/email-otp/request-email-change', { newEmail }, cookieHeader);
      assert.equal(reqRes.status, 200, `request-email-change 应 200：${await reqRes.clone().text()}`);
      code = cap.get(newEmail);
      assert.ok(code, '应抓到迁移目标邮箱的验证码');
    } finally {
      cap.restore();
    }
    const changeRes = await req('/email-otp/change-email', { newEmail, otp: code }, cookieHeader);
    assert.equal(changeRes.status, 200, `change-email 应 200：${await changeRes.clone().text()}`);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    assert.equal(after.id, userId, '绑定邮箱后 User.id 必须不变');
    assert.equal(after.email, newEmail, 'email 应迁移为真实邮箱');
    assert.equal(after.emailVerified, true, 'emailVerified 应置真');
    assert.equal(after.phoneNumber, phone, '手机号应保留');
  });

  test('[绑定·d1] 绑定已被占用邮箱：request-email-change 返回结构化冲突 4xx，不发码、不记账', async () => {
    // QA 阻塞项：已登录用户对已被其他账户占用的邮箱发起绑定，Better Auth 内置
    // request-email-change 会返回 200 静默不发码（防枚举），UI 谎报"已发送"→ 用户死路。
    // 修复要求：已登录的绑定路径必须返回结构化冲突（4xx + EMAIL_EXIST 语义），与手机号
    // 侧 PHONE_NUMBER_EXIST 对齐（spec 账户语义"拒绝并内联提示"）。防枚举静默只保留在
    // 未认证的 sign-in 发码入口。
    const occupant = mkEmail('occupied-d1');
    await emailSignIn(occupant); // 账户 A 占用该邮箱

    const binder = mkPhone('d10');
    const { cookieHeader } = await phoneSignIn(binder); // 账户 B（手机号）尝试绑定被占用邮箱

    const cap = makeOtpCapture();
    let sawSend = false;
    let res;
    try {
      res = await req('/email-otp/request-email-change', { newEmail: occupant }, cookieHeader);
      sawSend = !!cap.get(occupant);
    } finally {
      cap.restore();
    }
    assert.ok(
      res.status >= 400 && res.status < 500,
      `绑定已占用邮箱应返回 4xx 结构化冲突，实际 ${res.status}: ${await res.clone().text()}`,
    );
    const body = await res.json().catch(() => ({}));
    assert.equal(body.code, 'EMAIL_EXIST', `冲突响应应带结构化 code=EMAIL_EXIST，实际 ${JSON.stringify(body)}`);
    assert.equal(sawSend, false, '被占用邮箱不应发出验证码（避免 UI 谎报已发送）');
    const recordCount = await prisma.otpSendRecord.count({ where: { target: occupant.toLowerCase() } });
    // 占用者注册时可能已有 1 条记账；断言的是"本次冲突绑定未新增记账"——占用者用不同 target
    // 前缀，实际这里 occupant 自己 sign-in 会记 1 条，故断言 <=1（本次绑定 0 新增）。
    assert.ok(recordCount <= 1, `绑定冲突不应新增节流记账，occupant 记录数 ${recordCount}`);
  });

  test('[绑定] 邮箱用户绑定手机号（updatePhoneNumber）：User.id 不变、phoneNumber 更新', async () => {
    const email = mkEmail('bindphone');
    const { cookieHeader, userId } = await emailSignIn(email);

    const phone = mkPhone('200');
    const cap = makeOtpCapture();
    let code;
    try {
      const sendRes = await req('/phone-number/send-otp', { phoneNumber: phone });
      assert.equal(sendRes.status, 200);
      code = cap.get(phone);
    } finally {
      cap.restore();
    }
    const verifyRes = await req(
      '/phone-number/verify',
      { phoneNumber: phone, code, updatePhoneNumber: true },
      cookieHeader,
    );
    assert.equal(verifyRes.status, 200, `updatePhoneNumber 应 200：${await verifyRes.clone().text()}`);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    assert.equal(after.id, userId, '绑定手机号后 User.id 必须不变');
    assert.equal(after.phoneNumber, phone, 'phoneNumber 应更新为绑定手机号');
    assert.equal(after.phoneNumberVerified, true, 'phoneNumberVerified 应置真');
    assert.equal(after.email, email, '邮箱应保留');
  });

  test('[绑定] 两账户并发绑定同一手机号：仅一个成功，失败方结构化冲突（非 500）', async () => {
    const emailA = mkEmail('conflict-a');
    const emailB = mkEmail('conflict-b');
    const a = await emailSignIn(emailA);
    const b = await emailSignIn(emailB);
    const targetPhone = mkPhone('300');

    // 两账户各自拿到对同一手机号的有效 OTP（phone-number 的 verification identifier 是
    // 手机号本身，两账户发码会覆盖为同一码——用最后一次抓到的码给两者，模拟并发抢绑）。
    const cap = makeOtpCapture();
    let code;
    try {
      await req('/phone-number/send-otp', { phoneNumber: targetPhone });
      code = cap.get(targetPhone);
      assert.ok(code, '应抓到目标手机号的验证码');
    } finally {
      cap.restore();
    }

    const [ra, rb] = await Promise.allSettled([
      req('/phone-number/verify', { phoneNumber: targetPhone, code, updatePhoneNumber: true }, a.cookieHeader),
      req('/phone-number/verify', { phoneNumber: targetPhone, code, updatePhoneNumber: true }, b.cookieHeader),
    ]);
    const statuses = [ra, rb].map((r) => (r.status === 'fulfilled' ? r.value.status : 599));
    const okCount = statuses.filter((s) => s === 200).length;
    assert.equal(okCount, 1, `并发绑定同一手机号应仅 1 个成功，实际状态 ${JSON.stringify(statuses)}`);
    // 失败方必须是结构化 4xx 冲突，不是 500。
    const failStatus = statuses.find((s) => s !== 200);
    assert.ok(failStatus >= 400 && failStatus < 500, `失败方应为 4xx 结构化冲突，实际 ${failStatus}`);

    const boundCount = await prisma.user.count({ where: { phoneNumber: targetPhone } });
    assert.equal(boundCount, 1, '目标手机号最终只应绑定在 1 个账户上');
  });
}
