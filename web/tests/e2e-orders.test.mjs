import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  B7_SANDBOX_SCENE_CONFIRMATION_ID, acceptQuote, bootstrapFirstAdmin, completeCheckRun,
  confirmDeliveryAddress, createCheckRun, createCustomizationRequest, createQuote,
  createSandboxEstimateJob, saveDeliveryAddress, startCheckRun,
} from '../../packages/server/src/application/index.ts';
import { createPrismaClient } from '../../packages/server/src/infra/db/index.ts';

const webRoot = fileURLToPath(new URL('../', import.meta.url));
const PORT = process.env.E2E_C4_PORT ?? '3430';
const BASE = `http://127.0.0.1:${PORT}`;
const DIR = fileURLToPath(new URL('../test-results/c4-orders/', import.meta.url));
const phoneSeed = Number(BigInt(Date.now()) % 100000000n);
const defaultPhones = `136${String(phoneSeed).padStart(8, '0')},136${String((phoneSeed + 1) % 100000000).padStart(8, '0')}`;
const PHONES = (process.env.E2E_C4_PHONES ?? defaultPhones).split(',');
if (!process.env.DATABASE_URL) throw new Error('C4 browser e2e 需要 PostgreSQL');
if (!process.env.SANDBOX_PAYMENT_SECRET) throw new Error('C4 browser e2e 需要动态测试 secret');
const prisma = createPrismaClient({ connectionString: process.env.DATABASE_URL, poolMax: 8 });
let child, log = '', browser;

const waitExit = (process, ms) => process.exitCode !== null ? Promise.resolve(true) : Promise.race([
  new Promise((resolve) => process.once('exit', () => resolve(true))), sleep(ms).then(() => false),
]);
function signal(childProcess, value) { try { process.kill(-childProcess.pid, value); } catch (error) { if (error?.code !== 'ESRCH') throw error; } }
async function stop() { if (!child || child.exitCode !== null) return; const graceful = waitExit(child, 2000); signal(child, 'SIGTERM'); if (await graceful) return; const forced = waitExit(child, 2000); signal(child, 'SIGKILL'); await forced; }
async function ready() { for (let index = 0; index < 200; index += 1) { try { if ((await fetch(`${BASE}/api/v1/commerce/orders`)).status === 401) return; } catch {} await sleep(300); } throw new Error(log.slice(-4000)); }
async function otp(phone, offset) { for (let index = 0; index < 100; index += 1) { const match = [...log.slice(offset).matchAll(new RegExp(`\\[SMS:log\\] OTP for \\+86${phone} => (\\d+)`, 'g'))].at(-1)?.[1]; if (match) return match; await sleep(150); } throw new Error('OTP missing'); }
async function login(page, phone) { await page.goto(`${BASE}/login`); await page.getByLabel('手机号').fill(phone); const offset = log.length; await page.getByRole('button', { name: '获取验证码' }).click(); await page.getByLabel('验证码').fill(await otp(phone, offset)); await page.getByRole('button', { name: '登录' }).click(); await page.waitForURL(`${BASE}/account`); }
async function api(page, path, init = {}) { return page.evaluate(async ({ path, init }) => { const response = await fetch(path, init); return { status: response.status, body: await response.json().catch(() => null) }; }, { path, init }); }

async function fixture(ownerUserId) {
  const suffix = `${Date.now()}-${Math.random()}`;
  const request = (await createCustomizationRequest({ prisma, ownerUserId, input: {
    sceneConfirmationId: B7_SANDBOX_SCENE_CONFIRMATION_ID, idempotencyKey: `c4-e2e-r-${suffix}`,
    contactName: 'C4 浏览器用户', contactPhone: '13800138000', usageDescription: 'C4 沙箱订单', additionalRequirements: null,
  } })).request;
  let admin = await prisma.user.findFirst({ where: { role: 'admin' } });
  if (!admin) { await bootstrapFirstAdmin({ prisma, targetUserId: ownerUserId, reason: 'C4 e2e' }); admin = await prisma.user.findUniqueOrThrow({ where: { id: ownerUserId } }); }
  const check = (await createCheckRun({ prisma, actorUserId: admin.id, input: { requestId: request.id } })).checkRun;
  await startCheckRun({ prisma, actorUserId: admin.id, checkRunId: check.id });
  await completeCheckRun({ prisma, actorUserId: admin.id, checkRunId: check.id, input: {
    result: 'approved', issues: [], adjustmentSuggestions: [], note: 'C4 e2e',
    evidence: [{ kind: 'note', ref: 'manual://c4-e2e', summary: 'C4' }],
  } });
  const estimate = await createSandboxEstimateJob({ prisma, ownerUserId, sceneConfirmationId: B7_SANDBOX_SCENE_CONFIRMATION_ID });
  await prisma.job.update({ where: { id: estimate.estimateJobId }, data: { status: 'succeeded', resultRef: {
    schemaVersion: 'mesh-analysis-result.v0', algorithmVersion: 'trimesh-volume.v0', geometryUnit: 'millimeter',
    assetChecksum: '8191dcdaaa3d01993df661857e388c1cbe641b5d0443d47b692a856acf6d596d',
    dimensionsMm: { x: 120, y: 119.022, z: 53.865 }, volumeMm3: 240342.387, triangleCount: 103716, watertight: true,
  } } });
  let quote = (await createQuote({ prisma, ownerUserId, input: {
    requestId: request.id, estimateJobId: estimate.estimateJobId, idempotencyKey: `c4-e2e-q-${suffix}`, quoteMode: 'sandbox_test',
  } })).quote;
  quote = await acceptQuote({ prisma, ownerUserId, quoteId: quote.id, input: { expectedStatus: 'active' } });
  const saved = await saveDeliveryAddress({ prisma, ownerUserId, input: {
    quoteId: quote.id, recipientName: 'C4 收件人', mobile: '13800138000', province: '浙江省', city: '杭州市',
    district: '余杭区', detail: '文一西路 C4 沙箱地址', postalCode: '311100',
  } });
  await confirmDeliveryAddress({ prisma, ownerUserId, addressId: saved.deliveryAddress.id, input: { expectedVersion: 1 } });
  return quote;
}

