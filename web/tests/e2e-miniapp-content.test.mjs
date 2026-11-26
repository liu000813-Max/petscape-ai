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

async function nativeClient(role, { restoreAs, loseGrowthSaveResponse = false, confirmModal } = {}) {
  const storage = new Map([['petscape_session_token', tokens[role]]]);
  const pending = new Set();
  const nativeModule = { exports: {} };
  // Exercise the actual native request module with mockMode=false. Only wx's HTTP
  // transport/storage are adapted to Node; real WeChat SDK/device tests are separate.
  const sandbox = {
    module: nativeModule, require: createRequire(new URL('../../miniapp/utils/request.js', import.meta.url)),
    getApp: () => ({ globalData: { mockMode: false, apiBaseUrl: base.origin } }),
    wx: {
      showToast() {}, setNavigationBarTitle() {}, navigateBack() {},
      showModal: confirmModal,
      getStorageSync: (key) => storage.get(key),
      setStorageSync: (key, value) => storage.set(key, value),
      removeStorageSync: (key) => storage.delete(key),
      login: ({ success, fail }) => restoreAs
        ? success({ code: 'local-session-recovery-fixture' })
        : fail({ errMsg: 'login:fail fixture recovery unavailable' }),
      request(options) {
        // This fixture replaces only the WeChat exchange, never business HTTP.
        if (restoreAs && options.url.endsWith('/api/miniapp/auth/login')) {
          options.success({ statusCode: 200, data: { sessionToken: tokens[restoreAs] } });
          return;
        }
        const task = (async () => {
          const url = new URL(options.url);
          if (options.method === 'GET') for (const [key, value] of Object.entries(options.data || {})) url.searchParams.set(key, value);
          try {
            const bytes = Object.prototype.toString.call(options.data) === '[object ArrayBuffer]';
            const response = await fetch(url, {
              method: options.method, headers: options.header,
              body: options.method === 'GET' ? undefined : bytes ? options.data : JSON.stringify(options.data),
              signal: AbortSignal.timeout(15000),
            });
            const data = await response.json();
            if (loseGrowthSaveResponse && response.status === 201 && options.method === 'POST' && url.pathname.endsWith('/growth-entries')) {
              loseGrowthSaveResponse = false;
              options.fail({ errMsg: 'request:fail fixture lost after save' });
              return;
            }
            options.success({ statusCode: response.status, data, header: Object.fromEntries(response.headers) });
          } catch (error) { options.fail(error); }
        })();
        pending.add(task);
        task.finally(() => pending.delete(task));
      },
    },
  };
  vm.runInNewContext(await readFile(new URL('../../miniapp/utils/request.js', import.meta.url), 'utf8'), sandbox);
  async function loadPage(name) {
    const source = new URL(`../../miniapp/pages/${name}/index.js`, import.meta.url);
    const localRequire = createRequire(source);
    const analytics = { exports: {} };
    vm.runInNewContext(await readFile(new URL('../../miniapp/utils/analytics.js', import.meta.url), 'utf8'), {
      ...sandbox, module: analytics, require: (id) => id === './request' ? nativeModule.exports : localRequire(id),
      getCurrentPages: () => [{ route: `pages/${name}/index` }],
    });
    let definition;
    vm.runInNewContext(await readFile(source, 'utf8'), {
      ...sandbox,
      require: (id) => id === '../../utils/request' ? nativeModule.exports : id === '../../utils/analytics' ? analytics.exports : localRequire(id),
      Page: (page) => { definition = page; },
      setTimeout,
      clearTimeout,
    }, { filename: source.pathname });
    definition.data = structuredClone(definition.data);
    definition.setData = function (values) {
      for (const [key, value] of Object.entries(values)) {
        const parts = key.split('.');
        const target = parts.slice(0, -1).reduce((object, part) => object[part], this.data);
        target[parts.at(-1)] = value;
      }
    };
    return definition;
  }
  return { api: nativeModule.exports, storage, loadPage, drain: async () => { while (pending.size) await Promise.all([...pending]); } };
}

