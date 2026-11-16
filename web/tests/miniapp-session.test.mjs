import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const filename = new URL('../../miniapp/utils/request.js', import.meta.url);
const require = createRequire(filename);

function client({ token, login, request }) {
  const storage = new Map(token ? [['petscape_session_token', token]] : []);
  const nativeModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: nativeModule, require,
    getApp: () => ({ globalData: { mockMode: false, apiBaseUrl: 'https://api.example.com' } }),
    wx: {
      getStorageSync: (key) => storage.get(key),
      setStorageSync: (key, value) => storage.set(key, value),
      removeStorageSync: (key) => storage.delete(key),
      login,
      request(options) {
        if (options.url.endsWith('/analytics/events')) return options.success({ statusCode: 202, data: {} });
        request(options);
      },
    },
  });
  return { api: nativeModule.exports, storage };
}

const unauthorized = (options) => options.success({ statusCode: 401, data: { error: 'unauthorized' } });
const succeed = (options, data) => options.success({ statusCode: 200, data });

test('expired session recovers the current read through one fresh wx.login', async () => {
  let logins = 0; let reads = 0;
  const c = client({ token: 'expired', login: ({ success }) => { logins++; success({ code: 'fresh-code' }); }, request(options) {
    if (options.url.endsWith('/auth/login')) return succeed(options, { sessionToken: 'fresh' });
    reads++;
    if (options.header['X-PetScape-Session'] === 'expired') return unauthorized(options);
    succeed(options, { pets: [{ id: 'own-pet' }] });
  } });
  const result = await c.api.listPets();
  assert.equal(result.pets[0].id, 'own-pet');
  assert.equal(logins, 1); assert.equal(reads, 2);
});

test('a delayed old 401 cannot erase the new session or start a second login', async () => {
  const oldRequests = []; let logins = 0;
  const c = client({ token: 'expired', login: ({ success }) => { logins++; queueMicrotask(() => success({ code: 'code' })); }, request(options) {
    if (options.url.endsWith('/auth/login')) return succeed(options, { sessionToken: 'fresh' });
    if (options.header['X-PetScape-Session'] === 'expired') oldRequests.push(options);
    else succeed(options, { pets: [] });
  } });
  const first = c.api.listPets(); const second = c.api.listPets();
  await Promise.resolve();
  unauthorized(oldRequests[0]); await first;
  unauthorized(oldRequests[1]); await second;
  assert.equal(logins, 1); assert.equal(c.storage.get('petscape_session_token'), 'fresh');
});

test('concurrent unauthorized reads share an in-flight session exchange', async () => {
  let finishLogin; let logins = 0;
  const c = client({ token: 'expired', login: ({ success }) => { logins++; finishLogin = success; }, request(options) {
    if (options.url.endsWith('/auth/login')) return succeed(options, { sessionToken: 'fresh' });
    if (options.header['X-PetScape-Session'] === 'expired') return unauthorized(options);
    succeed(options, { pets: [] });
  } });
  const pending = Promise.allSettled([c.api.listPets(), c.api.listPets()]);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(logins, 1); finishLogin({ code: 'shared-code' });
  const results = await pending;
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 2);
});

test('a second unauthorized response stops recovery without an infinite retry', async () => {
  let logins = 0; let reads = 0;
  const c = client({ token: 'expired', login: ({ success }) => { logins++; success({ code: 'code' }); }, request(options) {
    if (options.url.endsWith('/auth/login')) return succeed(options, { sessionToken: 'still-invalid' });
    reads++; unauthorized(options);
  } });
  await assert.rejects(c.api.listPets(), (error) => error.statusCode === 401);
  assert.equal(logins, 1); assert.equal(reads, 2);
  assert.equal(c.storage.has('petscape_session_token'), false);
});

test('explicit pre-write unauthorized response retries a save with only one persisted effect', async () => {
  let writes = 0; let persisted = 0;
  const c = client({ token: 'expired', login: ({ success }) => success({ code: 'code' }), request(options) {
    if (options.url.endsWith('/auth/login')) return succeed(options, { sessionToken: 'fresh' });
    writes++;
    if (options.header['X-PetScape-Session'] === 'expired') return unauthorized(options);
    persisted++; succeed(options, { id: 'saved' });
  } });
  assert.equal((await c.api.createPet({ name: '团子', speciesCode: 'rat' })).id, 'saved');
  assert.equal(writes, 2); assert.equal(persisted, 1);
});

