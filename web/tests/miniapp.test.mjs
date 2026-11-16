import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { CreatePetRequestSchema, UpdatePetRequestSchema } from '../../packages/server/src/contracts/pets.ts';
import { AnalyticsEventSchema } from '../../packages/server/src/contracts/community-content.ts';

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

test('classified native failures retain the existing server analytics contract', async () => {
  app.globalData.mockMode = false;
  const events = [];
  wx.request = (options) => {
    if (options.url.endsWith('/analytics/events')) {
      AnalyticsEventSchema.parse(options.data); events.push(options.data);
      options.success({ statusCode: 202, data: {} });
    } else options.fail({ errMsg: 'request:fail ssl hand shake error private-value' });
  };
  await assert.rejects(api.listArticles(), (error) => error.code === 'TLS_FAILED');
  assert.equal(events.length, 1);
  assert.equal(events[0].properties.code, 'network');
  assert.equal(JSON.stringify(events).includes('private-value'), false);
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


test('home and pet list distinguish a failed read from an empty account and recover on retry', async () => {
  for (const name of ['home', 'pet']) {
    let failed = true;
    const view = page(name, { listPets: async () => {
      if (failed) throw new Error('network unavailable');
      return { pets: [] };
    } });
    const load = name === 'home' ? 'loadSummary' : 'loadPets';
    if (name === 'home') view.data.pet = { id: 'stale' };
    else view.data.pets = [{ id: 'stale' }];
    await view[load]();
    assert.equal(view.data.loading, false);
    assert.match(view.data.loadError, /重试/);
    assert.equal(name === 'home' ? view.data.pet : view.data.pets.length, name === 'home' ? null : 0);
    failed = false;
    await view[load]();
    assert.equal(view.data.loadError, '');
    assert.equal(view.data.loading, false);
    assert.equal(name === 'home' ? view.data.pet : view.data.pets.length, name === 'home' ? null : 0);
  }
});

test('home and pet list display a login retry message for an unauthorized read', async () => {
  for (const name of ['home', 'pet']) {
    const view = page(name, { listPets: async () => { throw { statusCode: 401 }; } });
    await view[name === 'home' ? 'loadSummary' : 'loadPets']();
    assert.match(view.data.loadError, /登录/);
  }
});

test('release mock mode is controlled by project config despite a stale local toggle', () => {
  let definition;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), {
    App: (value) => { definition = value; },
    wx: { getStorageSync: () => true },
    require: (id) => id === './utils/config' ? { mockMode: false } : { track() {} },
  });
  definition.onLaunch();
  assert.equal(definition.globalData.mockMode, false);
});

test('pet pages expose categorized diagnostics without private native errors and clear them on recovery', async () => {
  for (const name of ['home', 'pet']) {
    let failed = true;
    const view = page(name, { listPets: async () => {
      if (failed) throw { stage: 'session-exchange', errMsg: 'request:fail url not in domain list private-code' };
      return { pets: [] };
    } });
    const load = name === 'home' ? 'loadSummary' : 'loadPets';
    await view[load]();
    assert.match(view.data.loadErrorTitle, /域名/);
    assert.match(view.data.loadErrorDetail, /DOMAIN_NOT_ALLOWED.*建立会话/);
    assert.equal(JSON.stringify(view.data).includes('private-code'), false);
    failed = false;
    await view[load]();
    assert.equal(view.data.loadErrorDetail, '');
    assert.equal(view.data.loadErrorTitle, '');
  }
});

test('home switches pets by ID, restores their own drafts and keeps selection after reorder', async () => {
  let pets = carePets;
  const home = page('home', { ...careApi, listPets: async () => ({ pets }) });
  await home.loadSummary();
  home.onWeightInput({ detail: { value: '320' } });
  await home.selectPet({ currentTarget: { dataset: { id: 'pet-b' } } });
  assert.equal(home.data.weightInput, '');
  home.onWeightInput({ detail: { value: '0.72' } });
  home.onWeightUnit({ currentTarget: { dataset: { unit: 'kg' } } });
  pets = [carePets[1], carePets[0]];
  await home.loadSummary();
  assert.equal(home.data.pet.id, 'pet-b');
  assert.equal(home.data.weightInput, '0.72');
  assert.equal(home.data.weightUnit, 'kg');
  await home.selectPet({ currentTarget: { dataset: { id: 'pet-a' } } });
  assert.equal(home.data.weightInput, '320');
  assert.equal(home.data.weightUnit, 'g');
});

