import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../miniapp/', import.meta.url));
const require = createRequire(path.join(root, 'app.js'));
const app = { globalData: { mockMode: true, apiBaseUrl: 'https://test.petscape.invalid' } };
const storage = new Map();
const notices = [];
let navigation;
function resetWx() {
  app.globalData.mockMode = true; storage.clear(); notices.length = 0;
  globalThis.getApp = () => app;
  globalThis.getCurrentPages = () => [{ route: 'pages/home/index' }];
  globalThis.wx = {
    getStorageSync: (key) => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: (key) => storage.delete(key),
    showToast: (value) => notices.push(value), showModal() {},
    navigateTo: (value) => { navigation = ['navigateTo', value.url]; }, switchTab: (value) => { navigation = ['switchTab', value.url]; }, navigateBack() {},
  };
}
resetWx();
const api = require(path.join(root, 'utils/request.js'));
function page(name) {
  const filename = path.join(root, `pages/${name}/index.js`);
  delete require.cache[require.resolve(filename)];
  let result;
  globalThis.Page = (definition) => { result = definition; };
  require(filename);
  result.data = structuredClone(result.data);
  result.setData = function (data) { Object.assign(this.data, data); };
  return result;
}
function files(directory) { return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]); }
test.beforeEach(resetWx);

test('every registered native page has resources and all WXML handlers exist', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json')));
  for (const source of files(root)) {
    if (source.endsWith('.json')) JSON.parse(fs.readFileSync(source));
    if (source.endsWith('.js')) new vm.Script(fs.readFileSync(source, 'utf8'), { filename: source });
  }
  for (const item of config.pages) {
    for (const extension of ['.js', '.json', '.wxml', '.wxss']) assert.ok(fs.existsSync(path.join(root, item + extension)), item + extension);
    const definition = page(item.split('/')[1]);
    const wxml = fs.readFileSync(path.join(root, item + '.wxml'), 'utf8');
    for (const binding of wxml.matchAll(/(?:bind|catch)(?:tap|input|change|submit|confirm)="([A-Za-z_][\w]*)"/g)) assert.equal(typeof definition[binding[1]], 'function', `${item}: ${binding[1]}`);
  }
});

test('local assets fit the main package budget and official species retain image fallbacks', () => {
  const size = files(root).filter((file) => !file.endsWith('.md')).reduce((total, file) => total + fs.statSync(file).size, 0);
  assert.ok(size < 1800000, `main package sources too large: ${size}`);
  const { SPECIES_OPTIONS, getSpeciesMeta } = require(path.join(root, 'utils/species.js'));
  assert.deepEqual(SPECIES_OPTIONS.map((item) => item.value), ['rat', 'gecko', 'snake', 'parrot', 'spider', 'other']);
  for (const item of SPECIES_OPTIONS.slice(0, 5)) assert.ok(fs.existsSync(path.join(root, item.image)));
  assert.equal(getSpeciesMeta('unknown').value, 'other');
});

test('home knowledge action uses switchTab and article filters load the correct public set', async () => {
  page('home').openAction({ currentTarget: { dataset: { path: '/pages/knowledge/index' } } });
  assert.deepEqual(navigation, ['switchTab', '/pages/knowledge/index']);
  const knowledge = page('knowledge');
  await knowledge.selectCategory({ currentTarget: { dataset: { category: '鹦鹉' } } });
  assert.equal(knowledge.data.articles.length, 1);
  assert.equal(knowledge.data.articles[0].category, '鹦鹉');
});

test('pending posts and comments never appear as publicly published content in preview', async () => {
  const before = (await api.listCommunityPosts()).posts.length;
  const post = await api.createCommunityPost({ title: '待审', body: '尚未发布', topic: '经验' });
  assert.equal(post.status, 'pending');
  assert.equal((await api.listCommunityPosts()).posts.length, before);
  const comment = await api.createCommunityComment('mock-post-1', { body: '待审评论' });
  assert.equal(comment.postId, 'mock-post-1');
  assert.equal((await api.listCommunityComments('mock-post-1')).comments.some((item) => item.id === comment.id), false);
});

test('like retries are idempotent and native page updates visible state', async () => {
  const community = page('community'); await community.loadPosts();
  const original = community.data.posts[0].likes;
  const id = community.data.posts[0].id;
  await api.toggleCommunityPostLike(id, true);
  assert.equal((await api.toggleCommunityPostLike(id, true)).likeCount, original + 1);
  await api.toggleCommunityPostLike(id, false);
  await community.loadPosts();
  await community.likePost({ currentTarget: { dataset: { id } } });
  assert.equal(community.data.posts[0].liked, true);
  await community.likePost({ currentTarget: { dataset: { id } } });
  assert.equal(community.data.posts[0].likes, original);
});

test('care logs remain attached to the selected pet and reminders complete idempotently', async () => {
  const pet = await api.createPet({ name: '第二只宠物', speciesCode: 'parrot' });
  const care = page('care-log'); await care.onShow();
  assert.equal(care.data.pets[0].id, pet.id);
  await care.onPetChange({ detail: { value: '1' } });
  const selectedPetId = care.data.pets[1].id;
  care.setData({ note: '固定测试记录', value: '320g' }); await care.submit();
  assert.equal(care.data.petIndex, 1);
  assert.equal(care.data.logs[0].petId, selectedPetId);
  care.setData({ reminderTitle: '更换饮水' }); await care.addReminder();
  const reminder = care.data.reminders[0]; assert.ok(reminder);
  await care.completeReminder({ currentTarget: { dataset: { id: reminder.id } } });
  const completedAt = care.data.reminders[0].completedAt; assert.ok(completedAt);
  assert.equal((await api.completeCareReminder(reminder.id)).completedAt, completedAt);
});

test('service filters exclude a different city and type', async () => {
  assert.equal((await api.listServiceProviders({ city: '深圳', serviceType: '护理' })).providers.length, 0);
  assert.equal((await api.listServiceProviders({ city: '深圳', serviceType: '寄养' })).providers.length, 1);
});

test('native detail page reports missing content and request errors never recurse through analytics', async () => {
  const detail = page('article'); await detail.onLoad({ id: 'missing' });
  assert.match(detail.data.error, /不存在/);
  app.globalData.mockMode = false;
  const calls = [];
  wx.request = (options) => { calls.push(options.url); options.success({ statusCode: 503, data: {}, header: { 'x-request-id': 'request-proof' } }); };
  await assert.rejects(() => api.listArticles(), (error) => error.requestId === 'request-proof');
  assert.equal(calls.length, 2);
  assert.match(calls[1], /analytics\/events$/);
});

test('parallel protected requests share one wx.login exchange', async () => {
  app.globalData.mockMode = false;
  let logins = 0;
  wx.login = ({ success }) => { logins += 1; queueMicrotask(() => success({ code: 'one-code' })); };
  wx.request = (options) => {
    const auth = options.url.endsWith('/auth/login');
    if (!auth) assert.equal(options.header['X-PetScape-Session'], 'server-session');
    options.success({ statusCode: 200, data: auth ? { sessionToken: 'server-session' } : { pets: [] } });
  };
  await Promise.all([api.listPets(), api.listPets()]); assert.equal(logins, 1);
});