test('network failures, server errors, forbidden responses and ambiguous 401 never replay writes', async () => {
  for (const kind of ['network', 'server', 'forbidden', 'unknown-401']) {
    let writes = 0; let logins = 0;
    const c = client({ token: 'valid', login: () => { logins++; }, request(options) {
      writes++;
      if (kind === 'network') return options.fail({ errMsg: 'request:fail timeout' });
      options.success({ statusCode: kind === 'server' ? 500 : kind === 'forbidden' ? 403 : 401, data: { error: 'other' } });
    } });
    await assert.rejects(c.api.createPet({ name: '团子' }));
    assert.equal(writes, 1, kind); assert.equal(logins, 0, kind);
  }
});

test('public endpoint 401 leaves the protected session intact and never triggers login', async () => {
  const c = client({ token: 'valid', login: () => assert.fail('public request must not log in'), request: unauthorized });
  await assert.rejects(c.api.listArticles());
  assert.equal(c.storage.get('petscape_session_token'), 'valid');
});

test('login failure is identified before any HTTP request and retries remain possible', async () => {
  let failLogin = true;
  const c = client({ login({ success, fail }) {
    if (failLogin) fail({ errMsg: 'login:fail timeout private-token' });
    else success({ code: 'code' });
  }, request(options) {
    succeed(options, options.url.endsWith('/auth/login') ? { sessionToken: 'fresh' } : { pets: [] });
  } });
  await assert.rejects(c.api.listPets(), (error) => error.code === 'WX_LOGIN_TIMEOUT' && error.stage === 'wx-login');
  failLogin = false;
  assert.equal((await c.api.listPets()).pets.length, 0);
});

test('transport failures carry safe categories and separate session exchange from pet API', async () => {
  for (const [errMsg, code] of [
    ['request:fail url not in domain list', 'DOMAIN_NOT_ALLOWED'],
    ['request:fail timeout', 'REQUEST_TIMEOUT'],
    ['request:fail ssl hand shake error', 'TLS_FAILED'],
    ['request:fail ERR_NAME_NOT_RESOLVED', 'DNS_FAILED'],
    ['request:fail disconnected', 'NETWORK_FAILED'],
  ]) {
    for (const token of [undefined, 'valid']) {
      const c = client({ token, login: ({ success }) => success({ code: 'code' }), request(options) { options.fail({ errMsg }); } });
      await assert.rejects(c.api.listPets(), (error) => error.code === code && error.stage === (token ? 'api' : 'session-exchange'));
    }
  }
});

test('page diagnostics never echo tokens, codes, URLs or arbitrary server error details', () => {
  const { describeError } = require('../../miniapp/utils/errors.js');
  const privateValue = 'private-credential-value';
  const diagnostic = describeError({
    stage: 'session-exchange', statusCode: 503,
    data: { error: 'wechat_login_not_configured', detail: privateValue },
    requestId: 'token=' + privateValue, errMsg: 'request:fail url not in domain list ' + privateValue,
  });
  assert.match(diagnostic.loadErrorTitle, /域名/);
  assert.match(diagnostic.loadErrorDetail, /DOMAIN_NOT_ALLOWED.*建立会话/);
  assert.equal(JSON.stringify(diagnostic).includes(privateValue), false);
  const withId = describeError({ statusCode: 500, requestId: '12345678-abcd-1234-abcd-123456789abc' });
  assert.match(withId.loadErrorDetail, /12345678-abcd-1234-abcd-123456789abc/);
});

test('session exchange rejection is categorized once without requesting business data or retrying login', async () => {
  let logins = 0; let exchanges = 0;
  const c = client({ login: ({ success }) => { logins++; success({ code: 'code' }); }, request(options) {
    assert.match(options.url, /auth\/login$/); exchanges++;
    options.success({ statusCode: 401, data: { error: 'wechat_login_failed', detail: 'private-value' } });
  } });
  await assert.rejects(c.api.listPets(), (error) => error.code === 'WECHAT_REJECTED' && error.stage === 'session-exchange');
  assert.equal(logins, 1); assert.equal(exchanges, 1);
});
