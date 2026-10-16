import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkMiniappReady } from '../check-miniapp-ready.mjs';

const appId = 'wx0123456789abcdef';
const secret = '0123456789abcdef0123456789abcdef';
async function fixture(t, { config = {}, appid = appId, privateSettings = {}, env } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'petscape-ready-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith('petscape-ready-'));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path.join(root, 'miniapp/utils'), { recursive: true });
  await writeFile(path.join(root, 'miniapp/utils/config.js'), 'module.exports = ' + JSON.stringify({
    accountType: 'personal', webViewEnabled: false, mockMode: false, apiBaseUrl: 'https://api.example.com', ...config,
  }));
  await writeFile(path.join(root, 'miniapp/project.config.json'), JSON.stringify({ appid, setting: { urlCheck: true } }));
  await writeFile(path.join(root, 'miniapp/project.private.config.json'), JSON.stringify({ setting: privateSettings }));
  await writeFile(path.join(root, '.env'), env ?? `WECHAT_MINIPROGRAM_APP_ID=${appId}\nWECHAT_MINIPROGRAM_APP_SECRET=${secret}\n`);
  return root;
}
const missing = (report) => report.checks.filter((item) => item.status === 'missing').map((item) => item.id);

test('complete local configuration stays separate from external verification and is read only', async (t) => {
  const root = await fixture(t);
  const before = await readFile(path.join(root, '.env'));
  const report = await checkMiniappReady(root, {});
  assert.equal(report.configurationReady, true);
  assert.ok(report.externalVerification.some((item) => item.includes('真机')));
  assert.deepEqual(await readFile(path.join(root, '.env')), before);
  for (const value of [secret, appId]) assert.equal(JSON.stringify(report).includes(value), false);
});

test('tourist mock setup reports concrete missing configuration', async (t) => {
  const root = await fixture(t, { appid: 'touristappid', config: { mockMode: true }, env: '' });
  assert.deepEqual(missing(await checkMiniappReady(root, {})), ['appid', 'backend-appid', 'backend-secret', 'mock-mode']);
});

test('environment overrides local .env and a mismatch is rejected without leaking credentials', async (t) => {
  const root = await fixture(t);
  const report = await checkMiniappReady(root, { WECHAT_MINIPROGRAM_APP_ID: 'wxabcdef0123456789', WECHAT_MINIPROGRAM_APP_SECRET: 'private-value' });
  assert.deepEqual(missing(report), ['backend-appid', 'backend-secret']);
  assert.equal(JSON.stringify(report).includes('private-value'), false);
});

test('private settings cannot disable domain checks and personal accounts cannot enable web-view', async (t) => {
  const root = await fixture(t, { config: { webViewEnabled: true }, privateSettings: { urlCheck: false } });
  assert.deepEqual(missing(await checkMiniappReady(root, {})), ['url-check', 'account-capabilities']);
});

test('API origin rejects URL credentials, paths, queries and local addresses', async (t) => {
  for (const apiBaseUrl of ['http://api.example.com', 'https://user:password@api.example.com', 'https://api.example.com/api', 'https://api.example.com?token=private', 'https://127.0.0.1', 'https://local.invalid']) {
    const root = await fixture(t, { config: { apiBaseUrl } });
    assert.deepEqual(missing(await checkMiniappReady(root, {})), ['api-origin']);
  }
});

test('current backend secret in client source blocks configuration without echoing it', async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'miniapp/leaked.js'), `const secret = '${secret}';`);
  const report = await checkMiniappReady(root, {});
  assert.deepEqual(missing(report), ['secret-location']);
  assert.equal(JSON.stringify(report).includes(secret), false);
});

test('malformed private config returns a fixed message without input values', async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'miniapp/project.private.config.json'), '{"sensitive":"private-value"');
  const report = await checkMiniappReady(root, {});
  assert.equal(report.configurationReady, false);
  assert.deepEqual(missing(report), ['read-config']);
  assert.equal(JSON.stringify(report).includes('private-value'), false);
});

test('organization web-view requires a configured web origin', async (t) => {
  const root = await fixture(t, { config: { accountType: 'organization', webViewEnabled: true } });
  assert.deepEqual(missing(await checkMiniappReady(root, {})), ['web-origin']);
});