test('home ignores stale pet and weight responses including late failures', async () => {
  for (const fail of [false, true]) {
    const old = deferred();
    const home = page('home', { ...careApi, listCareLogs: ({ petId }) => petId === 'pet-a' ? old.promise : Promise.resolve({ logs: [
      { id: 'b', petId, kind: '体重', value: '0.72 kg', recordedAt: '2026-11-15T01:00:00Z' },
    ] }) });
    const initial = home.loadSummary();
    await Promise.resolve();
    await home.selectPet({ currentTarget: { dataset: { id: 'pet-b' } } });
    if (fail) old.reject(new Error('private-error')); else old.resolve({ logs: [
      { id: 'a', petId: 'pet-a', kind: '体重', value: '320g', recordedAt: '2026-11-15T01:00:00Z' },
    ] });
    await initial;
    assert.equal(home.data.pet.id, 'pet-b');
    assert.equal(home.data.latestWeight.grams, 720);
    assert.equal(home.data.weightError, '');
  }
  const oldPets = deferred(); let calls = 0;
  const home = page('home', { ...careApi, listPets: () => ++calls === 1 ? oldPets.promise : Promise.resolve({ pets: [carePets[1]] }) });
  const initial = home.loadSummary(); await home.loadSummary();
  oldPets.resolve({ pets: [carePets[0]] }); await initial;
  assert.equal(home.data.pet.id, 'pet-b');
});

test('home weight save normalizes units, blocks double taps and holds selection until refresh ends', async () => {
  const save = deferred(); const refresh = deferred(); const writes = []; let reads = 0;
  const home = page('home', { ...careApi,
    createCareLog: async (payload) => { writes.push(payload); await save.promise; },
    listCareLogs: async () => ++reads === 1 ? { logs: [] } : refresh.promise,
  });
  await home.loadSummary(); home.onWeightInput({ detail: { value: '0.325' } });
  home.onWeightUnit({ currentTarget: { dataset: { unit: 'kg' } } });
  const first = home.saveWeight();
  await home.selectPet({ currentTarget: { dataset: { id: 'pet-b' } } });
  home.onWeightInput({ detail: { value: '999' } }); await home.saveWeight();
  save.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(home.data.weightSaving, true);
  assert.equal(home.data.pet.id, 'pet-a');
  refresh.resolve({ logs: [] }); await first;
  assert.equal(writes.length, 1); assert.equal(writes[0].petId, 'pet-a');
  assert.equal(writes[0].kind, '体重'); assert.equal(writes[0].value, '325g');
  assert.equal(home.data.weightInput, ''); assert.equal(home.data.weightSaving, false);
});

test('home weight history filters foreign, malformed and unitless records and orders by measurement time', async () => {
  const home = page('home', { ...careApi, listCareLogs: async () => ({ logs: [
    { id: 'new', petId: 'pet-a', kind: '体重', value: '0.325kg', recordedAt: '2026-11-16T00:00:00Z' },
    { id: 'old', petId: 'pet-a', kind: '体重', value: '320 克', recordedAt: '2026-11-15T00:00:00Z' },
    { id: 'other', petId: 'pet-b', kind: '体重', value: '900g', recordedAt: '2026-11-17T00:00:00Z' },
    ...['320', '-2g', '0g', '20mg', 'private-value', 'Infinityg'].map((value) => ({ petId: 'pet-a', kind: '体重', value, recordedAt: '2026-11-17T00:00:00Z' })),
    { petId: 'pet-a', kind: '喂食', value: '999g', recordedAt: '2026-11-18T00:00:00Z' },
  ] }) });
  await home.loadSummary();
  assert.equal(home.data.latestWeight.grams, 325);
  assert.equal(home.data.weightChange, '+5 g');
  assert.deepEqual(home.data.weightHistory.map((x) => x.id), ['old', 'new']);
});

test('home invalid weight never writes and an unconfirmed save requires a read before another write', async () => {
  let writes = 0;
  const home = page('home', { ...careApi, createCareLog: async () => { writes++; throw { statusCode: 502 }; } });
  await home.loadSummary();
  for (const value of ['', '0', '-1', '1e3', 'NaN', '1.1234']) {
    home.onWeightInput({ detail: { value } }); await home.saveWeight();
  }
  assert.equal(writes, 0);
  home.onWeightInput({ detail: { value: '320' } }); await home.saveWeight(); await home.saveWeight();
  assert.equal(writes, 1); assert.equal(home.data.weightInput, '320');
  assert.equal(home.data.weightUnconfirmed, true);
  await home.loadWeights(); assert.equal(home.data.weightUnconfirmed, false);
});

test('home read failure clears stale weights and a successful save stays successful when only refresh fails', async () => {
  let failed = false;
  const home = page('home', { ...careApi, listCareLogs: async () => {
    if (failed) throw { statusCode: 503 };
    return { logs: [{ id: 'old', petId: 'pet-a', kind: '体重', value: '320g', recordedAt: '2026-11-15T00:00:00Z' }] };
  }, createCareLog: async () => { failed = true; } });
  await home.loadSummary(); home.onWeightInput({ detail: { value: '325' } });
  await home.saveWeight();
  assert.equal(home.data.weightInput, ''); assert.match(home.data.weightNotice, /已保存/);
  assert.ok(home.data.weightError); assert.deepEqual(home.data.weightHistory, []);
  assert.equal(home.data.latestWeight, null); assert.equal(home.data.weightSaving, false);
});