test('native cover upload authenticates and rejects foreign pets before reading or initializing OSS', async () => {
  const pet = await http('/api/v1/pets', { method: 'POST', data: { name: run + '-cover-auth' }, headers: nativeHeaders('owner') }, 201);
  const route = `/api/v1/pets/${pet.id}/cover-upload`;
  await http(route, { method: 'POST', raw: Buffer.from([255, 216, 255]), headers: { 'content-type': 'image/jpeg' } }, 401);
  await http(route, { method: 'POST', raw: Buffer.from([255, 216, 255]), headers: { ...nativeHeaders('other'), 'content-type': 'image/jpeg' } }, 404);
  await http(route, { method: 'POST', raw: '', headers: { ...nativeHeaders('owner'), 'content-type': 'image/jpeg' } }, 400);
  await http(route, { method: 'POST', raw: 'invalid', headers: { ...nativeHeaders('owner'), 'content-type': 'image/gif' } }, 400);
  assert.equal((await prisma.asset.count({ where: { ownerUserId: users.owner } })), 0);
  await http(`/api/v1/pets/${pet.id}`, { method: 'DELETE', headers: nativeHeaders('owner') });
});

test('growth diary HTTP keeps entry ownership scoped to the selected pet', async (t) => {
  const pet = await http('/api/v1/pets', { method: 'POST', data: { name: run + '-growth-pet' }, headers: nativeHeaders('owner') }, 201);
  t.after(() => http('/api/v1/pets/' + pet.id, { method: 'DELETE', headers: nativeHeaders('owner') }));
  const foreign = await http('/api/v1/pets', { method: 'POST', data: { name: run + '-growth-foreign' }, headers: nativeHeaders('other') }, 201);
  t.after(() => http('/api/v1/pets/' + foreign.id, { method: 'DELETE', headers: nativeHeaders('other') }));
  const ownPath = `/api/v1/pets/${pet.id}/growth-entries`;
  const foreignPath = `/api/v1/pets/${foreign.id}/growth-entries`;
  await http(ownPath, {}, 401);
  await http(ownPath, { method: 'POST', data: { note: 'unauthenticated', photoAssetIds: [] } }, 401);
  await http(ownPath, { headers: nativeHeaders('other') }, 404);
  await http(foreignPath, { method: 'POST', headers: nativeHeaders('owner'), data: { note: 'foreign pet', photoAssetIds: [] } }, 404);
  await http(ownPath, { method: 'POST', headers: nativeHeaders('owner'), data: { note: null, photoAssetIds: [] } }, 400);
  const owner = await nativeClient('owner');
  const other = await nativeClient('other');
  t.after(() => Promise.all([owner.drain(), other.drain()]));
  const pngHeader = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]).buffer;
  await assert.rejects(owner.api.uploadPetGrowthPhoto(foreign.id, { mime: 'image/png', bytes: pngHeader }),
    (error) => error.statusCode === 404 && Boolean(error.requestId));
  for (const mime of ['image/gif', 'image/png']) {
    await assert.rejects(owner.api.uploadPetGrowthPhoto(pet.id, { mime, bytes: new TextEncoder().encode('GIF89a').buffer }),
      (error) => error.statusCode === 400 && error.data.error === 'invalid_growth_photo');
  }

  const first = await owner.api.createPetGrowthEntry(pet.id, { note: '第一次记录', recordedAt: '2026-01-01T00:00:00.000Z' });
  const second = await owner.api.createPetGrowthEntry(pet.id, { note: '最近记录', recordedAt: '2026-02-01T00:00:00.000Z' });
  assert.equal(first.petId, pet.id);
  const listResponse = await fetch(new URL(ownPath + '?limit=1', base), { headers: nativeHeaders('owner') });
  assert.equal(listResponse.status, 200);
  assert.match(listResponse.headers.get('cache-control'), /private, no-store/);
  assert.deepEqual((await listResponse.json()).entries.map((entry) => entry.id), [second.id]);
  const nextPage = await owner.api.listPetGrowthEntries(pet.id, { limit: 1, offset: 1 });
  assert.deepEqual(nextPage.entries.map((entry) => entry.id), [first.id]);
  assert.equal(nextPage.hasMore, false);
  const changed = await owner.api.updatePetGrowthEntry(pet.id, first.id, { note: '已修改记录' });
  assert.equal(changed.note, '已修改记录');
  await http(ownPath + '/' + first.id, { method: 'PATCH', headers: nativeHeaders('other'), data: { note: '越权修改' } }, 404);
  await assert.rejects(other.api.deletePetGrowthEntry(pet.id, first.id), (error) => error.statusCode === 404);
  assert.deepEqual(await owner.api.deletePetGrowthEntry(pet.id, first.id), { deleted: true, id: first.id });
  assert.deepEqual((await owner.api.listPetGrowthEntries(pet.id)).entries.map((entry) => entry.id), [second.id]);
});

