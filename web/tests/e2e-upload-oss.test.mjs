// web/tests/e2e-upload-oss.test.mjs —— WP-G2 上传走 OSS。
//
// spec: docs/plans/g-line-execution-plan.md WP-G2；ADR-0005（对象存储）。
// 覆盖：
//   1. landing 宠物照上传（PetCreatorSection）不再打旧 `/api/project/:id/upload`，
//      而是走 v1 Asset 链（POST assets → PUT 签名 URL → confirm → download），
//      预览图 src 是 OSS 签名 URL（不是 `/uploads/...` 本地静态路径）。
//   2. 「重启后图仍可见」：上传成功拿到的下载 URL 在杀服务器重启后依然可用 200
//      （内容持久化在 OSS + 数据库，不依赖进程内存）。
//   3. 越权：他人无法通过猜测/复用同一 assetId 拿到下载 URL（跨账号 404）。
//   4. 旧路由确认已退役：`/api/project/:id/upload`、`/uploads/[...path]` 均 404。
//
// 真实 OSS + 真实 RDS（同 packages/server/tests/assets.integration.test.mjs 的凭证
// 要求）；无 DATABASE_URL 时直接失败，不静默 skip。无 OSS 凭证时门禁在本地也应
// 失败（G2 spec 明确要求验证真实签名 URL 行为，不满足于 mock）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const webRoot = fileURLToPath(new URL('../', import.meta.url));
const PORT = process.env.E2E_UPLOAD_OSS_PORT ?? '3416';
const BASE_URL = `http://127.0.0.1:${PORT}`;
// 手机号（11 位）加运行期后缀避免跨次调试跑测试撞 better-auth 的 send-otp 频率限制。
const RUN_SUFFIX = Date.now().toString().slice(-4);
const PHONE_OWNER = `1370005${RUN_SUFFIX}`;
const PHONE_RESTART_OWNER = `1370006${RUN_SUFFIX}`;
const PHONE_FOREIGN = `1370007${RUN_SUFFIX}`;
const PHONE_KIND = `1370008${RUN_SUFFIX}`;

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL 未设置：e2e-upload-oss 测试需要一个已跑过 prisma migrate deploy 的 Postgres（本地容器或 SSH 隧道），不静默 skip。',
  );
}

const hasOssCreds =
  process.env.ALIBABA_CLOUD_ACCESS_KEY_ID &&
  process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET &&
  process.env.ALIBABA_CLOUD_OSS_BUCKET &&
  process.env.ALIBABA_CLOUD_OSS_ENDPOINT;

if (!hasOssCreds) {
  throw new Error(
    'ALIBABA_CLOUD_* OSS 凭证未设置：e2e-upload-oss 验证真实签名 URL 行为，需真实 OSS 凭证，不静默 skip。',
  );
}

