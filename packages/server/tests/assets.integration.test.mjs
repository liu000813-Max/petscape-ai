// packages/server/tests/assets.integration.test.mjs
// spec: docs/plans/phase-b-execution-plan.md WP-3.2 验收 1-4：
//   1. A/B 两用户隔离：A 创建项目→上传→登记→读回全链 200；B 访问 A 的项目/资产 404/403；
//   2. 未签名直访对象 403；过期签名 URL 访问失败（TTL 设 2s，sleep 后实测）；
//   3. 上传完成校验：伪造大小 confirm 不置 available；
//   4. 数据库无二进制内容、OSS 无未登记对象（前缀 list 对账：测试写入的对象都有 Asset 记录）。
//
// 真实 RDS + 真实 OSS bucket（petscape-prod，公网 endpoint，本机可达）。无 DATABASE_URL
// 或无 OSS 凭证时显式 skip（同 auth/db.integration.test.mjs 先例）。测试对象统一放
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
  test('assets.integration.test.mjs skipped: DATABASE_URL not set (RDS 内网不可达，需 SSH 隧道)', (t) => {
    t.skip('DATABASE_URL 未设置——本机需先建立到 RDS 的 SSH 隧道并导出 DATABASE_URL 才能跑此集成测试；CI 环境无法直连 RDS 内网，此为预期行为。');
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

    // A 请求上传（拿到 PUT 签名 URL）
    const fileBody = Buffer.from(`itest-content-${runId}`);
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

    // 客户端 PUT（真实网络请求，验证签名 URL 确实可用）。不携带 Content-Type
    // header——V4 签名 URL 若签名时未声明 content-type，OSS 服务端校验时会将
    // 请求实际携带的 Content-Type 强制并入 canonical headers 重算，与签名 URL
    // 生成时（未声明该 header）的 canonical request 不一致，导致 SignatureDoesNotMatch。
    // 本包签名 URL 生成不预声明 headers（signPutUrl 不接受 headers 参数），
    // 因此客户端 PUT 也不应主动携带 Content-Type/Content-MD5。
    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
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

    const putRes = await fetch(uploadUrl, { method: 'PUT', body: fileBody });
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

    const putRes = await fetch(uploadUrl, { method: 'PUT', body: fileBody });
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

    const putRes = await fetch(uploadUrl, { method: 'PUT', body: fileBody });
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
}