test('growth editor keeps one entry when the first save response is lost', async (t) => {
  const client = await nativeClient('owner', { loseGrowthSaveResponse: true });
  t.after(() => client.drain());
  const pet = await client.api.createPet({ name: run + '-growth-editor' });
  t.after(() => http('/api/v1/pets/' + pet.id, { method: 'DELETE', headers: nativeHeaders('owner') }));
  const form = await client.loadPage('pet-growth-edit');
  await form.onLoad({ petId: pet.id });
  form.onDay({ detail: { value: '2026-01-02' } });
  await form.save({ detail: { value: { note: '保存后响应中断' } } });
  assert.equal(form.data.uncertain, true);
  await form.retrySave();
  assert.equal(form.data.saved, true);
  const detail = await client.loadPage('pet-detail');
  detail.onLoad({ id: pet.id });
  await detail.onShow();
  assert.equal(detail.data.growthEntries.length, 1);
  assert.equal(detail.data.growthEntries[0].dateLabel, '2026-01-02');
  assert.equal(detail.data.growthEntries[0].note, '保存后响应中断');
});

test('owner profile HTTP guards ownership, strict fields, expired sessions and private caching', async () => {
  for (const headers of [{}, nativeHeaders('expired')]) {
    await http('/api/v1/profile', { headers }, 401);
    await http('/api/v1/profile', { method: 'PATCH', headers, data: { nickname: '名字' } }, 401);
    await http('/api/v1/profile/avatar-upload', { method: 'POST', headers, raw: 'invalid' }, 401);
  }
  assert.deepEqual(await http('/api/v1/profile', { headers: nativeHeaders('owner') }), { nickname: '', avatarAssetId: null, avatarUrl: null });
  await http('/api/v1/profile', { method: 'PATCH', headers: nativeHeaders('owner'), data: { nickname: '越权', userId: users.other } }, 400);
  await http('/api/v1/profile', { method: 'PATCH', headers: nativeHeaders('owner'), data: { nickname: '名字', avatarAssetId: 'not-mine' } }, 400);
  const native = await nativeClient('owner');
  const page = await native.loadPage('profile-edit');
  await page.onLoad(); page.onNickname({ detail: { value: '自己的昵称' } }); await page.saveProfile();
  assert.equal(page.data.saved, true); await native.drain();
  const response = await fetch(base.origin + '/api/v1/profile', { headers: nativeHeaders('owner') });
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.deepEqual(await response.json(), { nickname: '自己的昵称', avatarAssetId: null, avatarUrl: null });
  assert.equal((await http('/api/v1/profile', { headers: nativeHeaders('other') })).nickname, '');
  await http('/api/v1/profile/avatar-upload', { method: 'POST', headers: { ...nativeHeaders('owner'), 'content-type': 'image/png' }, raw: '' }, 400);
  await http('/api/v1/profile/avatar-upload', { method: 'POST', headers: { ...nativeHeaders('owner'), 'content-type': 'image/gif' }, raw: 'bad' }, 400);
});

