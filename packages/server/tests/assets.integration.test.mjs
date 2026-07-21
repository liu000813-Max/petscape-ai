// packages/server/tests/assets.integration.test.mjs
// spec: docs/plans/phase-b-execution-plan.md WP-3.2 验收 1-4：
//   1. A/B 两用户隔离：A 创建项目→上传→登记→读回全链 200；B 访问 A 的项目/资产 404/403；
//   2. 未签名直访对象 403；过期签名 URL 访问失败（TTL 设 2s，sleep 后实测）；
//   3. 上传完成校验：伪造大小 confirm 不置 available；
//   4. 数据库无二进制内容、OSS 无未登记对象（前缀 list 对账：测试写入的对象都有 Asset 记录）。
//
// 真实 RDS + 真实 OSS bucket（petscape-prod，公网 endpoint，本机可达）。无 DATABASE_URL
// 时本地 skip、CI 报错（同 auth/db.integration.test.mjs 先例）；无 OSS 凭证时显式
// skip——这在 CI 是预期行为（云凭证不进 CI），DB 相关断言仍会真跑。测试对象统一放
// `uploads/raw/{ownerUserId}/...` 前缀下，owner 用户手机号以 itest- 标识（见测试内
// phone 生成），测试结束删除自己创建的 User（级联删 Project/Asset 数据库行）与自己
// 上传到 OSS 的对象（只删自己建的，其余一律不动）。
//
// 本地/演练机跑法：先建 SSH 隧道到 RDS，导出 DATABASE_URL 指向 localhost 转发端口，
// 并确保环境含 ALIBABA_CLOUD_ACCESS_KEY_ID/SECRET + ALIBABA_CLOUD_OSS_BUCKET/ENDPOINT，
// 再执行 `pnpm test`。

import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.DATABASE_URL;
const hasOssCreds =
  process.env.ALIBABA_CLOUD_ACCESS_KEY_ID &&
  process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET &&
  process.env.ALIBABA_CLOUD_OSS_BUCKET &&
  process.env.ALIBABA_CLOUD_OSS_ENDPOINT;