test.before(async () => {
  await mkdir(DIR, { recursive: true });
  child = spawn('pnpm', ['exec', 'next', 'dev', '-H', '127.0.0.1', '-p', PORT], {
    cwd: webRoot, detached: true,
    env: { ...process.env, NODE_ENV: 'development', SMS_CHANNEL: 'log', BETTER_AUTH_SECRET: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', BETTER_AUTH_URL: BASE, PAYMENT_PROVIDER_MODE: 'sandbox', ALIBABA_CLOUD_ACCESS_KEY_ID: 'c4-unused', ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'c4-unused-secret', ALIBABA_CLOUD_OSS_BUCKET: 'c4-unused-bucket', ALIBABA_CLOUD_OSS_ENDPOINT: 'oss-cn-hangzhou.aliyuncs.com', ALIBABA_CLOUD_REGION: 'cn-hangzhou', PORT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (value) => { log += value; }); child.stderr.on('data', (value) => { log += value; });
  await ready(); browser = await chromium.launch();
});
test.after(async () => { await browser?.close(); await prisma.$disconnect(); await stop(); });

test('trusted sandbox success creates one immutable order visible only to its owner', async () => {
  assert.equal((await fetch(`${BASE}/api/v1/commerce/orders`)).status, 401);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: DIR, size: { width: 1280, height: 900 } } });
  const other = await browser.newContext();
  const page = await context.newPage(); const pageB = await other.newPage();
  try {
    await login(page, PHONES[0]);
    const me = await api(page, '/api/me');
    const quote = await fixture(me.body.userId);
    await page.goto(`${BASE}/payments`);
    await page.getByRole('button', { name: '创建沙箱支付' }).click();
    await page.getByRole('link', { name: '进入沙箱支付页' }).click();
    await page.getByRole('button', { name: '模拟成功' }).click();
    await page.getByText('沙箱订单已由服务端幂等生成。').waitFor();
    await page.getByRole('link', { name: '查看沙箱订单' }).click();
    await page.getByText('已支付（沙箱）').waitFor();
    await page.getByText('文一西路 C4 沙箱地址').waitFor();
    await page.getByText('¥330.00').waitFor();
    await page.getByText('不会进入真实生产或物流', { exact: true }).waitFor();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${DIR}/c4-sandbox-order-paid.png`, fullPage: true });
    const orders = await api(page, '/api/v1/commerce/orders');
    const order = orders.body.orders.find((item) => item.quoteId === quote.id);
    assert.equal(order.status, 'paid'); assert.equal(order.sandboxOnly, true); assert.equal(order.history.length, 1);
    assert.equal(order.deliveryAddressSnapshot.fields.detail, '文一西路 C4 沙箱地址');
    assert.equal(await page.getByText(/真实生产|真实物流/).count() > 0, true);
    assert.equal(await page.getByRole('button', { name: /发货|生产|真实支付/ }).count(), 0);
    await login(pageB, PHONES[1]);
    assert.equal((await api(pageB, `/api/v1/commerce/orders/${order.id}`)).status, 404);
    assert.equal((await api(pageB, `/api/v1/commerce/orders/${order.id}/cancel`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedStatus: 'paid' }),
    })).status, 404);
    await page.getByRole('button', { name: '取消沙箱订单' }).click();
    await page.getByText('已取消（沙箱）').waitFor();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${DIR}/c4-sandbox-order-canceled.png`, fullPage: true });
    const canceled = await api(page, `/api/v1/commerce/orders/${order.id}`);
    assert.equal(canceled.body.status, 'canceled');
    assert.equal(canceled.body.history.length, 2);
    assert.equal(canceled.body.history[1].actorUserId, me.body.userId);
  } finally { await context.close(); await other.close(); }
});