test('home uses existing cover photos and falls back to species art without breaking other pets', async () => {
  const home = page('home', { ...careApi, listPets: async () => ({ pets: [
    { ...carePets[0], speciesCode: 'rat', coverUrl: 'https://images.example.test/pet-a' },
    { ...carePets[1], speciesCode: 'other' },
  ] }) });
  await home.loadSummary();
  assert.equal(home.data.pet.avatarUrl, 'https://images.example.test/pet-a');
  home.onAvatarError({ currentTarget: { dataset: { id: 'pet-a' } } });
  assert.equal(home.data.pet.avatarUrl, '/assets/species-rat.png');
  home.onAvatarError({ currentTarget: { dataset: { id: 'pet-a' } } });
  assert.equal(home.data.pet.avatarUrl, '');
  assert.equal(home.data.pets[1].avatarUrl, '');
});

test('home carousel follows pet identity after swipes, list reorder and pet deletion', async () => {
  let pets = carePets;
  const home = page('home', { ...careApi, listPets: async () => ({ pets }) });
  await home.loadSummary();
  assert.equal(home.data.petIndex, 0);
  await home.onPetSwipe({ detail: { current: 1, source: 'touch' } });
  assert.equal(home.data.selectedPetId, 'pet-b'); assert.equal(home.data.petIndex, 1);
  pets = [carePets[1], carePets[0]]; await home.loadSummary();
  assert.equal(home.data.selectedPetId, 'pet-b'); assert.equal(home.data.petIndex, 0);
  for (const current of [-1, 2, 0.5, '1']) await home.onPetSwipe({ detail: { current } });
  assert.equal(home.data.selectedPetId, 'pet-b');
  pets = [carePets[0]]; await home.loadSummary();
  assert.equal(home.data.selectedPetId, 'pet-a'); assert.equal(home.data.petIndex, 0);
  pets = []; await home.loadSummary();
  assert.equal(home.data.pet, null); assert.equal(home.data.petIndex, 0);
  await home.onPetSwipe({ detail: { current: 0 } });
  assert.equal(home.data.selectedPetId, '');
});

test('home carousel ignores late weights and cannot swipe or open a profile during a pending save', async () => {
  const old = deferred(); let reads = 0;
  const saving = deferred(); let writes = 0;
  const home = page('home', { ...careApi,
    listCareLogs: async ({ petId }) => ++reads === 1 ? old.promise : { logs: [{ id: 'latest', petId, kind: '体重', value: '720g', recordedAt: '2026-11-16T00:00:00Z' }] },
    createCareLog: async () => { writes++; await saving.promise; },
  });
  const initial = home.loadSummary(); await Promise.resolve();
  await home.onPetSwipe({ detail: { current: 1, source: 'touch' } });
  old.resolve({ logs: [] }); await initial;
  assert.equal(home.data.latestWeight.grams, 720);
  home.onWeightInput({ detail: { value: '725' } });
  const write = home.saveWeight();
  await home.onPetSwipe({ detail: { current: 0, source: 'touch' } });
  let opens = 0; wx.navigateTo = () => { opens++; };
  home.openPetProfile({ currentTarget: { dataset: { id: 'pet-a' } } });
  await home.saveWeight();
  assert.equal(home.data.petIndex, 1); assert.equal(home.data.pet.id, 'pet-b'); assert.equal(opens, 0);
  saving.resolve(); await write;
  assert.equal(writes, 1); assert.equal(home.data.petIndex, 1);
});

test('every carousel avatar opens its own profile and the selected profile card opens the same pet', async () => {
  const special = { id: 'pet b?/名', name: '团子' };
  const home = page('home', { ...careApi, listPets: async () => ({ pets: [carePets[0], special] }) });
  await home.loadSummary();
  home.openPetProfile({ currentTarget: { dataset: { id: special.id } } });
  assert.deepEqual(navigation, ['navigateTo', '/pages/pet-edit/index?id=' + encodeURIComponent(special.id)]);
  assert.equal(home.data.selectedPetId, 'pet-a');
  home.openPet(); assert.deepEqual(navigation, ['navigateTo', '/pages/pet-edit/index?id=pet-a']);
  let opens = 0; wx.navigateTo = () => { opens++; };
  home.openPetProfile({ currentTarget: { dataset: { id: 'not-own' } } });
  assert.equal(opens, 0);
});