if (!databaseUrl) {
  if (process.env.CI) {
    // 同 db.integration.test.mjs：CI 缺 DATABASE_URL = 门禁静默失效，炸而不是跳过。
    // （OSS 凭证缺失的 skip 在 CI 是预期行为——云凭证不进 CI，见下一分支。）
    throw new Error(
      'CI 缺少 DATABASE_URL：集成测试静默全 skip 意味着门禁失效，检查 ci.yml 的 postgres service 与 env 注入。'
    );
  }
  test('assets.integration.test.mjs skipped: DATABASE_URL not set (本地需 SSH 隧道连 RDS)', (t) => {
    t.skip('DATABASE_URL 未设置——本机需先建立到 RDS 的 SSH 隧道并导出 DATABASE_URL 才能跑此集成测试（CI 由一次性 PostgreSQL service container 提供，见 .github/workflows/ci.yml）。');
  });
} else if (!hasOssCreds) {
  test('assets.integration.test.mjs skipped: OSS credentials/bucket/endpoint not set', (t) => {
    t.skip('缺少 ALIBABA_CLOUD_ACCESS_KEY_ID/SECRET 或 ALIBABA_CLOUD_OSS_BUCKET/ENDPOINT——需提供真实 OSS 凭证才能跑此集成测试。');
  });
} else {
  const { createPrismaClient } = await import('../src/infra/db/index.ts');
  const { createAuth } = await import('../src/infra/auth/index.ts');
  const { OssStorage } = await import('../src/infra/oss/index.ts');
  const {
    createProject,
    requestAssetUpload,
    confirmAssetUpload,
    getAssetDownloadUrl,
    listProjectAssets,
    getProject,
    NotFoundError,
    AssetVerificationError,
  } = await import('../src/application/index.ts');

  const baseURL = 'http://localhost:3100';
  const runId = Date.now().toString().slice(-8);
  const prisma = createPrismaClient({ connectionString: databaseUrl, poolMax: 5 });
  const auth = createAuth({
    prisma,
    secret: 'wp-3-2-integration-test-secret-not-for-prod',
    baseURL,
    smsChannel: 'log',
  });
  const oss = new OssStorage({
    accessKeyId: process.env.ALIBABA_CLOUD_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
    bucket: process.env.ALIBABA_CLOUD_OSS_BUCKET,
    endpoint: process.env.ALIBABA_CLOUD_OSS_ENDPOINT,
    region: process.env.ALIBABA_CLOUD_REGION,
  });

  // 真实最小 1x1 PNG（含正确 PNG 魔数 89 50 4E 47 0D 0A 1A 0A），供 mime 嗅探测试
  // 使用——区别于其余测试用的任意文本 Buffer（那些测试不关心内容嗅探）。
  const REAL_PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );

  /** 劫持 console.log，从 infra/sms 的 log 通道输出中提取最近一次 OTP（同 auth.integration.test.mjs）。 */
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

  /**
   * 通过 send-otp/verify 登录闭环拿到一个真实 User + Session Cookie（同 auth 测试先例）。
   * 手机号前缀刻意避开 `+8613800`——auth.integration.test.mjs 的 test.after 用
   * `startsWith('+8613800')` 清理该文件创建的用户，若与本文件手机号前缀重叠，
   * node --test 默认并发跑多个测试文件时，auth 测试的清理会把本文件测试中途创建
   * 的 User 一并删除（级联删掉 Project/Asset），导致间歇性 "Project not found"。
   * 用 `+8613801` 前缀隔离两个测试文件的清理范围，避免跨文件资源竞争。
   */
  async function loginAsNewUser(label) {
    const phone = `+8613801${runId}${label}`;
    const { code } = await captureOtp(async () => {
      const res = await auth.handler(
        new Request(`${baseURL}/api/auth/phone-number/send-otp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: baseURL },
          body: JSON.stringify({ phoneNumber: phone }),
        }),
      );
      assert.equal(res.status, 200, `send-otp 应返回 200: ${await res.text()}`);
    });
    const verifyRes = await auth.handler(
      new Request(`${baseURL}/api/auth/phone-number/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: baseURL },
        body: JSON.stringify({ phoneNumber: phone, code }),
      }),
    );
    assert.equal(verifyRes.status, 200, `verify 应返回 200: ${await verifyRes.text()}`);
    const cookieHeader = extractSetCookies(verifyRes).join('; ');
    const session = await auth.api.getSession({ headers: new Headers({ cookie: cookieHeader }) });
    assert.ok(session, `登录应建立 session（phone=${phone}）`);
    return { userId: session.user.id, phone };
  }

  // 测试全程写入的 OSS key 与创建的 userId，供 test.after 清理。
  const createdOssKeys = [];
  const createdUserIds = [];

  test.after(async () => {
    // 只删自己创建的对象/行：先删 OSS 对象，再删数据库行（User 级联删 Project/Asset）。
    for (const key of createdOssKeys) {
      try {
        await oss.delete(key);
      } catch {
        // 对象可能从未真正上传成功（如伪造大小测试的对象本就不存在），忽略清理失败。
      }
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  });

  test('WP-3.2 验收 1：A 创建项目→上传→登记→读回全链 200；B 访问 A 的项目/资产 404', async () => {
    const userA = await loginAsNewUser('a1');
    const userB = await loginAsNewUser('b1');
    createdUserIds.push(userA.userId, userB.userId);

    // A 创建项目
    const project = await createProject({ prisma, ownerUserId: userA.userId, title: 'itest project' });
    assert.equal(project.ownerUserId, userA.userId);

    // A 请求上传（拿到 PUT 签名 URL）。声明 mime=image/png 时 confirm 会按真实
    // 字节魔数嗅探校验（QA 修复），用真实 PNG 字节而非任意文本 Buffer。
    const fileBody = REAL_PNG_1X1;
    const { asset, uploadUrl } = await requestAssetUpload({
      prisma,
      oss,
      ownerUserId: userA.userId,
      projectId: project.id,
      filename: 'photo.png',
      mime: 'image/png',
      size: fileBody.length,
    });
    assert.equal(asset.status, 'pending');
    assert.match(asset.ossKey, new RegExp(`^uploads/raw/${userA.userId}/${asset.id}/photo\\.png$`));
    createdOssKeys.push(asset.ossKey);

    // 客户端 PUT（真实网络请求，验证签名 URL 确实可用）。WP-G2 修正：真实浏览器
    // `fetch(url, { body: File })` 会自动附加 Content-Type header（规范行为，
    // 客户端代码无法阻止），故 signPutUrl 现在把声明的 mime 预先纳入签名
    // （见 infra/oss/index.ts），这里显式携带同一 Content-Type 验证签名一致。
    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: fileBody,
    });
    assert.equal(putRes.status, 200, `PUT 上传应成功: ${await putRes.text()}`);

    // A 登记（confirm）→ 置 available
    const confirmed = await confirmAssetUpload({
      prisma,
      oss,
      ownerUserId: userA.userId,
      assetId: asset.id,
    });
    assert.equal(confirmed.status, 'available', 'confirm 后大小一致应置为 available');

    // A 读回项目/资产（下载签名 URL）全链 200
    const readBack = await getProject({ prisma, projectId: project.id, currentUserId: userA.userId });
    assert.equal(readBack.id, project.id);

    const { downloadUrl } = await getAssetDownloadUrl({
      prisma,
      oss,
      ownerUserId: userA.userId,
      assetId: asset.id,
    });
    const getRes = await fetch(downloadUrl);
    const downloadedBuffer = Buffer.from(await getRes.arrayBuffer());
    assert.equal(getRes.status, 200, `GET 下载应成功: ${downloadedBuffer.toString()}`);
    assert.equal(downloadedBuffer.toString(), fileBody.toString(), '下载内容应与上传内容一致');

    // B 访问 A 的项目 → NotFoundError（Route Handler 层映射为 404）
    await assert.rejects(
      () => getProject({ prisma, projectId: project.id, currentUserId: userB.userId }),
      NotFoundError,
      'B 访问 A 的项目应抛 NotFoundError',
    );

    // B 访问 A 的资产下载 URL → NotFoundError
    await assert.rejects(
      () => getAssetDownloadUrl({ prisma, oss, ownerUserId: userB.userId, assetId: asset.id }),
      NotFoundError,
      'B 访问 A 的资产应抛 NotFoundError',
    );

    // B 向 A 的项目请求上传（挂资产）→ NotFoundError
    await assert.rejects(
      () =>
        requestAssetUpload({
          prisma,
          oss,
          ownerUserId: userB.userId,
          projectId: project.id,
          filename: 'evil.png',
          mime: 'image/png',
          size: 1,
        }),
      NotFoundError,
      'B 向 A 的项目请求上传应抛 NotFoundError',
    );
  });

  test('WP-3.2 验收 2a：未签名直访 OSS 对象应 403（AccessDenied）', async () => {
    const user = await loginAsNewUser('c1');
    createdUserIds.push(user.userId);
    const project = await createProject({ prisma, ownerUserId: user.userId, title: 'itest unsigned' });

    const fileBody = Buffer.from(`itest-unsigned-${runId}`);
    const { asset, uploadUrl } = await requestAssetUpload({
      prisma,
      oss,
      ownerUserId: user.userId,
      projectId: project.id,
      filename: 'raw.bin',
      mime: 'application/octet-stream',
      size: fileBody.length,
    });
    createdOssKeys.push(asset.ossKey);

    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: fileBody,
    });
    assert.equal(putRes.status, 200);

    // 未签名直接访问同一对象（拼公网 endpoint URL，不带任何签名参数）——私有 Bucket
    // 应拒绝，验证 ADR-0005 验证条件 2："未授权请求失败"。
    const unsignedUrl = `https://${process.env.ALIBABA_CLOUD_OSS_BUCKET}.${process.env.ALIBABA_CLOUD_OSS_ENDPOINT}/${asset.ossKey}`;
    const unsignedRes = await fetch(unsignedUrl);
    assert.equal(unsignedRes.status, 403, `未签名直访应返回 403，实际 ${unsignedRes.status}`);
    const bodyText = await unsignedRes.text();
    assert.match(bodyText, /AccessDenied/i, 'OSS 拒绝响应应含 AccessDenied 证据');
  });

  test('WP-3.2 验收 2b：过期签名 URL 访问应失败（TTL=2s，sleep 后实测）', async () => {
    const user = await loginAsNewUser('c2');
    createdUserIds.push(user.userId);
    const project = await createProject({ prisma, ownerUserId: user.userId, title: 'itest expiry' });

    const fileBody = Buffer.from(`itest-expiry-${runId}`);
    const { asset } = await requestAssetUpload({
      prisma,
      oss,
      ownerUserId: user.userId,
      projectId: project.id,
      filename: 'expiring.bin',
      mime: 'application/octet-stream',
      size: fileBody.length,
    });
    createdOssKeys.push(asset.ossKey);

    // 直接用 oss 客户端签一个 2 秒 TTL 的 GET URL（不经 application 层的默认 TTL），
    // 验证过期后签名 URL 本身会失效——这是 infra/oss 签名机制的属性，不依赖业务 TTL 常量。
    const shortLivedGetUrl = await oss.signGetUrl(asset.ossKey, 2);

    // 对象此刻尚不存在（未 PUT），但签名有效期验证不需要对象存在——先 sleep 让 URL 过期。
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const expiredRes = await fetch(shortLivedGetUrl);
    assert.notEqual(expiredRes.status, 200, `过期签名 URL 不应返回 200，实际 ${expiredRes.status}`);
    assert.ok(
      expiredRes.status === 403 || expiredRes.status === 400,
      `过期签名 URL 应返回 403/400 类失败，实际 ${expiredRes.status}`,
    );
  });

  test('WP-3.2 验收 3：伪造尺寸 confirm 不应置 available（Asset 保持 pending）', async () => {
    const user = await loginAsNewUser('d1');
    createdUserIds.push(user.userId);
    const project = await createProject({ prisma, ownerUserId: user.userId, title: 'itest forged size' });

    const fileBody = Buffer.from(`itest-forged-${runId}`);
    const { asset, uploadUrl } = await requestAssetUpload({
      prisma,
      oss,
      ownerUserId: user.userId,
      projectId: project.id,
      filename: 'forged.bin',
      mime: 'application/octet-stream',
      size: fileBody.length,
    });
    createdOssKeys.push(asset.ossKey);

    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: fileBody,
    });
    assert.equal(putRes.status, 200);

    // 声明一个与真实大小不符的伪造尺寸
    await assert.rejects(
      () =>
        confirmAssetUpload({
          prisma,
          oss,
          ownerUserId: user.userId,
          assetId: asset.id,
          declaredSize: fileBody.length + 999,
        }),
      AssetVerificationError,
      '尺寸不符应抛 AssetVerificationError',
    );

    const reloaded = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    assert.equal(reloaded.status, 'pending', '伪造尺寸后 Asset 应保持 pending，不进入 available');

    // 同一 Asset 换个不存在的 key 再 confirm（模拟"伪造 key"路径：对象从未上传到该 key）。
    const neverUploaded = await requestAssetUpload({
      prisma,
      oss,
      ownerUserId: user.userId,
      projectId: project.id,
      filename: 'never-uploaded.bin',
      mime: 'application/octet-stream',
      size: 123,
    });
    createdOssKeys.push(neverUploaded.asset.ossKey);
    await assert.rejects(
      () =>
        confirmAssetUpload({
          prisma,
          oss,
          ownerUserId: user.userId,
          assetId: neverUploaded.asset.id,
        }),
      AssetVerificationError,
      '对象不存在时应抛 AssetVerificationError',
    );
    const reloadedNever = await prisma.asset.findUniqueOrThrow({ where: { id: neverUploaded.asset.id } });
    assert.equal(reloadedNever.status, 'pending');
  });

  test('WP-3.2 验收 4：前缀 list 对账——测试写入的对象都有对应 Asset 记录', async () => {
    const user = await loginAsNewUser('e1');
    createdUserIds.push(user.userId);
    const project = await createProject({ prisma, ownerUserId: user.userId, title: 'itest reconcile' });

    const fileBody = Buffer.from(`itest-reconcile-${runId}`);
    const { asset, uploadUrl } = await requestAssetUpload({
      prisma,
      oss,
      ownerUserId: user.userId,
      projectId: project.id,
      filename: 'reconcile.bin',
      mime: 'application/octet-stream',
      size: fileBody.length,
    });
    createdOssKeys.push(asset.ossKey);

    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: fileBody,
    });
    assert.equal(putRes.status, 200);
    await confirmAssetUpload({ prisma, oss, ownerUserId: user.userId, assetId: asset.id });

    // 前缀 list：该用户的 uploads/raw/{userId}/ 前缀下所有对象都应在数据库中有 Asset 记录。
    const prefix = `uploads/raw/${user.userId}/`;
    const keysInOss = await oss.listKeysByPrefix(prefix);
    assert.ok(keysInOss.includes(asset.ossKey), 'list 应包含刚上传的对象 key');

    const assetsInDb = await prisma.asset.findMany({ where: { ownerUserId: user.userId } });
    const dbKeys = new Set(assetsInDb.map((a) => a.ossKey));
    for (const key of keysInOss) {
      assert.ok(dbKeys.has(key), `OSS 中的对象 key（${key}）应有对应 Asset 数据库记录`);
    }
  });

  test('WP-G2：listProjectAssets 只返回 available 状态资产，含短 TTL 下载 URL；越权 404；重启后（新 Prisma 连接模拟）仍可读', async () => {
    const userA = await loginAsNewUser('g2a');
    const userB = await loginAsNewUser('g2b');
    createdUserIds.push(userA.userId, userB.userId);
    const project = await createProject({ prisma, ownerUserId: userA.userId, title: 'itest g2 list' });

    // 声明 mime=image/png，confirm 会按真实字节魔数嗅探校验（QA 修复），
    // 用真实 PNG 字节而非任意文本 Buffer。
    const fileBody = REAL_PNG_1X1;
    const { asset, uploadUrl } = await requestAssetUpload({
      prisma,
      oss,
      ownerUserId: userA.userId,
      projectId: project.id,
      filename: 'pet.png',
      mime: 'image/png',
      size: fileBody.length,
    });
    createdOssKeys.push(asset.ossKey);

    // pending（未 PUT+confirm）资产不应出现在列表中。
    const beforeConfirm = await listProjectAssets({
      prisma,
      oss,
      ownerUserId: userA.userId,
      projectId: project.id,
    });
    assert.equal(
      beforeConfirm.find((a) => a.id === asset.id),
      undefined,
      'pending 资产不应出现在 listProjectAssets 结果中',
    );

    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: fileBody,
    });
    assert.equal(putRes.status, 200);
    await confirmAssetUpload({ prisma, oss, ownerUserId: userA.userId, assetId: asset.id });

    const afterConfirm = await listProjectAssets({
      prisma,
      oss,
      ownerUserId: userA.userId,
      projectId: project.id,
    });
    const listed = afterConfirm.find((a) => a.id === asset.id);
    assert.ok(listed, 'confirm 后资产应出现在 listProjectAssets 结果中');
    assert.equal(listed.status, 'available');
    assert.ok(listed.downloadUrl, 'listProjectAssets 结果应含可用的下载签名 URL');

    const getRes = await fetch(listed.downloadUrl);
    assert.equal(getRes.status, 200, '列表返回的下载 URL 应可直接下载 200');

    // B 越权访问 A 的项目资产列表 → NotFoundError（404 语义）。
    await assert.rejects(
      () => listProjectAssets({ prisma, oss, ownerUserId: userB.userId, projectId: project.id }),
      NotFoundError,
      'B 访问 A 的项目资产列表应抛 NotFoundError',
    );

    // 「重启后图仍可见」的核心机制：新建一个独立 Prisma 连接模拟进程重启后的
    // 全新查询（内存态清零，数据库/OSS 是唯一持久层），assetId 仍能换到有效签名 URL。
    const { createPrismaClient: createFreshPrismaClient } = await import('../src/infra/db/index.ts');
    const freshPrisma = createFreshPrismaClient({ connectionString: databaseUrl, poolMax: 2 });
    try {
      const afterRestart = await listProjectAssets({
        prisma: freshPrisma,
        oss,
        ownerUserId: userA.userId,
        projectId: project.id,
      });
      const restartListed = afterRestart.find((a) => a.id === asset.id);
      assert.ok(restartListed, '模拟重启后的新连接仍应能列出该资产');
      const restartGetRes = await fetch(restartListed.downloadUrl);
      assert.equal(restartGetRes.status, 200, '模拟重启后下载 URL 仍应可用（内容持久化在 OSS，不依赖进程内存）');
      const restartBuffer = Buffer.from(await restartGetRes.arrayBuffer());
      assert.equal(restartBuffer.toString(), fileBody.toString(), '重启后下载内容应与原始上传内容一致');
    } finally {
      await freshPrisma.$disconnect();
    }
  });

  test('QA 修复：checksum 在 confirm 后落地为 OSS ETag（此前恒 null）', async () => {
    const user = await loginAsNewUser('qacs');
    createdUserIds.push(user.userId);
    const project = await createProject({ prisma, ownerUserId: user.userId, title: 'itest checksum' });

    const { asset, uploadUrl } = await requestAssetUpload({
      prisma,
      oss,
      ownerUserId: user.userId,
      projectId: project.id,
      filename: 'checksum.png',
      mime: 'image/png',
      size: REAL_PNG_1X1.length,
    });
    createdOssKeys.push(asset.ossKey);
    assert.equal(asset.checksum, null, 'pending 阶段 checksum 应为 null（尚未上传/确认）');

    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: REAL_PNG_1X1,
    });
    assert.equal(putRes.status, 200);

    const confirmed = await confirmAssetUpload({ prisma, oss, ownerUserId: user.userId, assetId: asset.id });
    assert.equal(confirmed.status, 'available');
    assert.ok(confirmed.checksum, 'confirm 后 checksum 应落地非空（ADR-0005：保存校验值）');

    const head = await oss.head(asset.ossKey);
    assert.equal(confirmed.checksum, head.etag, 'checksum 应等于 OSS 返回的 ETag');

    const reloaded = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    assert.equal(reloaded.checksum, head.etag, '数据库持久化的 checksum 应与 OSS ETag 一致');
  });

  test('QA 修复：confirm 按对象真实字节魔数嗅探 mime，与声明不符则 409 拒绝、Asset 保持 pending', async () => {
    const user = await loginAsNewUser('qamime');
    createdUserIds.push(user.userId);
    const project = await createProject({ prisma, ownerUserId: user.userId, title: 'itest mime sniff' });

    // 客户端声明 mime=image/jpeg，但实际 PUT 的字节是 PNG 魔数——模拟 QA 实测的
    // 「text/html + JPEG 字节」类攻击场景的等价形式：声明与真实内容不一致。
    const { asset, uploadUrl } = await requestAssetUpload({
      prisma,
      oss,
      ownerUserId: user.userId,
      projectId: project.id,
      filename: 'forged-mime.jpg',
      mime: 'image/jpeg',
      size: REAL_PNG_1X1.length,
    });
    createdOssKeys.push(asset.ossKey);

    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      // 签名已按声明的 image/jpeg 预声明，PUT 必须携带同一 Content-Type 才能通过
      // OSS 签名校验；mime 嗅探校验的是「服务端读取到的真实字节」与「Asset 记录
      // 声明的 mime」是否一致，和 Content-Type header 是两件事。
      headers: { 'Content-Type': 'image/jpeg' },
      body: REAL_PNG_1X1,
    });
    assert.equal(putRes.status, 200);

    await assert.rejects(
      () => confirmAssetUpload({ prisma, oss, ownerUserId: user.userId, assetId: asset.id }),
      AssetVerificationError,
      '声明 mime 与真实字节魔数不符应抛 AssetVerificationError',
    );

    const reloaded = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    assert.equal(reloaded.status, 'pending', 'mime 嗅探失败后 Asset 应保持 pending，不进入 available');
    assert.equal(reloaded.checksum, null, 'mime 嗅探失败后不应写入 checksum');
  });

  test('QA 修复：confirm 按魔数嗅探接受声明与真实内容一致的 mime（正常路径不受影响）', async () => {
    const user = await loginAsNewUser('qamimeok');
    createdUserIds.push(user.userId);
    const project = await createProject({ prisma, ownerUserId: user.userId, title: 'itest mime ok' });

    const { asset, uploadUrl } = await requestAssetUpload({
      prisma,
      oss,
      ownerUserId: user.userId,
      projectId: project.id,
      filename: 'real.png',
      mime: 'image/png',
      size: REAL_PNG_1X1.length,
    });
    createdOssKeys.push(asset.ossKey);

    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: REAL_PNG_1X1,
    });
    assert.equal(putRes.status, 200);

    const confirmed = await confirmAssetUpload({ prisma, oss, ownerUserId: user.userId, assetId: asset.id });
    assert.equal(confirmed.status, 'available', '声明 mime 与真实字节一致时 confirm 应正常通过');
  });

  test('QA 修复：requestAssetUpload 忽略调用方以外注入的非法 kind——路由层不再原样转发客户端 kind', async () => {
    const user = await loginAsNewUser('qakind');
    createdUserIds.push(user.userId);
    const project = await createProject({ prisma, ownerUserId: user.userId, title: 'itest kind allowlist' });

    // requestAssetUpload 本身仍允许服务端调用方显式传 kind（如 pet cover-upload
    // route 传 'pet_cover'）；本测试验证的是允许值集合（allowlist），不合法的
    // kind 直接被拒绝，防止路由层疏忽转发未来新增的客户端字段时静默放行。
    await assert.rejects(
      () =>
        requestAssetUpload({
          prisma,
          oss,
          ownerUserId: user.userId,
          projectId: project.id,
          filename: 'evil.png',
          mime: 'image/png',
          size: 1,
          kind: 'generated_render',
        }),
      /kind/i,
      'kind 不在服务端 allowlist 中应被拒绝，不应静默建 Asset',
    );
  });
}
