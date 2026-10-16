import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { CreatePetRequestSchema, UpdatePetRequestSchema } from '../../packages/server/src/contracts/pets.ts';

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
function page(name, overrides = {}) {
  const filename = path.join(root, `pages/${name}/index.js`);
  delete require.cache[require.resolve(filename)];
  let result;
  globalThis.Page = (definition) => { result = definition; };
  const original = Object.fromEntries(Object.keys(overrides).map((key) => [key, api[key]]));
  Object.assign(api, overrides);
  try { require(filename); } finally { Object.assign(api, original); }
  result.data = structuredClone(result.data);
  result.setData = function (data) {
    for (const [key, value] of Object.entries(data)) {
      const parts = key.split('.');
      const target = parts.slice(0, -1).reduce((object, part) => object[part], this.data);
      target[parts.at(-1)] = value;
    }
  };
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

test('native pet form submits all six species including the required custom species name', async () => {
  const saved = [];
  for (const [index, speciesCode] of ['rat', 'gecko', 'snake', 'parrot', 'spider', 'other'].entries()) {
    const form = page('pet-edit', { createPet: async (payload) => { CreatePetRequestSchema.parse(payload); saved.push(payload); return { id: 'saved' }; } });
    form.onInput({ currentTarget: { dataset: { field: 'name' } }, detail: { value: '小团子' } });
    form.onSpeciesChange({ detail: { value: String(index) } });
    if (speciesCode === 'other') form.onInput({ currentTarget: { dataset: { field: 'customSpeciesName' } }, detail: { value: ' 刺猬 ' } });
    await form.submit();
  }
  assert.equal(saved.length, 6);
  assert.equal(saved.at(-1).customSpeciesName, '刺猬');
});

test('native edit form restores other species and clears optional fields in the API contract', async () => {
  const saved = [];
  const form = page('pet-edit', {
    getPet: async () => ({ name: '团子', speciesCode: 'other', customSpeciesName: '刺猬', breed: '原品种', environmentNotes: '原环境', specialNeeds: '原需求' }),
    updatePet: async (id, payload) => { UpdatePetRequestSchema.parse(payload); saved.push({ id, payload }); },
  });
  wx.setNavigationBarTitle = () => {};
  await form.onLoad({ id: 'own-pet' });
  assert.equal(form.data.form.customSpeciesName, '刺猬');
  assert.equal(form.data.speciesOptions[form.data.speciesIndex].value, 'other');
  assert.equal(form.data.lifeStageOptions[form.data.lifeStageIndex].value, 'unknown');
  form.onSpeciesChange({ detail: { value: '0' } });
  for (const field of ['breed', 'environmentNotes', 'specialNeeds']) form.onInput({ currentTarget: { dataset: { field } }, detail: { value: ' ' } });
  await form.submit();
  assert.equal(saved[0].id, 'own-pet');
  for (const key of ['customSpeciesName', 'breed', 'environmentNotes', 'specialNeeds']) assert.equal(saved[0].payload[key], null, key);
});

test('native form rejects unnamed other species before sending', async () => {
  let requests = 0;
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const form = page('pet-edit', { createPet: async () => { requests += 1; return pending; } });
  form.onInput({ currentTarget: { dataset: { field: 'name' } }, detail: { value: '团子' } });
  form.onSpeciesChange({ detail: { value: '5' } });
  // Do not hang the test if the old implementation sends the invalid form.
  const invalid = form.submit(); finish({ id: 'saved' }); await invalid;
  assert.equal(requests, 0);
  assert.match(notices.at(-1).title, /物种/);
});

test('native form ignores repeated save taps while a request is pending', async () => {
  let requests = 0;
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const form = page('pet-edit', { createPet: async () => { requests += 1; return pending; } });
  form.onInput({ currentTarget: { dataset: { field: 'name' } }, detail: { value: '团子' } });
  const first = form.submit(); const second = form.submit();
  finish({ id: 'saved' });
  await Promise.all([first, second]);
  assert.equal(requests, 1);
});

test('personal account blocks embedded workbench even if its flag is accidentally enabled', () => {
  const { canUseEmbeddedWorkbench } = require(path.join(root, 'utils/capabilities.js'));
  assert.equal(canUseEmbeddedWorkbench({ accountType: 'personal', webViewEnabled: true }), false);
  assert.equal(canUseEmbeddedWorkbench({ accountType: 'organization', webViewEnabled: false }), false);
  assert.equal(canUseEmbeddedWorkbench({ accountType: 'organization', webViewEnabled: true }), true);
  const viewer = page('viewer'); viewer.onLoad({ projectId: 'saved-project', title: '米粒的栖境' });
  assert.equal(viewer.data.url, '');
  assert.equal(viewer.data.projectTitle, '米粒的栖境');
  viewer.openPets(); assert.deepEqual(navigation, ['switchTab', '/pages/pet/index']);
  viewer.openCare(); assert.deepEqual(navigation, ['navigateTo', '/pages/care-log/index']);
});

test('home loads the pet independently of project APIs and exposes native care and profile entries', async () => {
  let projectRequests = 0;
  const home = page('home', {
    listPets: async () => ({ pets: [{ id: 'pet', name: '团子', speciesCode: 'other', customSpeciesName: '刺猬' }] }),
    listProjects: async () => { projectRequests += 1; throw new Error('unavailable'); },
  });
  await home.onShow();
  assert.equal(home.data.pet.speciesLabel, '刺猬');
  assert.equal(home.data.loading, false);
  assert.equal(projectRequests, 0);
  home.openCare(); assert.deepEqual(navigation, ['navigateTo', '/pages/care-log/index']);
  const action = home.data.quickActions.find((item) => item.path === '/pages/pet/index'); assert.ok(action);
  home.openAction({ currentTarget: { dataset: action } });
  assert.deepEqual(navigation, ['switchTab', '/pages/pet/index']);
});

function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const carePets = [{ id: 'pet-a', name: '米粒' }, { id: 'pet-b', name: '团子' }];
const careApi = {
  listPets: async () => ({ pets: carePets }),
  listCareLogs: async () => ({ logs: [] }),
  listCareReminders: async () => ({ reminders: [] }),
};

test('care selection follows the same pet after list reorder and clears drafts if that pet disappears', async () => {
  let pets = carePets;
  const care = page('care-log', { ...careApi, listPets: async () => ({ pets }) });
  await care.onShow();
  await care.onPetChange({ detail: { value: '1' } });
  care.setData({ note: '团子的记录', value: '320g', reminderTitle: '团子饮水' });
  pets = [carePets[1], carePets[0]];
  await care.loadData();
  assert.equal(care.data.pets[care.data.petIndex].id, 'pet-b');
  assert.equal(care.data.note, '团子的记录');
  pets = [carePets[0]];
  await care.loadData();
  assert.equal(care.data.pets[care.data.petIndex].id, 'pet-a');
  for (const field of ['note', 'value', 'reminderTitle']) assert.equal(care.data[field], '', field);
});

test('switching pets cannot carry an unfinished care or reminder draft to another pet', async () => {
  const care = page('care-log', careApi);
  await care.onShow();
  care.setData({ note: '米粒的记录', value: '200g', reminderTitle: '米粒饮水' });
  await care.onPetChange({ detail: { value: '1' } });
  for (const field of ['note', 'value', 'reminderTitle']) assert.equal(care.data[field], '', field);
  care.onNoteInput({ detail: { value: '团子的记录' } });
  await care.onPetChange({ detail: { value: '0' } });
  assert.equal(care.data.note, '米粒的记录'); assert.equal(care.data.reminderTitle, '米粒饮水');
});

test('outdated pet-list responses cannot start care requests or overwrite the latest selection', async () => {
  const old = deferred(); let reads = 0; const requested = [];
  const care = page('care-log', { ...careApi,
    listPets: () => ++reads === 1 ? old.promise : Promise.resolve({ pets: [carePets[1]] }),
    listCareLogs: async ({ petId }) => { requested.push(petId); return { logs: [{ id: 'log-b', petId, recordedAt: new Date().toISOString() }] }; },
  });
  const first = care.onShow();
  await care.loadData();
  old.resolve({ pets: [carePets[0]] }); await first;
  assert.equal(care.data.pets[care.data.petIndex].id, 'pet-b');
  assert.equal(care.data.logs[0].petId, 'pet-b');
  assert.deepEqual(requested, ['pet-b']);
});

test('care save keeps its pet fixed, ignores edits and duplicate actions until refresh finishes', async () => {
  const pending = deferred(); const writes = []; let reminders = 0;
  const care = page('care-log', { ...careApi,
    createCareLog: async (data) => { writes.push(data); await pending.promise; },
    createCareReminder: async () => { reminders += 1; },
  });
  await care.onShow();
  care.setData({ note: '米粒的记录', reminderTitle: '饮水' });
  const first = care.submit();
  await care.onPetChange({ detail: { value: '1' } });
  care.onNoteInput({ detail: { value: '新记录' } });
  const duplicate = care.submit(); const otherAction = care.addReminder();
  pending.resolve(); await Promise.all([first, duplicate, otherAction]);
  assert.equal(writes.length, 1); assert.equal(reminders, 0);
  assert.equal(writes[0].petId, 'pet-a'); assert.equal(writes[0].note, '米粒的记录');
  assert.equal(care.data.pets[care.data.petIndex].id, 'pet-a');
});

test('failed care reads clear stale lists, block writes and recover on explicit retry', async () => {
  let fail = false; let writes = 0;
  const care = page('care-log', { ...careApi,
    listCareLogs: async () => { if (fail) throw new Error('offline'); return { logs: [{ id: 'old', recordedAt: new Date().toISOString() }] }; },
    listCareReminders: async () => ({ reminders: [{ id: 'old-reminder', title: '饮水', dueAt: new Date().toISOString() }] }),
    createCareLog: async () => { writes += 1; },
  });
  await care.onShow(); fail = true;
  await care.loadData();
  assert.ok(care.data.error); assert.deepEqual(care.data.logs, []); assert.deepEqual(care.data.reminders, []);
  await care.submit(); assert.equal(writes, 0);
  fail = false; await care.loadData();
  assert.equal(care.data.error, ''); assert.equal(care.data.logs[0].id, 'old');
});

test('failed care save preserves the draft for a retry and empty state opens pet profiles', async () => {
  let tries = 0;
  const care = page('care-log', { ...careApi, createCareLog: async () => { if (++tries === 1) throw new Error('offline'); } });
  await care.onShow(); care.onNoteInput({ detail: { value: '观察记录' } });
  await care.submit(); assert.equal(care.data.note, '观察记录'); assert.equal(care.data.submitting, false);
  await care.submit(); assert.equal(tries, 2); assert.equal(care.data.note, '');
  care.openPets(); assert.deepEqual(navigation, ['switchTab', '/pages/pet/index']);
});

test('reminder creation keeps the pet and draft fixed while pending and blocks other mutations', async () => {
  const pending = deferred(); const writes = []; let completions = 0;
  const care = page('care-log', { ...careApi,
    createCareReminder: async (data) => { writes.push(data); await pending.promise; },
    completeCareReminder: async () => { completions += 1; },
  });
  await care.onShow(); care.setData({ reminderTitle: '米粒饮水' });
  const first = care.addReminder();
  await care.onPetChange({ detail: { value: '1' } });
  care.onReminderTitle({ detail: { value: '另一只宠物' } });
  const duplicate = care.addReminder(); const completion = care.completeReminder({ currentTarget: { dataset: { id: 'old-reminder' } } });
  pending.resolve(); await Promise.all([first, duplicate, completion]);
  assert.equal(writes.length, 1); assert.equal(completions, 0);
  assert.equal(writes[0].petId, 'pet-a'); assert.equal(writes[0].title, '米粒饮水');
  assert.equal(care.data.pets[care.data.petIndex].id, 'pet-a'); assert.equal(care.data.reminding, false);
});

test('completion ignores reminders outside the visible list and already completed items', async () => {
  let completions = 0;
  const care = page('care-log', { ...careApi,
    listCareReminders: async () => ({ reminders: [{ id: 'done', petId: 'pet-a', completedAt: new Date().toISOString() }] }),
    completeCareReminder: async () => { completions += 1; },
  });
  await care.onShow();
  for (const id of ['not-visible', 'done']) await care.completeReminder({ currentTarget: { dataset: { id } } });
  assert.equal(completions, 0);
});

test('service filters keep the latest response when an older success or failure arrives last', async () => {
  for (const fails of [false, true]) {
    const old = deferred(); let reads = 0;
    const services = page('services', { listServiceProviders: () => ++reads === 1 ? old.promise : Promise.resolve({ providers: [{ id: 'new', serviceType: '护理' }] }) });
    const first = services.loadProviders();
    await services.onTypeChange({ detail: { value: '2' } });
    if (fails) old.reject(new Error('offline')); else old.resolve({ providers: [{ id: 'old' }] });
    await first;
    assert.equal(services.data.typeIndex, 2); assert.equal(services.data.providers[0].id, 'new');
    assert.equal(services.data.error, ''); assert.equal(services.data.loading, false);
  }
});
