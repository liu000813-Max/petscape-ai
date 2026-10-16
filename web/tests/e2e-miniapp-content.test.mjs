// Real HTTP + PostgreSQL acceptance. Session fixtures do not simulate wx.login.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { createPrismaClient } from '../../packages/server/src/infra/db/index.ts';
import { bootstrapFirstAdmin } from '../../packages/server/src/application/check-runs.ts';
import { PetResponseSchema } from '../../packages/server/src/contracts/pets.ts';
import { CommunityPostListResponseSchema, AnalyticsSummaryResponseSchema } from '../../packages/server/src/contracts/community-content.ts';

const base = new URL(process.env.PETSCAPE_HTTP_TEST_URL || 'http://invalid');
const database = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
assert.equal(base.hostname, '127.0.0.1', 'Use scripts/local-postgres.ps1 http');
assert.equal(database.hostname, '127.0.0.1');
assert.equal(database.port, '55432');
assert.match(database.pathname, /^\/petscape_http_\d+_[a-f0-9]+$/);
assert.ok(process.env.BETTER_AUTH_SECRET);
const prisma = createPrismaClient({ connectionString: database.href, poolMax: 3 });
const run = 'http-' + randomBytes(6).toString('hex');
const users = Object.fromEntries(['owner', 'other', 'admin'].map((role) => [role, run + '-' + role]));
const tokens = Object.fromEntries(['owner', 'other', 'admin', 'expired'].map((role) => [role, randomBytes(32).toString('hex')]));
const nativeHeaders = (role) => ({ 'X-PetScape-Session': tokens[role] });
const cookieHeaders = (role) => {
  const signature = createHmac('sha256', process.env.BETTER_AUTH_SECRET).update(tokens[role]).digest('base64');
  return { cookie: 'better-auth.session_token=' + encodeURIComponent(tokens[role] + '.' + signature) };
};