// 测试期间真实上传到 petscape-prod 的对象 key（从签名 URL 解析出 ossKey 路径段），
// test.after 用 tools/aliyun（项目统一的账号断言封装）逐个清理，同
// assets.integration.test.mjs 的清理纪律——不在 web 侧新增 ali-oss 直接依赖或
// 打破 infra/oss 只供 application 层消费的分层边界。
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const uploadedOssKeys = [];
function trackOssKeyFromSignedUrl(signedUrl) {
  const url = new URL(signedUrl);
  uploadedOssKeys.push(decodeURIComponent(url.pathname.replace(/^\//, '')));
}
async function cleanupOssKeys() {
  for (const key of uploadedOssKeys) {
    await new Promise((resolve) => {
      const child = spawn(
        './tools/aliyun',
        [
          'oss',
          'rm',
          `oss://${process.env.ALIBABA_CLOUD_OSS_BUCKET}/${key}`,
          '--region',
          process.env.ALIBABA_CLOUD_REGION,
          '--endpoint',
          process.env.ALIBABA_CLOUD_OSS_ENDPOINT,
          '-f',
        ],
        { cwd: repoRoot, stdio: 'ignore' },
      );
      child.on('exit', () => resolve());
      child.on('error', () => resolve());
    });
  }
}

let serverProcess;
let serverLog = '';
let browser;

// 生产构建（next build + next start）而非 next dev：dev 模式下真实测得 Fast
// Refresh 会在本次三段式上传（POST assets → PUT OSS → confirm → download）的
// 网络请求窗口内触发页面级热替换，导致异步链路完成后 setState 落在已被替换的
// React 组件实例上而丢失（图片 src 永远停在中间态），不是应用代码缺陷——同一份
// 代码在 next build + next start 下完整走通（已用独立脚本验证）。生产构建也更
// 贴近「真实浏览器上传」验收要求验证的部署形态。
async function buildOnce() {
  await new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'next', 'build'], {
      cwd: webRoot,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        BETTER_AUTH_SECRET: 'g2-e2e-only-secret-at-least-thirty-two-characters',
        BETTER_AUTH_URL: BASE_URL,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buildLog = '';
    child.stdout.on('data', (chunk) => { buildLog += chunk.toString(); });
    child.stderr.on('data', (chunk) => { buildLog += chunk.toString(); });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`next build 失败（exit ${code}）\n${buildLog.slice(-5000)}`));
    });
  });
}

function spawnServer() {
  const child = spawn('pnpm', ['exec', 'next', 'start', '-H', '127.0.0.1', '-p', PORT], {
    cwd: webRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      SMS_CHANNEL: 'log',
      BETTER_AUTH_SECRET: 'g2-e2e-only-secret-at-least-thirty-two-characters',
      BETTER_AUTH_URL: BASE_URL,
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
    throw new Error(`Upload OSS e2e server 未就绪\n${serverLog.slice(-5000)}`);
  }
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

async function bootLandingProject(page) {
  await page.goto(`${BASE_URL}/`, { timeout: 60_000 });
  await page.waitForFunction(() => new URLSearchParams(window.location.search).has('project'), null, {
    timeout: 15_000,
  });
  return page.evaluate(() => new URLSearchParams(window.location.search).get('project'));
}

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test.before(async () => {
  await buildOnce();
  serverProcess = spawnServer();
  await waitForServerReady();
  browser = process.env.PLAYWRIGHT_WS_ENDPOINT
    ? await chromium.connect(process.env.PLAYWRIGHT_WS_ENDPOINT)
    : await chromium.launch();
});

test.after(async () => {
  await browser?.close();
  await killServer();
  await cleanupOssKeys();
});

test('landing 宠物照上传走 v1 Asset 链：预览图是 OSS 签名 URL，不打旧 upload 路由', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const legacyUploadRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/project/') && request.url().includes('/upload')) {
      legacyUploadRequests.push(request.url());
    }
  });
  try {
    await login(page, PHONE_OWNER);
    await bootLandingProject(page);

    const creatorSection = page.locator('.pet-creator-section');
    await creatorSection.scrollIntoViewIfNeeded();

    // ImageDropzone 渲染为兄弟 fragment（<button class="upload-pet-card">…</button><input …/>），
    // input 不是 button 的子节点，需在共同父容器 .creator-controls 内定位。
    const fileInput = creatorSection.locator('.creator-controls:has(.upload-pet-card) input[type="file"]');
    await fileInput.setInputFiles({ name: 'pet.png', mimeType: 'image/png', buffer: PNG_1x1 });

    // 上传流程先用本地 blob: URL 做即时预览（onPetImageUpload(file)），异步三段式
    // 上传完成后才替换为真实签名 URL——等待 src 变成 https:// 前缀，而不是仅等
    // <img> 出现（否则会命中中间态的 blob: 预览）。
    const previewImg = creatorSection.locator('.upload-pet-card img');
    await previewImg.waitFor({ timeout: 15_000 });
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.getAttribute('src')?.startsWith('https://'),
      '.upload-pet-card img',
      { timeout: 20_000 },
    );
    const src = await previewImg.getAttribute('src');
    assert.ok(src, '上传后应出现预览图 src');
    trackOssKeyFromSignedUrl(src);
    assert.doesNotMatch(src, /^\/uploads\//, `预览图不应再指向旧本地路径，实际 ${src}`);
    assert.match(src, /^https:\/\//, `预览图应是完整的 OSS 签名 URL，实际 ${src}`);
    assert.match(src, /Signature=|x-oss-signature/i, `预览图 URL 应携带 OSS 签名参数，实际 ${src}`);

    assert.deepEqual(
      legacyUploadRequests,
      [],
      `不应再触发旧 upload 路由请求，实际捕获：${JSON.stringify(legacyUploadRequests)}`,
    );

    // 直接访问该签名 URL 应可下载 200（验证确实是可用的私有资产签名链接）。
    const directRes = await fetch(src);
    assert.equal(directRes.status, 200, `预览图签名 URL 应可直接下载 200，实际 ${directRes.status}`);
  } finally {
    await context.close();
  }
});