function input(page, field, value) {
  page.onInput({ currentTarget: { dataset: { field } }, detail: { value } });
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

test('native pet form persists all six categories, clears edited fields and rejects cross-owner access', async () => {
  const owner = await nativeClient('owner');
  const other = await nativeClient('other');
  try {
    for (const [index, speciesCode] of ['rat', 'gecko', 'snake', 'parrot', 'spider', 'other'].entries()) {
      const form = await owner.loadPage('pet-edit');
      const name = run + '-' + speciesCode;
      input(form, 'name', name);
      form.onSpeciesChange({ detail: { value: String(index) } });
      if (speciesCode === 'other') {
        input(form, 'customSpeciesName', ' 刺猬 ');
        for (const field of ['breed', 'environmentNotes', 'specialNeeds']) input(form, field, '原资料');
      }
      await form.submit();
      const stored = await prisma.pet.findFirstOrThrow({ where: { name, ownerUserId: users.owner } });
      const pet = await owner.api.getPet(stored.id);
      PetResponseSchema.parse(pet);
      assert.equal(pet.coverUrl, null);
      assert.equal(pet.speciesCode, speciesCode);
      await assert.rejects(other.api.getPet(pet.id), (error) => error.statusCode === 404 && Boolean(error.requestId));
      await http('/api/v1/pets/' + pet.id, { method: 'PATCH', headers: nativeHeaders('other'), data: { name: '越权' } }, 404);
      await http('/api/v1/pets/' + pet.id, { method: 'DELETE', headers: nativeHeaders('other') }, 404);
      assert.equal((await owner.api.updatePet(pet.id, { name: '已更新' })).name, '已更新');
      if (speciesCode === 'other') {
        assert.equal(stored.customSpeciesName, '刺猬');
        const edit = await owner.loadPage('pet-edit');
        await edit.onLoad({ id: pet.id });
        assert.equal(edit.data.form.customSpeciesName, '刺猬');
        edit.onSpeciesChange({ detail: { value: '0' } });
        for (const field of ['breed', 'environmentNotes', 'specialNeeds']) input(edit, field, ' ');
        await edit.submit();
        const updated = await prisma.pet.findUniqueOrThrow({ where: { id: pet.id } });
        assert.equal(updated.speciesCode, 'rat');
        for (const field of ['customSpeciesName', 'breed', 'environmentNotes', 'specialNeeds']) assert.equal(updated[field], null, field);
      }
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

test('authors can track their own post decisions while private submissions stay out of public feeds', async () => {
  const path = '/api/v1/community/posts/mine';
  await http(path, {}, 401);
  await http(path, { headers: nativeHeaders('expired') }, 401);
  await http(path + '?ownerUserId=other', { headers: nativeHeaders('owner') }, 400);
  const owner = await nativeClient('owner');
  const other = await nativeClient('other');
  try {
    const post = await owner.api.createCommunityPost({ title: '我的投稿', body: '审核反馈', topic: run });
    const secondPost = await owner.api.createCommunityPost({ title: '另一条投稿', body: '测试分页', topic: run });
    const item = async status => {
      const { posts } = await owner.api.listMyCommunityPosts();
      const submission = posts.find(row => row.id === post.id);
      assert.equal(submission?.status, status);
      assert.equal(submission.title, '我的投稿');
      assert.equal(submission.body, '审核反馈');
      assert.equal(Object.hasOwn(submission, 'ownerUserId'), false);
    };
    await item('pending');
    assert.equal((await http(path, { headers: nativeHeaders('other') })).posts.some(row => row.id === post.id), false);
    const response = await fetch(new URL(path + '?limit=1', base), { headers: nativeHeaders('owner') });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /private, no-store/);
    const page = await response.json();
    assert.equal(page.posts.length, 1);
    assert.equal(page.nextOffset, 1);
    const next = await http(path + '?limit=1&offset=' + page.nextOffset, { headers: nativeHeaders('owner') });
    assert.equal(next.posts.length, 1);
    assert.deepEqual(new Set([page.posts[0].id, next.posts[0].id]), new Set([post.id, secondPost.id]));
    await moderate('post', post.id, 'rejected');
    await item('rejected');
    await assert.rejects(other.api.getCommunityPost(post.id), error => error.statusCode === 404);
    await moderate('post', post.id, 'published');
    await item('published');
    assert.equal((await other.api.getCommunityPost(post.id)).id, post.id);
    await moderate('post', post.id, 'archived');
    await item('archived');
    assert.equal((await other.api.listCommunityPosts({ topic: run })).posts.some(row => row.id === post.id), false);
  } finally { await owner.drain(); await other.drain(); }
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
    const logPath = '/api/v1/care-logs/' + log.id;
    const correction = { value: '5.5g', note: '已核对', recordedAt: '2026-11-20T08:30:00.000Z' };
    for (const method of ['PATCH', 'DELETE']) {
      const data = method === 'PATCH' ? correction : undefined;
      await http(logPath, { method, data }, 401);
      await http(logPath, { method, data, headers: nativeHeaders('other') }, 404);
    }
    await http(logPath, { method: 'PATCH', data: { ...correction, petId: foreignPet.id }, headers: nativeHeaders('owner') }, 400);
    const corrected = await http(logPath, { method: 'PATCH', data: correction, headers: nativeHeaders('owner') });
    assert.equal(corrected.id, log.id);
    assert.equal(corrected.petId, pet.id);
    assert.equal(corrected.recordedAt, correction.recordedAt);
    assert.equal(corrected.value, '5.5g');
    assert.equal((await owner.api.listCareLogs({ petId: pet.id })).logs[0].value, '5.5g');
    assert.deepEqual(await http(logPath, { method: 'DELETE', headers: nativeHeaders('owner') }), { id: log.id });
    assert.equal((await owner.api.listCareLogs({ petId: pet.id })).logs.length, 0);
    const archivedLog = await owner.api.createCareLog(logData);
    const completed = await Promise.all(Array.from({ length: 10 }, () => owner.api.completeCareReminder(reminder.id)));
    assert.equal(new Set(completed.map((item) => item.completedAt)).size, 1);
    assert.equal((await owner.api.completeCareReminder(reminder.id)).completedAt, completed[0].completedAt);
    await http('/api/v1/pets/' + pet.id, { method: 'DELETE', headers: nativeHeaders('owner') });
    await http('/api/v1/care-logs/' + archivedLog.id, { method: 'PATCH', data: correction, headers: nativeHeaders('owner') }, 404);
    await http('/api/v1/care-logs/' + archivedLog.id, { method: 'DELETE', headers: nativeHeaders('owner') }, 404);
    assert.equal((await owner.api.listCareLogs()).logs.length, 0);
    assert.equal((await owner.api.listCareReminders()).reminders.length, 0);
    await assert.rejects(owner.api.completeCareReminder(reminder.id), (error) => error.statusCode === 404);
  } finally { await owner.drain(); await other.drain(); }
});

test('native care history backdates and corrects a measurement for the selected pet', async () => {
  let confirm;
  const client = await nativeClient('owner', { confirmModal: ({ success }) => { confirm = success; } });
  try {
    const pet = await client.api.createPet({ name: run + '-care-editor' });
    const care = await client.loadPage('care-log');
    care.onLoad({ petId: pet.id });
    await care.onShow();
    assert.equal(care.data.composerOpen, false);
    assert.equal(care.data.selectedPetId, pet.id);
    care.openComposer();
    care.onKindChange({ detail: { value: 3 } });
    care.onQuantityChange({ detail: { value: [0, 55, 0] } });
    care.onRecordDate({ detail: { value: '2026-10-20' } });
    care.onRecordTime({ detail: { value: '08:30' } });
    await care.submit();
    const [saved] = care.data.logs;
    assert.equal(saved.value, '55g');
    assert.equal(saved.displayTime, '2026-10-20 08:30');
    care.openEdit({ currentTarget: { dataset: { id: saved.id } } });
    assert.equal(care.data.amount, '55');
    care.onQuantityChange({ detail: { value: [0, 5, 5] } });
    await care.submit();
    assert.equal(care.data.logs.length, 1);
    assert.equal(care.data.logs[0].value, '5.5g');
    assert.equal(care.data.logs[0].recordedAt, saved.recordedAt);
    const home = await client.loadPage('home');
    await home.loadSummary();
    await home.selectPet({ currentTarget: { dataset: { id: pet.id } } });
    assert.equal(home.data.weightChart.latest.grams, 5.5);
    assert.equal(home.data.weightChart.segments.length, 0);
    care.deleteRecord({ currentTarget: { dataset: { id: saved.id } } });
    await confirm({ confirm: false });
    assert.equal(care.data.logs.length, 1);
    care.deleteRecord({ currentTarget: { dataset: { id: saved.id } } });
    await confirm({ confirm: true });
    assert.equal(care.data.logs.length, 0);
    await home.loadSummary();
    assert.equal(home.data.weightChart.latest, null);
    assert.equal(home.data.selectedPetId, pet.id);
    await http('/api/v1/pets/' + pet.id, { method: 'DELETE', headers: nativeHeaders('owner') });
  } finally { await client.drain(); }
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

test('native client clears expired credentials and exposes login-stage failure when recovery is unavailable', async () => {
  const client = await nativeClient('expired');
  try {
    await assert.rejects(client.api.listPets(), (error) => error.code === 'WX_LOGIN_FAILED' && error.stage === 'wx-login');
    assert.equal(client.storage.has('petscape_session_token'), false);
  } finally { await client.drain(); }
});

test('native session fixture recovers expired read and write through real protected HTTP without duplicate saves', async () => {
  const client = await nativeClient('expired', { restoreAs: 'owner' });
  try {
    const initial = await client.api.listPets();
    assert.ok(Array.isArray(initial.pets));
    assert.equal(client.storage.get('petscape_session_token'), tokens.owner);
    client.storage.set('petscape_session_token', tokens.expired);
    const name = run + '-recovered-save';
    const pet = await client.api.createPet({ name, speciesCode: 'rat' });
    assert.ok(pet.id);
    const saved = await client.api.listPets();
    assert.equal(saved.pets.filter((item) => item.name === name).length, 1);
  } finally { await client.drain(); }
});

test('home weight editor persists normalized weights only for its selected pet through real HTTP', async () => {
  const client = await nativeClient('owner');
  try {
    const first = await client.api.createPet({ name: run + '-home-a', speciesCode: 'rat' });
    const second = await client.api.createPet({ name: run + '-home-b', speciesCode: 'parrot' });
    const home = await client.loadPage('home');
    await home.loadSummary();
    await home.selectPet({ currentTarget: { dataset: { id: first.id } } });
    home.openWeightModal();
    assert.equal(home.data.activeModal, 'weight'); assert.equal(home.data.modalPetId, first.id);
    home.onWeightInput({ detail: { value: '325' } });
    home.onWeightUnit({ currentTarget: { dataset: { unit: 'kg' } } });
    assert.equal(home.data.weightUnit, 'g');
    await home.saveWeight();
    assert.equal(home.data.weightChart.latest.grams, 325);
    assert.equal(home.data.weightNotice, '体重已保存');
    assert.equal(home.data.activeModal, '');
    const records = await prisma.careLog.findMany({ where: { petId: first.id, ownerUserId: users.owner } });
    assert.equal(records.length, 1); assert.equal(records[0].value, '325g');
    await home.selectPet({ currentTarget: { dataset: { id: second.id } } });
    assert.equal(home.data.weightChart.latest, null); assert.equal(home.data.weightInput, '');
    assert.equal(await prisma.careLog.count({ where: { petId: second.id } }), 0);
    await home.selectPet({ currentTarget: { dataset: { id: first.id } } });
    assert.equal(home.data.weightChart.latest.grams, 325);
    const hidden = await http('/api/v1/care-logs?petId=' + first.id, { headers: nativeHeaders('other') });
    assert.deepEqual(hidden.logs, []);
  } finally { await client.drain(); }
});

test('home care confirmation popups persist all four kinds through HTTP without cross-pet records', async () => {
  const client = await nativeClient('owner');
  try {
    const pet = await client.api.createPet({ name: run + '-home-care', speciesCode: 'gecko' });
    const other = await client.api.createPet({ name: run + '-home-care-other', speciesCode: 'rat' });
    const home = await client.loadPage('home'); await home.loadSummary();
    await home.selectPet({ currentTarget: { dataset: { id: pet.id } } });
    for (const kind of ['喂食', '换水', '清洁', '生病']) {
      home.openCareModal({ currentTarget: { dataset: { kind } } });
      assert.equal(await prisma.careLog.count({ where: { petId: pet.id, kind } }), 0);
      home.onCareNote({ detail: { value: run + '-' + kind } });
      if (kind === '喂食') home.onCareValue({ detail: { value: '蟋蟀2只' } });
      await Promise.all([home.saveCareRecord(), home.saveCareRecord()]);
      assert.equal(home.data.activeModal, '');
      const rows = await prisma.careLog.findMany({ where: { petId: pet.id, kind } });
      assert.equal(rows.length, 1); assert.equal(rows[0].ownerUserId, users.owner);
      assert.equal(rows[0].note, run + '-' + kind);
    }
    assert.equal(home.data.latestFeeding.displayValue, '蟋蟀2只');
    assert.equal(await prisma.careLog.count({ where: { petId: other.id } }), 0);
    await home.selectPet({ currentTarget: { dataset: { id: other.id } } });
    assert.equal(home.data.latestFeeding, null); assert.equal(home.data.weightChart.latest, null);
  } finally { await client.drain(); }
});

test('native pet editor stores subadult, omits arbitrary size levels and preserves legacy size on edit', async () => {
  const client = await nativeClient('owner');
  try {
    const form = await client.loadPage('pet-edit');
    input(form, 'name', run + '-subadult');
    form.onSpeciesChange({ detail: { value: '2' } });
    input(form, 'breed', '玉米蛇');
    form.onLifeStageChange({ detail: { value: '1' } });
    await form.submit();
    const stored = await prisma.pet.findFirstOrThrow({ where: { name: run + '-subadult', ownerUserId: users.owner } });
    assert.equal(stored.lifeStage, 'subadult'); assert.equal(stored.sizeLevel, null);
    const fetched = await client.api.getPet(stored.id);
    assert.equal(fetched.lifeStage, 'subadult');
    await prisma.pet.update({ where: { id: stored.id }, data: { sizeLevel: 4 } });
    const edit = await client.loadPage('pet-edit'); await edit.onLoad({ id: stored.id });
    assert.equal(edit.data.form.lifeStage, 'subadult');
    input(edit, 'name', run + '-subadult-edited'); await edit.submit();
    const after = await prisma.pet.findUniqueOrThrow({ where: { id: stored.id } });
    assert.equal(after.sizeLevel, 4); assert.equal(after.lifeStage, 'subadult');
  } finally { await client.drain(); }
});

test('native care page saves to the selected pet after list changes and completes a persisted reminder', async () => {
  const client = await nativeClient('owner');
  try {
    const pet = await client.api.createPet({ name: run + '-care-page', speciesCode: 'rat' });
    const care = await client.loadPage('care-log');
    await care.onShow();
    await care.onPetChange({ detail: { value: String(care.data.pets.findIndex((item) => item.id === pet.id)) } });
    care.onNoteInput({ detail: { value: run + '-selected-note' } });
    care.onValueInput({ detail: { value: '320g' } });
    // A newly created pet changes server ordering; selection must follow its ID.
    await client.api.createPet({ name: run + '-inserted-later', speciesCode: 'parrot' });
    await care.loadData();
    assert.equal(care.data.pets[care.data.petIndex].id, pet.id);
    assert.equal(care.data.note, run + '-selected-note');
    await Promise.all([care.submit(), care.submit()]);
    const logs = await prisma.careLog.findMany({ where: { ownerUserId: users.owner, note: run + '-selected-note' } });
    assert.equal(logs.length, 1); assert.equal(logs[0].petId, pet.id); assert.equal(logs[0].value, '320g');
    assert.equal(care.data.logs[0].petId, pet.id);
    care.onReminderTitle({ detail: { value: run + '-daily-water' } });
    await Promise.all([care.addReminder(), care.addReminder()]);
    const reminders = await prisma.careReminder.findMany({ where: { ownerUserId: users.owner, title: run + '-daily-water' } });
    assert.equal(reminders.length, 1); assert.equal(reminders[0].petId, pet.id);
    const event = { currentTarget: { dataset: { id: reminders[0].id } } };
    await Promise.all([care.completeReminder(event), care.completeReminder(event)]);
    const completed = await prisma.careReminder.findUniqueOrThrow({ where: { id: reminders[0].id } });
    assert.ok(completed.completedAt);
    assert.equal(care.data.reminders[0].completedAt, completed.completedAt.toISOString());
    await care.completeReminder(event);
    assert.equal((await prisma.careReminder.findUniqueOrThrow({ where: { id: completed.id } })).completedAt.getTime(), completed.completedAt.getTime());
  } finally { await client.drain(); }
});