async function http(path, { method = 'GET', data, headers = {}, raw } = {}, expected = 200) {
  const response = await fetch(new URL(path, base), {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: raw ?? (data === undefined ? undefined : JSON.stringify(data)),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); }
  catch { assert.fail(`${method} ${path}: HTTP ${response.status} did not return JSON`); }
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(body)}`);
  if (path.startsWith('/api/v1/')) assert.match(response.headers.get('x-request-id'), /^[a-f0-9-]{36}$/);
  return body;
}

async function nativeClient(role) {
  const storage = new Map([['petscape_session_token', tokens[role]]]);
  const pending = new Set();
  const nativeModule = { exports: {} };
  // Exercise the actual native request module with mockMode=false. Only wx's HTTP
  // transport/storage are adapted to Node; real WeChat SDK/device tests are separate.
  const sandbox = {
    module: nativeModule, require: createRequire(new URL('../../miniapp/utils/request.js', import.meta.url)),
    getApp: () => ({ globalData: { mockMode: false, apiBaseUrl: base.origin } }),
    wx: {
      getStorageSync: (key) => storage.get(key),
      setStorageSync: (key, value) => storage.set(key, value),
      removeStorageSync: (key) => storage.delete(key),
      login: () => assert.fail('Fixture session must not call wx.login'),
      request(options) {
        const task = (async () => {
          const url = new URL(options.url);
          if (options.method === 'GET') for (const [key, value] of Object.entries(options.data || {})) url.searchParams.set(key, value);
          try {
            const response = await fetch(url, {
              method: options.method, headers: options.header,
              body: options.method === 'GET' ? undefined : JSON.stringify(options.data),
              signal: AbortSignal.timeout(15000),
            });
            options.success({ statusCode: response.status, data: await response.json(), header: Object.fromEntries(response.headers) });
          } catch (error) { options.fail(error); }
        })();
        pending.add(task);
        task.finally(() => pending.delete(task));
      },
    },
  };
  vm.runInNewContext(await readFile(new URL('../../miniapp/utils/request.js', import.meta.url), 'utf8'), sandbox);
  return { api: nativeModule.exports, storage, drain: async () => { while (pending.size) await Promise.all([...pending]); } };
}

const moderate = (contentType, id, status) => http('/api/v1/admin/content/moderate', {
  method: 'POST', headers: cookieHeaders('admin'), data: { contentType, id, status },
});

test.before(async () => {
  await prisma.user.createMany({ data: Object.values(users).map((id) => ({ id, name: 'HTTP 测试用户', email: id + '@example.test' })) });
  await bootstrapFirstAdmin({ prisma, targetUserId: users.admin, reason: 'Isolated HTTP acceptance fixture' });
  await prisma.session.createMany({ data: Object.entries(tokens).map(([role, token]) => ({
    id: randomUUID(), token, userId: users[role] || users.owner,
    expiresAt: new Date(Date.now() + (role === 'expired' ? -60000 : 3600000)),
  })) });
});
test.after(async () => { await prisma.$disconnect(); });

test('health, missing/invalid/expired sessions and unconfigured WeChat login have explicit HTTP results', async () => {
  const health = await http('/api/healthz');
  assert.equal(health.ok, true); assert.equal(health.db, true);
  for (const headers of [{}, { 'X-PetScape-Session': 'invalid' }, nativeHeaders('expired')]) {
    assert.equal((await http('/api/v1/pets', { headers }, 401)).error, 'unauthorized');
    await http('/api/v1/care-logs', { headers }, 401);
    await http('/api/v1/care-reminders', { headers }, 401);
  }
  await http('/api/miniapp/auth/login', { method: 'POST', raw: '{' }, 400);
  for (const data of [{}, { code: 123 }, { code: '  ' }, null, [], 'invalid', 123]) await http('/api/miniapp/auth/login', { method: 'POST', data }, 400);
  assert.equal((await http('/api/miniapp/auth/login', { method: 'POST', data: { code: 'fixture-not-a-wechat-code' } }, 503)).error, 'wechat_login_not_configured');
});

test('native request module persists all six pet categories and rejects cross-owner access', async () => {
  const owner = await nativeClient('owner');
  const other = await nativeClient('other');
  try {
    for (const speciesCode of ['rat', 'gecko', 'snake', 'parrot', 'spider', 'other']) {
      const pet = await owner.api.createPet({ name: 'HTTP ' + speciesCode, speciesCode, ...(speciesCode === 'other' ? { customSpeciesName: '刺猬' } : {}) });
      PetResponseSchema.parse(pet);
      assert.equal(pet.coverUrl, null);
      assert.equal((await prisma.pet.findUniqueOrThrow({ where: { id: pet.id } })).ownerUserId, users.owner);
      assert.equal((await owner.api.getPet(pet.id)).speciesCode, speciesCode);
      await assert.rejects(other.api.getPet(pet.id), (error) => error.statusCode === 404 && Boolean(error.requestId));
      await http('/api/v1/pets/' + pet.id, { method: 'PATCH', headers: nativeHeaders('other'), data: { name: '越权' } }, 404);
      await http('/api/v1/pets/' + pet.id, { method: 'DELETE', headers: nativeHeaders('other') }, 404);
      assert.equal((await owner.api.updatePet(pet.id, { name: '已更新' })).name, '已更新');
    }
    assert.equal((await owner.api.listPets()).pets.length, 6);
    assert.equal((await other.api.listPets()).pets.length, 0);
  } finally { await owner.drain(); await other.drain(); }
});

test('moderation and concurrent likes work through native transport and Web admin cookies', async () => {
  const owner = await nativeClient('owner');
  try {
    const post = await owner.api.createCommunityPost({ title: '宠境分享', body: '真实 HTTP 测试', topic: run, speciesCode: 'rat' });
    assert.equal(post.status, 'pending');
    assert.equal((await owner.api.listCommunityPosts({ topic: run })).posts.length, 0);
    await http('/api/v1/community/posts/' + post.id, {}, 404);
    await http('/api/v1/community/posts', { method: 'POST', data: { title: '未登录', body: '测试', topic: run } }, 401);
    for (const [headers, status] of [[{}, 401], [nativeHeaders('admin'), 401], [cookieHeaders('owner'), 403]]) {
      await http('/api/v1/admin/content/moderate', { method: 'POST', headers, data: { contentType: 'post', id: post.id, status: 'published' } }, status);
    }
    await moderate('post', post.id, 'published');
    const posts = await owner.api.listCommunityPosts({ topic: run });
    CommunityPostListResponseSchema.parse(posts);
    assert.equal(posts.posts[0].id, post.id);
    const comment = await owner.api.createCommunityComment(post.id, { body: '待审评论' });
    assert.equal((await owner.api.listCommunityComments(post.id)).comments.length, 0);
    await moderate('comment', comment.id, 'published');
    assert.equal((await owner.api.listCommunityComments(post.id)).comments[0].id, comment.id);
    await Promise.all(Array.from({ length: 10 }, () => owner.api.toggleCommunityPostLike(post.id, true)));
    assert.equal(await prisma.communityPostLike.count({ where: { postId: post.id, ownerUserId: users.owner } }), 1);
    assert.equal((await owner.api.listCommunityPosts({ topic: run })).posts[0].liked, true);
    await Promise.all(Array.from({ length: 4 }, () => owner.api.toggleCommunityPostLike(post.id, false)));
    assert.equal(await prisma.communityPostLike.count({ where: { postId: post.id } }), 0);
    await moderate('post', post.id, 'archived');
    for (const suffix of ['', '/comments']) await http('/api/v1/community/posts/' + post.id + suffix, {}, 404);
    await http('/api/v1/community/posts/' + post.id + '/comments', { method: 'POST', headers: nativeHeaders('owner'), data: { body: '不能写入' } }, 404);
    await http('/api/v1/community/posts/' + post.id + '/like', { method: 'POST', headers: nativeHeaders('owner'), data: { liked: true } }, 404);
  } finally { await owner.drain(); }
});

test('care ownership, concurrent completion and pet soft deletion survive actual HTTP calls', async () => {
  const owner = await nativeClient('owner');
  const other = await nativeClient('other');
  try {
    const pet = await owner.api.createPet({ name: '养护测试', speciesCode: 'gecko' });
    const foreignPet = await other.api.createPet({ name: '另一用户', speciesCode: 'parrot' });
    const logData = { petId: pet.id, kind: '观察', recordedAt: new Date().toISOString() };
    const reminderData = { petId: pet.id, title: '饮水', dueAt: logData.recordedAt };
    const log = await owner.api.createCareLog(logData);
    const reminder = await owner.api.createCareReminder(reminderData);
    await other.api.createCareLog({ ...logData, petId: foreignPet.id });
    await other.api.createCareReminder({ ...reminderData, petId: foreignPet.id });
    await assert.rejects(other.api.createCareLog(logData), (error) => error.statusCode === 404);
    await assert.rejects(other.api.createCareReminder(reminderData), (error) => error.statusCode === 404);
    await assert.rejects(other.api.completeCareReminder(reminder.id), (error) => error.statusCode === 404);
    assert.equal((await owner.api.listCareLogs()).logs[0].id, log.id);
    assert.equal((await owner.api.listCareReminders()).reminders[0].id, reminder.id);
    assert.equal((await other.api.listCareLogs({ petId: pet.id })).logs.length, 0);
    assert.equal((await other.api.listCareReminders({ petId: pet.id })).reminders.length, 0);
    const completed = await Promise.all(Array.from({ length: 10 }, () => owner.api.completeCareReminder(reminder.id)));
    assert.equal(new Set(completed.map((item) => item.completedAt)).size, 1);
    assert.equal((await owner.api.completeCareReminder(reminder.id)).completedAt, completed[0].completedAt);
    await http('/api/v1/pets/' + pet.id, { method: 'DELETE', headers: nativeHeaders('owner') });
    assert.equal((await owner.api.listCareLogs()).logs.length, 0);
    assert.equal((await owner.api.listCareReminders()).reminders.length, 0);
    await assert.rejects(owner.api.completeCareReminder(reminder.id), (error) => error.statusCode === 404);
  } finally { await owner.drain(); await other.drain(); }
});

test('article and service directories expose only published entries and respect filters', async () => {
  for (const [contentType, input, listPath, key] of [
    ['article', { slug: run, title: '养护知识', summary: '摘要', body: '正文', category: run, speciesCode: 'rat' }, '/api/v1/content/articles?category=' + run, 'articles'],
    ['provider', { name: '测试服务', serviceType: '寄养', city: run, description: '测试' }, '/api/v1/service-providers?city=' + run, 'providers'],
  ]) {
    const data = { contentType, input };
    await http('/api/v1/admin/content', { method: 'POST', data, headers: cookieHeaders('owner') }, 403);
    const item = await http('/api/v1/admin/content', { method: 'POST', data, headers: cookieHeaders('admin') }, 201);
    assert.equal((await http(listPath))[key].length, 0);
    if (contentType === 'article') await http('/api/v1/content/articles/' + item.id, {}, 404);
    await moderate(contentType, item.id, 'published');
    assert.equal((await http(listPath))[key][0].id, item.id);
    assert.equal((await http(listPath + (contentType === 'article' ? '&speciesCode=snake' : '&serviceType=医疗')))[key].length, 0);
    await moderate(contentType, item.id, 'archived');
    assert.equal((await http(listPath))[key].length, 0);
    if (contentType === 'article') await http('/api/v1/content/articles/' + item.id, {}, 404);
  }
});

test('analytics validates input and protects admin summaries for both auth paths', async () => {
  await http('/api/v1/analytics/events', { method: 'POST', data: { eventName: 'client.error', path: '/http-test', properties: { code: 'runtime' } } }, 202);
  await http('/api/v1/analytics/events', { method: 'POST', data: { eventName: 'unknown' } }, 400);
  for (const path of ['/api/v1/admin/content?contentType=post', '/api/v1/admin/content/analytics']) {
    await http(path, {}, 401);
    await http(path, { headers: nativeHeaders('admin') }, 401);
    await http(path, { headers: cookieHeaders('owner') }, 403);
  }
  const result = await http('/api/v1/admin/content/analytics', { headers: cookieHeaders('admin') });
  AnalyticsSummaryResponseSchema.parse(result);
  assert.ok(result.recentErrors.some((item) => item.path === '/http-test'));
  assert.equal(JSON.stringify(result).includes(tokens.owner), false);
});

test('native client clears expired cached credentials after a real HTTP 401', async () => {
  const client = await nativeClient('expired');
  try {
    await assert.rejects(client.api.listPets(), (error) => error.statusCode === 401 && Boolean(error.requestId));
    assert.equal(client.storage.has('petscape_session_token'), false);
  } finally { await client.drain(); }
});