test('上传的资产在服务重启后仍可下载（内容持久化于 OSS+数据库，不依赖进程内存）；跨账号访问该 assetId 返回 404', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  let downloadUrl;
  let assetId;
  try {
    await login(page, PHONE_RESTART_OWNER);
    const projectId = await bootLandingProject(page);

    const creatorSection = page.locator('.pet-creator-section');
    await creatorSection.scrollIntoViewIfNeeded();
    // ImageDropzone 渲染为兄弟 fragment（<button class="upload-pet-card">…</button><input …/>），
    // input 不是 button 的子节点，需在共同父容器 .creator-controls 内定位。
    const fileInput = creatorSection.locator('.creator-controls:has(.upload-pet-card) input[type="file"]');
    await fileInput.setInputFiles({ name: 'restart-check.png', mimeType: 'image/png', buffer: PNG_1x1 });
    const previewImg = creatorSection.locator('.upload-pet-card img');
    await previewImg.waitFor({ timeout: 15_000 });
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.getAttribute('src')?.startsWith('https://'),
      '.upload-pet-card img',
      { timeout: 20_000 },
    );
    downloadUrl = await previewImg.getAttribute('src');
    trackOssKeyFromSignedUrl(downloadUrl);

    const listRes = await page.evaluate(async (pid) => {
      const response = await fetch(`/api/v1/projects/${pid}/assets`);
      return { status: response.status, body: await response.json().catch(() => null) };
    }, projectId);
    assert.equal(listRes.status, 200);
    assert.ok(listRes.body.assets.length >= 1, '上传后项目资产列表应至少含一条 available 资产');
    assetId = listRes.body.assets[0].id;
  } finally {
    await context.close();
  }

  // 杀服务器重启，模拟进程重启（内存 store 清零）。
  await killServer();
  serverProcess = spawnServer();
  await waitForServerReady();

  const restartRes = await fetch(downloadUrl);
  assert.equal(restartRes.status, 200, `重启后原下载 URL 应仍可用，实际 ${restartRes.status}`);

  // 重启后用同一 assetId 走越权账号，应 404（不是 200 且不是泄漏 owner 判断之外的成功响应）。
  const foreignContext = await browser.newContext();
  const foreignPage = await foreignContext.newPage();
  try {
    await login(foreignPage, PHONE_FOREIGN);
    const foreignRes = await foreignPage.evaluate(async (id) => {
      const response = await fetch(`/api/v1/assets/${id}/download`);
      return { status: response.status, body: await response.json().catch(() => null) };
    }, assetId);
    assert.equal(foreignRes.status, 404, '越权账号访问该 assetId 的下载端点应 404');
    assert.equal(foreignRes.body.error, 'not_found');
  } finally {
    await foreignContext.close();
  }
});

test('QA 修复：POST assets 拒绝客户端注入 kind 字段（strictObject 400）；confirm 后 checksum 落地、mime 与真实字节不符时 409', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await login(page, PHONE_KIND);
    const projectId = await bootLandingProject(page);

    // 1) 客户端在 body 里注入 kind=generated_render——contracts CreateAssetUploadRequestSchema
    // 是 strictObject（只列 filename/mime/size），多余字段应直接 400，而不是被路由层
    // 原样转发给 requestAssetUpload。
    const injectedKindRes = await page.evaluate(async (pid) => {
      const response = await fetch(`/api/v1/projects/${pid}/assets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filename: 'evil.png',
          mime: 'image/png',
          size: 100,
          kind: 'generated_render',
        }),
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    }, projectId);
    assert.equal(injectedKindRes.status, 400, '注入 kind 字段应被 strictObject 契约拒绝（400）');
    assert.equal(injectedKindRes.body.error, 'invalid_request');

    // 2) 正常请求（不含 kind）应成功，且服务端固定裁定 kind=upload_raw。
    const requestRes = await page.evaluate(async (pid) => {
      const response = await fetch(`/api/v1/projects/${pid}/assets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filename: 'kind-check.png', mime: 'image/png', size: 68 }),
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    }, projectId);
    assert.equal(requestRes.status, 201);
    assert.equal(requestRes.body.asset.kind, 'upload_raw', 'kind 应由服务端固定裁定为 upload_raw');
    assert.equal(requestRes.body.asset.checksum, null, 'pending 阶段 checksum 应为 null');

    const putRes = await page.evaluate(
      async ({ uploadUrl, base64 }) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const response = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/png' },
          body: bytes,
        });
        return { status: response.status };
      },
      { uploadUrl: requestRes.body.uploadUrl, base64: PNG_1x1.toString('base64') },
    );
    assert.equal(putRes.status, 200);

    // 3) confirm 后 checksum 应落地非空（OSS ETag）。
    const confirmRes = await page.evaluate(async (assetId) => {
      const response = await fetch(`/api/v1/assets/${assetId}/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    }, requestRes.body.asset.id);
    assert.equal(confirmRes.status, 200);
    assert.ok(confirmRes.body.checksum, 'confirm 后 checksum 应落地非空（ADR-0005：保存校验值）');

    trackOssKeyFromSignedUrl(requestRes.body.uploadUrl);

    // 4) 声明 mime=image/jpeg 但真实字节是 PNG 魔数——confirm 应 409 拒绝。
    const forgedRequestRes = await page.evaluate(async (pid) => {
      const response = await fetch(`/api/v1/projects/${pid}/assets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filename: 'forged.jpg', mime: 'image/jpeg', size: 68 }),
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    }, projectId);
    assert.equal(forgedRequestRes.status, 201);
    trackOssKeyFromSignedUrl(forgedRequestRes.body.uploadUrl);

    const forgedPutRes = await page.evaluate(
      async ({ uploadUrl, base64 }) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const response = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
          body: bytes,
        });
        return { status: response.status };
      },
      { uploadUrl: forgedRequestRes.body.uploadUrl, base64: PNG_1x1.toString('base64') },
    );
    assert.equal(forgedPutRes.status, 200);

    const forgedConfirmRes = await page.evaluate(async (assetId) => {
      const response = await fetch(`/api/v1/assets/${assetId}/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    }, forgedRequestRes.body.asset.id);
    assert.equal(forgedConfirmRes.status, 409, '声明 mime 与真实字节魔数不符应 409');
    assert.equal(forgedConfirmRes.body.error, 'verification_failed');
  } finally {
    await context.close();
  }
});

test('旧 upload 路由与静态服务路由已退役（404）', async () => {
  const uploadRouteRes = await fetch(`${BASE_URL}/api/project/legacy-id/upload`, { method: 'POST' });
  assert.equal(uploadRouteRes.status, 404, `旧 upload 路由应已退役返回 404，实际 ${uploadRouteRes.status}`);

  const staticRouteRes = await fetch(`${BASE_URL}/uploads/legacy-id/pet.jpg`);
  assert.equal(staticRouteRes.status, 404, `旧静态 uploads 路由应已退役返回 404，实际 ${staticRouteRes.status}`);
});
