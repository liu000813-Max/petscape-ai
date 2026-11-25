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
  delete app.officialPostsEntry;
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
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
      const target = parts.slice(0, -1).reduce((object, part) => object[part], this.data);
      target[parts.at(-1)] = value;
    }
  };
  return result;
}
function files(directory) { return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]); }
test.beforeEach(resetWx);

test('growth editor keeps confirmed photo uploads when a later photo fails', async () => {
  const uploads = [];
  let payload;
  const pet = { id: 'growth-pet', name: '团子' };
  const form = page('pet-growth-edit', {
    getPet: async () => pet,
    uploadPetGrowthPhoto: async (id, photo) => {
      assert.equal(id, pet.id);
      uploads.push(photo.path);
      if (photo.path === '/second.png' && uploads.length === 2) throw { statusCode: 503 };
      return { assetId: photo.path === '/first.png' ? 'asset-one' : 'asset-two' };
    },
    createPetGrowthEntry: async (id, input) => {
      payload = input;
      return { id: 'growth-entry', petId: id };
    },
  });
  wx.chooseMedia = ({ count, success }) => {
    assert.equal(count, 6);
    success({ tempFiles: [{ tempFilePath: '/first.png', size: 8 }, { tempFilePath: '/second.png', size: 8 }] });
  };
  wx.getFileSystemManager = () => ({
    readFile: ({ success }) => success({ data: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]).buffer }),
  });
  await form.onLoad({ petId: pet.id });
  await form.choosePhotos();
  await form.save();
  assert.equal(form.data.saved, false);
  assert.equal(form.data.photos.length, 2);
  assert.equal(payload, undefined);
  await form.save();
  assert.equal(form.data.saved, true);
  assert.deepEqual(uploads, ['/first.png', '/second.png', '/second.png']);
  assert.deepEqual(payload.photoAssetIds, ['asset-one', 'asset-two']);
  assert.equal(payload.note, null);
});

test('owner profile reads independently of pet failures and refreshes on return', async () => {
  const me = page('me', { listPets: async () => { throw { statusCode: 503 }; }, getProfile: async () => ({ nickname: '麦麦', avatarUrl: 'https://private.example/avatar' }) });
  await me.onShow();
  assert.equal(me.data.ownerName, '麦麦'); assert.equal(me.data.pets.length, 0);
  me.openProfile(); assert.deepEqual(navigation, ['navigateTo', '/pages/profile-edit/index']);
  me.onOwnerAvatarError(); assert.equal(me.data.ownerAvatar, '');
});

test('owner profile failure never retains prior identity while pets stay usable', async () => {
  let reads = 0;
  const me = page('me', { listPets: async () => ({ pets: [{ id: 'a' }] }), getProfile: async () => { if (++reads === 1) return { nickname: 'old', avatarUrl: 'https://private.example/old' }; throw { statusCode: 503 }; } });
  await me.onShow(); await me.onShow();
  assert.equal(me.data.ownerName, '养宠人'); assert.equal(me.data.ownerAvatar, ''); assert.equal(me.data.pets.length, 1);
});

test('owner nickname and uploaded avatar reconcile together without a second upload or write', async () => {
  let uploads = 0; let writes = 0; let stored = { nickname: '原昵称', avatarAssetId: null, avatarUrl: null };
  const form = page('profile-edit', {
    getProfile: async () => stored,
    uploadOwnerAvatar: async () => { uploads++; return { assetId: 'owner-photo' }; },
    updateProfile: async (payload) => { writes++; stored = { ...payload, avatarUrl: 'https://private.example/new' }; throw { statusCode: 502 }; },
  });
  await form.onLoad(); form.setData({ nickname: '新昵称' }); form.applyPhoto({ path: '/crop.jpg', bytes: new ArrayBuffer(4), mime: 'image/jpeg' });
  await form.saveProfile(); await form.saveProfile();
  assert.equal(form.data.saved, true); assert.equal(form.data.uncertain, false);
  assert.equal(form.data.avatarPreview, 'https://private.example/new'); assert.equal(uploads, 1); assert.equal(writes, 1);
});

test('uncertain owner save blocks edits and retry until a read confirms both fields', async () => {
  let reads = 0; let uploads = 0; let writes = 0;
  let stored = { nickname: '原昵称', avatarAssetId: null, avatarUrl: null };
  const form = page('profile-edit', {
    getProfile: async () => { if (++reads === 2) throw { statusCode: 503 }; return stored; },
    uploadOwnerAvatar: async () => { uploads++; return { assetId: 'photo' }; },
    updateProfile: async (payload) => { writes++; if (writes === 1) throw { statusCode: 502 }; stored = { ...payload, avatarUrl: 'https://private.example/new' }; return stored; },
  });
  await form.onLoad(); form.setData({ nickname: '新昵称' }); form.applyPhoto({ path: '/crop.jpg' });
  await form.saveProfile(); assert.equal(form.data.uncertain, true);
  form.onNickname({ detail: { value: '误改' } }); form.cancelAvatar(); await form.saveProfile();
  assert.equal(form.data.nickname, '新昵称'); assert.equal(form.data.photoSelected, true); assert.equal(writes, 1);
  stored = { nickname: '旧昵称', avatarAssetId: 'photo', avatarUrl: null };
  await form.checkSave(); assert.equal(form.data.saved, false); assert.equal(form.data.uncertain, false);
  await form.saveProfile(); assert.equal(form.data.saved, true); assert.equal(uploads, 1); assert.equal(writes, 2);
});

test('WeChat chosen avatar is read as a local draft and nickname quick-fill uses the same save flow', async () => {
  let uploaded; let payload; let releaseRead;
  wx.canIUse = () => true;
  wx.getFileSystemManager = () => ({ readFile: ({ success }) => { releaseRead = () => success({ data: Uint8Array.from([137,80,78,71,13,10,26,10,0]).buffer }); } });
  const form = page('profile-edit', { getProfile: async () => ({ nickname: '', avatarAssetId: null, avatarUrl: null }), uploadOwnerAvatar: async p => { uploaded = p; return { assetId: 'wx-photo' }; }, updateProfile: async p => { payload = p; return { ...p, avatarUrl: 'https://private.example/wx' }; } });
  await form.onLoad();
  assert.equal(form.data.wechatAvatarSupported, true);
  const choosing = form.onWechatAvatar({ detail: { avatarUrl: '/wechat-cropped.png' } });
  await form.saveProfile(); assert.equal(payload, undefined);
  releaseRead(); await choosing;
  assert.equal(form.data.avatarPreview, '/wechat-cropped.png');
  assert.equal(uploaded, undefined);
  form.onNickname({ detail: { value: '微信昵称' } }); await form.saveProfile();
  assert.equal(uploaded.path, '/wechat-cropped.png'); assert.equal(payload.nickname, '微信昵称');
});

test('owner failed or canceled recrop preserves the selected draft and uploaded asset', async () => {
  const form = page('profile-edit', { getProfile: async () => ({ nickname: '麦', avatarAssetId: null, avatarUrl: null }) });
  await form.onLoad(); const draft = { path: '/crop.jpg', sourcePath: '/original.jpg' };
  form.applyPhoto(draft); form.uploadedPhotoId = 'photo';
  wx.cropImage = ({ fail }) => fail({ errMsg: 'cropImage:fail cancel' });
  await form.recropAvatar(); assert.equal(form.photoDraft, draft); assert.equal(form.uploadedPhotoId, 'photo');
});

test('owner submit uses the current native nickname form value and blocks duplicate saves', async () => {
  let finish; let writes = 0; let payload;
  const form = page('profile-edit', { getProfile: async () => ({ nickname: '旧昵称', avatarAssetId: null, avatarUrl: null }), updateProfile: input => { writes++; payload = input; return new Promise(resolve => { finish = resolve; }); } });
  await form.onLoad();
  const pending = form.saveProfile({ detail: { value: { nickname: '微信刚填入的昵称' } } });
  await form.saveProfile({ detail: { value: { nickname: '误点' } } });
  assert.equal(writes, 1); assert.equal(payload.nickname, '微信刚填入的昵称');
  finish({ ...payload, avatarUrl: null }); await pending;
  assert.equal(form.data.saved, true);
});

test('community displays the renamed topic while filters and publishing retain the accepted API topic', async () => {
  let filter; let submission;
  const list = page('community', { listCommunityPosts: async (params) => { filter = params; return { posts: [{ id: 'post-a', topic: '晒栖境', title: '分享' }] }; } });
  assert.equal(list.data.topicLabels[2], '晒宠境');
  await list.selectTopic({ currentTarget: { dataset: { topic: list.data.topics[2] } } });
  assert.equal(filter.topic, '晒栖境');
  assert.equal(list.data.posts[0].tag, '晒栖境');
  assert.equal(list.data.posts[0].topicLabel, '晒宠境');
  const detail = page('community-detail', { getCommunityPost: async () => ({ id: 'post-a', topic: '晒栖境' }), listCommunityComments: async () => ({ comments: [] }) });
  await detail.onLoad({ id: 'post-a' });
  assert.equal(detail.data.post.topicLabel, '晒宠境');
  const compose = page('community-edit', { createCommunityPost: async (data) => { submission = data; } });
  compose.setData({ topicIndex: 1, title: '分享', body: '我的宠境' });
  assert.equal(compose.data.topicLabels[1], '晒宠境');
  await compose.submit();
  assert.equal(submission.topic, '晒栖境');
  assert.equal(compose.data.submitting, true);
});

function tabBar() {
  const filename = path.join(root, 'custom-tab-bar/index.js');
  delete require.cache[require.resolve(filename)];
  let definition;
  globalThis.Component = (value) => { definition = value; };
  require(filename);
  return { ...definition.methods, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
}

test('my pets rejects an old successful response after the current read fails', async () => {
  let finish;
  let reads = 0;
  const me = page('me', { listPets: () => ++reads === 1 ? new Promise((resolve) => { finish = resolve; }) : Promise.reject({ statusCode: 503 }) });
  const old = me.onShow();
  await me.onShow();
  finish({ pets: [{ id: 'old-pet', name: '不应残留' }] });
  await old;
  assert.deepEqual(me.data.pets, []);
  assert.equal(me.data.loaded, false);
  assert.equal(me.data.loading, false);
  assert.match(me.data.loadErrorDetail, /SERVICE_UNAVAILABLE/);
});

test('my pet card opens only a loaded pet and image fallback stops after species image', async () => {
  const me = page('me', { listPets: async () => ({ pets: [{ id: 'my/pet', speciesCode: 'rat', coverUrl: 'https://private.example/pet' }] }) });
  await me.onShow();
  navigation = undefined;
  me.editPet({ currentTarget: { dataset: { id: 'someone-else' } } });
  assert.equal(navigation, undefined);
  me.editPet({ currentTarget: { dataset: { id: 'my/pet' } } });
  assert.deepEqual(navigation, ['navigateTo', '/pages/pet-edit/index?id=my%2Fpet']);
  me.onAvatarError({ currentTarget: { dataset: { id: 'my/pet' } } });
  assert.equal(me.data.pets[0].avatarUrl, '/assets/species-rat.png');
  me.onAvatarError({ currentTarget: { dataset: { id: 'my/pet' } } });
  assert.equal(me.data.pets[0].avatarUrl, '');
});

test('custom navigation keeps actual route after failure and ignores duplicate or unknown taps', () => {
  const bar = tabBar();
  let call;
  wx.switchTab = (options) => { call = options; };
  const vibrations = [];
  wx.vibrateShort = ({ type }) => { vibrations.push(type); };
  bar.sync();
  bar.switchTab({ currentTarget: { dataset: { path: 'pages/me/index' } } });
  assert.equal(call.url, '/pages/me/index');
  call.fail();
  bar.switchTab({ currentTarget: { dataset: { path: 'pages/pet/index' } } });
  assert.equal(call.url, '/pages/me/index');
  call.complete();
  assert.equal(bar.data.selected, 'pages/home/index');
  call = undefined;
  bar.switchTab({ currentTarget: { dataset: { path: 'pages/viewer/index' } } });
  assert.equal(call, undefined);
  assert.deepEqual(vibrations, []);
  globalThis.getCurrentPages = () => [{ route: 'pages/pet/index', data: {} }];
  bar.sync();
  assert.equal(bar.data.selected, 'pages/pet/index');
});

test('tab navigation vibrates once after switching and works when haptics are unavailable', () => {
  const bar = tabBar();
  let route = 'pages/home/index';
  let pending;
  const vibrations = [];
  globalThis.getCurrentPages = () => [{ route, data: {} }];
  wx.switchTab = (options) => { pending = options; };
  wx.vibrateShort = ({ type, fail }) => { vibrations.push(type); fail(); };
  const tap = (path) => bar.switchTab({ currentTarget: { dataset: { path } } });

  tap(route);
  assert.equal(pending, undefined);
  tap('pages/pet/index');
  assert.deepEqual(vibrations, []);
  route = 'pages/pet/index';
  pending.success();
  pending.complete();
  assert.deepEqual(vibrations, ['light']);
  assert.equal(bar.data.selected, route);

  delete wx.vibrateShort;
  tap('pages/me/index');
  route = 'pages/me/index';
  pending.success();
  pending.complete();
  assert.deepEqual(vibrations, ['light']);
  assert.equal(bar.data.selected, route);
  assert.equal(notices.length, 0);
});

test('four tabs and custom component resources agree with the native app manifest', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json')));
  const { TABS, syncTabBar } = require(path.join(root, 'utils/navigation.js'));
  assert.equal(config.tabBar.custom, true);
  assert.deepEqual(TABS.map(({ text }) => text), ['首页', '宠物', '社区', '我的']);
  assert.deepEqual(config.tabBar.list, TABS.map(({ pagePath, text }) => ({ pagePath, text })));
  const bar = tabBar();
  for (const extension of ['.js', '.json', '.wxml', '.wxss']) assert.ok(fs.existsSync(path.join(root, 'custom-tab-bar/index' + extension)));
  assert.equal(typeof bar.switchTab, 'function');
  for (const tab of TABS) {
    assert.ok(config.pages.includes(tab.pagePath));
    for (const color of ['white', 'gray']) assert.ok(fs.existsSync(path.join(root, `assets/nav-${tab.icon}-${color}.png`)));
    globalThis.getCurrentPages = () => [{ route: tab.pagePath, data: {} }];
    bar.sync();
    assert.equal(bar.data.selected, tab.pagePath);
    syncTabBar({ route: tab.pagePath, getTabBar: () => bar });
    assert.equal(bar.data.selected, tab.pagePath);
  }
});

test('home modal hides custom navigation through onShow and cannot be closed during a write', () => {
  const home = page('home');
  const states = [];
  home.getTabBar = () => ({ setData: (state) => states.push(state) });
  home.setData({ loading: false, pet: { id: 'a', name: '团子' }, selectedPetId: 'a' });
  for (const open of [() => home.openWeightModal(), () => home.openCareModal({ currentTarget: { dataset: { kind: '喂食' } } }), () => home.openDeviceModal()]) {
    open();
    assert.equal(states.at(-1).hidden, true);
    home.onShow();
    assert.equal(states.at(-1).hidden, true);
    home.setData({ weightSaving: true }); home.closeModal();
    assert.equal(states.at(-1).hidden, true);
    home.setData({ weightSaving: false }); home.closeModal();
    assert.equal(states.at(-1).hidden, false);
  }
});

test('settings refresh preserves session and reports failed reads without a success notice', async () => {
  storage.set('petscape_session_token', 'keep-this');
  let finish; let reads = 0;
  const settings = page('settings', { listPets: () => { reads++; return new Promise((resolve, reject) => { finish = { resolve, reject }; }); } });
  const first = settings.refreshData();
  await settings.refreshData();
  assert.equal(reads, 1);
  finish.resolve({ pets: [{ id: 'a' }, { id: 'b' }] }); await first;
  assert.match(settings.data.refreshNotice, /2/);
  const second = settings.refreshData();
  finish.reject({ statusCode: 502 }); await second;
  assert.equal(settings.data.refreshNotice, '');
  assert.match(settings.data.loadErrorDetail, /SERVICE_UNAVAILABLE/);
  assert.equal(storage.get('petscape_session_token'), 'keep-this');
});

test('settings permissions open only after a tap and failed permission entry gives feedback', () => {
  const settings = page('settings');
  let options;
  wx.openSetting = (value) => { options = value; };
  settings.onLoad();
  assert.equal(options, undefined);
  settings.openPermissions();
  options.fail();
  assert.match(notices.at(-1).title, /权限设置/);
});

test('pet photo partial failure preserves the new pet ID and retries without duplicating the pet', async () => {
  let creates = 0; let uploads = 0; const changes = [];
  const form = page('pet-edit', {
    createPet: async () => { creates++; return { id: 'new-pet' }; },
    uploadPetPhoto: async () => { uploads++; if (uploads === 1) throw new Error('offline'); return { assetId: 'photo-a' }; },
    updatePet: async (id, data) => { changes.push({ id, data }); return { id, ...data }; },
  });
  form.setData({ 'form.name': '团子' });
  form.photoDraft = { path: '/temporary.jpg', bytes: new ArrayBuffer(4), mime: 'image/jpeg' };
  await form.submit();
  assert.equal(form.data.id, 'new-pet'); assert.equal(form.data.isEdit, true);
  assert.match(form.data.photoNotice, /档案已保存/);
  await form.submit();
  assert.equal(creates, 1); assert.equal(uploads, 2);
  assert.ok(changes.some(({ id, data }) => id === 'new-pet' && data.coverAssetId === 'photo-a'));
});

test('uncertain cover patch is reconciled before retry and successful upload is reused', async () => {
  let uploads = 0; let patch = 0; let serverCover = null;
  const form = page('pet-edit', {
    uploadPetPhoto: async () => { uploads++; return { assetId: 'photo-a' }; },
    updatePet: async (id, data) => { if (data.coverAssetId) { patch++; serverCover = data.coverAssetId; throw { statusCode: 502 }; } return { id }; },
    getPet: async () => ({ id: 'pet-a', coverAssetId: serverCover }),
  });
  form.setData({ id: 'pet-a', isEdit: true, 'form.name': '团子' });
  form.photoDraft = { path: '/temporary.jpg', bytes: new ArrayBuffer(4), mime: 'image/jpeg' };
  await form.submit();
  assert.equal(uploads, 1); assert.equal(patch, 1);
  assert.equal(form.photoDraft, null);
});

test('species stage references update options but never choose a stage for the owner', () => {
  const form = page('pet-edit');
  form.setData({ 'form.speciesCode': 'gecko', 'form.lifeStage': 'adult' });
  form.onInput({ currentTarget: { dataset: { field: 'breed' } }, detail: { value: '豹纹守宫' } });
  assert.match(form.data.lifeStageOptions[1].label, /7.*12/);
  assert.equal(form.data.form.lifeStage, 'adult');
  form.onInput({ currentTarget: { dataset: { field: 'breed' } }, detail: { value: '守宫' } });
  assert.ok(form.data.lifeStageOptions.slice(0, 4).every((item) => item.label.includes('年月待核实')));
});

test('pet list shows stored photo and falls back per pet if its signed image cannot load', async () => {
  const list = page('pet', { listPets: async () => ({ pets: [{ id: 'pet-a', speciesCode: 'rat', coverUrl: 'https://private.example/photo' }] }) });
  await list.onShow();
  assert.equal(list.data.pets[0].speciesImage, 'https://private.example/photo');
  list.onAvatarError({ currentTarget: { dataset: { id: 'pet-a' } } });
  assert.equal(list.data.pets[0].speciesImage, '/assets/species-rat.png');
});

test('recrop cancellation preserves photo draft and upload identity; pending crop blocks save and undo', async () => {
  let finish; let writes = 0;
  const form = page('pet-edit', { createPet: async () => { writes++; } });
  const draft = { path: '/crop.png', sourcePath: '/source.jpg', bytes: new ArrayBuffer(4), mime: 'image/png' };
  form.photoDraft = draft; form.uploadedPhotoId = 'existing-upload';
  form.setData({ photoSelected: true, photoPreview: draft.path, photoNotice: '已裁切', 'form.name': '团子' });
  wx.cropImage = ({ fail }) => { finish = fail; };
  const operation = form.recropPhoto();
  assert.equal(form.data.choosingPhoto, true);
  form.cancelPhoto(); await form.submit();
  assert.equal(form.photoDraft, draft); assert.equal(writes, 0);
  finish({ errMsg: 'cropImage:fail cancel' }); await operation;
  assert.equal(form.photoDraft, draft); assert.equal(form.uploadedPhotoId, 'existing-upload');
  assert.equal(form.data.photoPreview, draft.path); assert.equal(form.data.choosingPhoto, false);
});

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

test('home and old knowledge entry route into official community posts and preserve species filters', async () => {
  page('home').openAction({ currentTarget: { dataset: { path: '/pages/knowledge/index' } } });
  assert.deepEqual(navigation, ['switchTab', '/pages/community/index']);
  const community = page('community');
  await community.onShow();
  assert.equal(community.data.section, 'official');
  assert.equal(app.officialPostsEntry, undefined);
  await community.selectCategory({ currentTarget: { dataset: { category: '鹦鹉' } } });
  assert.equal(community.data.articles.length, 1);
  assert.equal(community.data.articles[0].category, '鹦鹉');
  page('knowledge').onLoad();
  await community.onShow();
  assert.equal(community.data.category, '全部');
  assert.ok(community.data.articles.length > 1);
});

test('official bookmarks persist across list and article and skip withdrawn articles', async () => {
  const community = page('community');
  const select = (section) => community.selectSection({ currentTarget: { dataset: { section } } });
  await select('official');
  const id = community.data.articles[0].id;
  community.starArticle({ currentTarget: { dataset: { id } } });
  assert.equal(community.data.articles[0].starred, true);
  community.openArticle({ currentTarget: { dataset: { id } } });
  assert.deepEqual(navigation, ['navigateTo', `/pages/article/index?id=${id}`]);
  const detail = page('article');
  await detail.onLoad({ id });
  assert.equal(detail.data.starred, true);
  require(path.join(root, 'utils/official-bookmarks.js')).toggleBookmark('withdrawn');
  await select('saved');
  assert.deepEqual(community.data.articles.map(item => item.id), [id]);
  detail.starArticle();
  await community.onShow();
  assert.deepEqual(community.data.articles, []);
});

test('late load of official posts cannot overwrite bookmarks view', async () => {
  const pending = deferred();
  const community = page('community', { listArticles: () => pending.promise });
  const select = (section) => community.selectSection({ currentTarget: { dataset: { section } } });
  const old = select('official');
  await select('saved');
  pending.resolve({ articles: [{ id: 'late' }] });
  await old;
  assert.equal(community.data.section, 'saved');
  assert.deepEqual(community.data.articles, []);
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
    require: (id) => id === './utils/config' ? { mockMode: false }
      : id === './utils/onboarding' ? { isHomeEntry: () => false, hasCompleted: () => false } : { track() {} },
  });
  definition.onLaunch();
  assert.equal(definition.globalData.mockMode, false);
});

test('home restores reading in real mode when opening onboarding fails', async () => {
  const home = page('home', { listPets: async () => ({ pets: [] }) });
  app.globalData.mockMode = false;
  let restore; app.openOnboarding = callback => { restore = callback; return true; };
  try {
    home.onShow(); assert.equal(home.data.mockMode, false);
    await restore(); assert.equal(home.data.loading, false);
  } finally { delete app.openOnboarding; }
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
  home.openWeightModal();
  home.onWeightInput({ detail: { value: '320' } });
  home.closeModal();
  await home.selectPet({ currentTarget: { dataset: { id: 'pet-b' } } });
  assert.equal(home.data.weightInput, '');
  home.openWeightModal();
  home.onWeightInput({ detail: { value: '0.72' } });
  home.onWeightUnit({ currentTarget: { dataset: { unit: 'kg' } } });
  home.closeModal();
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
    assert.equal(home.data.weightChart.latest.grams, 720);
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
  await home.loadSummary(); home.openWeightModal(); home.onWeightInput({ detail: { value: '0.325' } });
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
  assert.equal(home.data.weightChart.latest.grams, 325);
  assert.equal(home.data.weightChart.change, '+5 g');
  assert.deepEqual(home.data.weightChart.history.map((x) => x.id), ['old', 'new']);
});

test('home invalid weight never writes and an unconfirmed save requires a read before another write', async () => {
  let writes = 0;
  const home = page('home', { ...careApi, createCareLog: async () => { writes++; throw { statusCode: 502 }; } });
  await home.loadSummary();
  home.openWeightModal();
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
  await home.loadSummary(); home.openWeightModal(); home.onWeightInput({ detail: { value: '325' } });
  await home.saveWeight();
  assert.equal(home.data.weightInput, ''); assert.match(home.data.weightNotice, /已保存/);
  assert.ok(home.data.weightError); assert.deepEqual(home.data.weightChart.history, []);
  assert.equal(home.data.weightChart.latest, null); assert.equal(home.data.weightSaving, false);
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
  assert.equal(home.data.weightChart.latest.grams, 720);
  home.openWeightModal();
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

test('every carousel avatar opens its own detail and the home pet action opens the selected pet', async () => {
  const special = { id: 'pet b?/名', name: '团子' };
  const home = page('home', { ...careApi, listPets: async () => ({ pets: [carePets[0], special] }) });
  await home.loadSummary();
  home.openPetProfile({ currentTarget: { dataset: { id: special.id } } });
  assert.deepEqual(navigation, ['navigateTo', '/pages/pet-detail/index?id=' + encodeURIComponent(special.id)]);
  assert.equal(home.data.selectedPetId, 'pet-a');
  home.openPet(); assert.deepEqual(navigation, ['navigateTo', '/pages/pet-detail/index?id=pet-a']);
  let opens = 0; wx.navigateTo = () => { opens++; };
  home.openPetProfile({ currentTarget: { dataset: { id: 'not-own' } } });
  assert.equal(opens, 0);
});

test('care opened from detail follows the requested pet across reorder and never falls back when it disappears', async () => {
  let pets = [carePets[0], carePets[1]];
  const reads = [], writes = [];
  const care = page('care-log', {
    ...careApi, listPets: async () => ({ pets }),
    listCareLogs: async ({ petId }) => { reads.push(petId); return { logs: [] }; },
    createCareLog: async (payload) => { writes.push(payload); },
  });
  care.onLoad({ petId: 'pet-b' });
  await care.onShow();
  assert.equal(care.data.selectedPetId, 'pet-b');
  pets = [...pets].reverse(); await care.onShow();
  assert.equal(care.data.pets[care.data.petIndex].id, 'pet-b');
  pets = [carePets[0]]; await care.onShow();
  await care.submit();
  assert.match(care.data.error, /档案/);
  assert.deepEqual(reads, ['pet-b', 'pet-b']);
  assert.deepEqual(writes, []);
});

test('pet detail separates archive and record failures, and never reads care for an inaccessible pet', async () => {
  let reads = 0;
  const denied = page('pet-detail', {
    getPet: async () => { throw { statusCode: 404 }; },
    listCareLogs: async () => { reads++; return { logs: [] }; },
  });
  denied.onLoad({ id: 'pet-b' }); await denied.onShow();
  assert.equal(denied.data.pet, null);
  assert.equal(denied.data.petError.title, '宠物档案不可用');
  assert.equal(reads, 0);
  const detail = page('pet-detail', {
    getPet: async (id) => ({ id, name: '米粒', speciesCode: 'rat' }),
    listCareLogs: async () => { throw { statusCode: 503 }; },
  });
  detail.onLoad({ id: 'pet-a' }); await detail.onShow();
  assert.equal(detail.data.pet.id, 'pet-a');
  assert.equal(detail.data.petError, null);
  assert.equal(detail.data.recordsError.title, '服务暂时不可用');
  detail.openEdit(); assert.deepEqual(navigation, ['navigateTo', '/pages/pet-edit/index?id=pet-a']);
  detail.openCare(); assert.deepEqual(navigation, ['navigateTo', '/pages/care-log/index?petId=pet-a']);
});

test('pet detail charts only valid recorded weights and ignores late responses after refreshing', async () => {
  const delayed = deferred();
  let calls = 0;
  const measured = (id, petId, value, day) => ({ id, petId, value, kind: '体重', recordedAt: '2026-11-' + day + 'T09:00:00Z' });
  const detail = page('pet-detail', {
    getPet: async (id) => ({ id, name: '米粒', speciesCode: 'rat' }),
    listCareLogs: async ({ petId, limit }) => {
      assert.equal(petId, 'pet-a'); assert.equal(limit, 100);
      if (++calls === 1) return delayed.promise;
      return { logs: [measured('new', petId, '0.382kg', '23'), measured('old', petId, '376 克', '20'),
        measured('other', 'pet-b', '500g', '23'), measured('invalid', petId, '900', '23'),
        { ...measured('care', petId, '12g', '22'), kind: '喂食' }, { ...measured('foreign', 'pet-b', '1', '23'), kind: '清洁' }] };
    },
  });
  detail.onLoad({ id: 'pet-a' });
  const initial = detail.onShow();
  await Promise.resolve();
  await detail.onShow();
  delayed.resolve({ logs: [measured('late', 'pet-a', '88g', '23')] }); await initial;
  assert.deepEqual(detail.data.weights.map(row => row.grams), [376, 382]);
  assert.equal(detail.data.weightDelta, '+6 g'); assert.equal(detail.data.plot.segments.length, 1);
  assert.deepEqual(detail.data.recentCare.map(row => row.kind), ['喂食']);
  detail.setChartMode({ currentTarget: { dataset: { mode: 'bar' } } });
  assert.equal(detail.data.plot.ticks.at(-1), '0');
  assert.equal(detail.data.latestWeight.grams, 382);
});

test('native pet form removes size ranking without clearing legacy size data on edit', async () => {
  const writes = [];
  const form = page('pet-edit', {
    getPet: async () => ({ name: '团子', speciesCode: 'rat', sizeLevel: 4, lifeStage: 'adult' }),
    updatePet: async (id, payload) => { writes.push(payload); },
  });
  wx.setNavigationBarTitle = () => {};
  await form.onLoad({ id: 'existing' }); await form.submit();
  assert.equal(Object.hasOwn(form.data.form, 'sizeLevel'), false);
  assert.equal(Object.hasOwn(writes[0], 'sizeLevel'), false);
  const wxml = fs.readFileSync(path.join(root, 'pages/pet-edit/index.wxml'), 'utf8');
  assert.doesNotMatch(wxml, /体型等级|onSizeChange|<slider/);
  app.globalData.mockMode = true;
  assert.equal((await api.createPet({ name: '未评定体型', speciesCode: 'rat' })).sizeLevel, null);
});

test('native pet life stages support subadult and keep unsupported ages explicit by exact species', async () => {
  const saved = [];
  const form = page('pet-edit', { createPet: async payload => { CreatePetRequestSchema.parse(payload); saved.push(payload); } });
  assert.deepEqual(form.data.lifeStageOptions.map(option => option.value), ['juvenile', 'subadult', 'adult', 'senior', 'unknown']);
  assert.equal(form.data.lifeStageOptions[form.data.lifeStageIndex].value, 'unknown');
  form.onInput({ currentTarget: { dataset: { field: 'name' } }, detail: { value: '团子' } });
  form.onSpeciesChange({ detail: { value: '1' } });
  form.onInput({ currentTarget: { dataset: { field: 'breed' } }, detail: { value: '豹纹守宫' } });
  assert.equal(form.data.lifeStageReference.speciesName, '豹纹守宫');
  assert.match(form.data.lifeStageOptions[0].label, /0–7 个月/);
  assert.match(form.data.lifeStageOptions[1].label, /7–12 个月/);
  assert.match(form.data.lifeStageOptions[2].label, /12 个月以上/);
  assert.match(form.data.lifeStageOptions[3].label, /年月待核实/);
  form.onLifeStageChange({ detail: { value: '1' } });
  await form.submit(); assert.equal(saved[0].lifeStage, 'subadult');
});

test('life-stage references never extrapolate ages across broad species categories or guess unknown stored values', async () => {
  const { getLifeStageReference, lifeStageLabel } = require(path.join(root, 'utils/life-stages.js'));
  assert.equal(getLifeStageReference('gecko', '豹纹').speciesName, '具体物种待确认');
  assert.equal(getLifeStageReference('gecko', '玉米蛇').speciesName, '具体物种待确认');
  assert.equal(getLifeStageReference('snake', 'Pantherophis guttatus').speciesName, '玉米蛇');
  assert.equal(getLifeStageReference('parrot', '虎皮鹦鹉').speciesName, '虎皮鹦鹉');
  assert.equal(getLifeStageReference('other', '', '刺猬').speciesName, '刺猬');
  assert.equal(lifeStageLabel('subadult'), '亚成体');
  assert.equal(lifeStageLabel('adult'), '成体');
  wx.setNavigationBarTitle = () => {};
  for (const lifeStage of ['subadult', 'future_stage']) {
    const form = page('pet-edit', { getPet: async () => ({ name: '团子', speciesCode: 'snake', breed: '玉米蛇', lifeStage }) });
    await form.onLoad({ id: 'existing' });
    const expected = lifeStage === 'subadult' ? 'subadult' : 'unknown';
    assert.equal(form.data.form.lifeStage, expected);
    assert.equal(form.data.lifeStageOptions[form.data.lifeStageIndex].value, expected);
    if (lifeStage === 'future_stage') assert.match(form.data.lifeStageWarning, /重新确认/);
  }
});

test('bird senior ages remain species-specific and do not fill unrelated life stages', async () => {
  const { getLifeStageReference, getLifeStageOptions } = require(path.join(root, 'utils/life-stages.js'));
  for (const [name, senior] of [['虎皮鹦鹉', '超过 6 年'], ['Nymphicus hollandicus', '超过 12 年']]) {
    const reference = getLifeStageReference('parrot', name);
    const options = getLifeStageOptions(reference);
    assert.equal(reference.ranges.senior, senior);
    assert.equal(options[3].label, `老年（${senior}）`);
    assert.ok(options.slice(0, 3).every(option => option.label.includes('年月待核实')));
    assert.match(reference.sourceLabel, /AAV/);
    assert.match(reference.note, /不代表疾病诊断/);
  }
  assert.equal(getLifeStageReference('parrot', '鹦鹉').ranges, null);
  assert.equal(getLifeStageReference('gecko', '虎皮鹦鹉').ranges, null);
  assert.equal(getLifeStageReference('other', '', '玄凤鹦鹉').ranges.senior, '超过 12 年');
  const form = page('pet-edit');
  form.onSpeciesChange({ detail: { value: '3' } });
  form.onInput({ currentTarget: { dataset: { field: 'breed' } }, detail: { value: '虎皮鹦鹉' } });
  assert.equal(form.data.form.lifeStage, 'unknown');
  assert.equal(form.data.lifeStageOptions[3].label, '老年（超过 6 年）');
  form.onInput({ currentTarget: { dataset: { field: 'breed' } }, detail: { value: '玄凤鹦鹉' } });
  assert.equal(form.data.lifeStageOptions[3].label, '老年（超过 12 年）');
});

test('AAV geriatric ages match only six exact parrot species and leave earlier stages pending', () => {
  const { getLifeStageReference, getLifeStageOptions } = require(path.join(root, 'utils/life-stages.js'));
  const references = [
    ['Agapornis roseicollis', '桃脸牡丹鹦鹉', '超过 10 年'],
    ['Psittacus erithacus', '非洲灰鹦鹉', '超过 15 年'],
    ['Eolophus roseicapilla', '粉红凤头鹦鹉（Galah）', '超过 18 年'],
    ['Cacatua alba', '白凤头鹦鹉', '超过 20 年'],
    ['Amazona aestiva', '蓝顶亚马逊鹦鹉', '超过 25 年'],
    ['Ara ararauna', '琉璃金刚鹦鹉（蓝黄金刚鹦鹉）', '超过 30 年'],
  ];
  for (const [latinName, speciesName, senior] of references) {
    const reference = getLifeStageReference('parrot', latinName);
    assert.equal(reference.speciesName, speciesName);
    assert.equal(reference.ranges.senior, senior);
    assert.ok(getLifeStageOptions(reference).slice(0, 3).every(option => option.label.includes('年月待核实')));
    assert.match(reference.note, /老年养护参考/);
  }
  for (const broadName of ['鹦鹉', '金刚鹦鹉', '凤头鹦鹉', '牡丹鹦鹉']) {
    assert.equal(getLifeStageReference('parrot', broadName).ranges, null);
  }
});

test('rat senior reference is visible before input and does not spread to other rodents', async () => {
  const { getLifeStageReference, getLifeStageOptions } = require(path.join(root, 'utils/life-stages.js'));
  const form = page('pet-edit');
  assert.equal(form.data.lifeStageOptions[3].label, '老年（超过 1 年 6 个月）');
  assert.equal(form.data.form.lifeStage, 'unknown');
  assert.ok(form.data.lifeStageOptions.slice(0, 3).every(option => option.label.includes('年月待核实')));
  const reference = getLifeStageReference('rat', '卷毛');
  assert.equal(reference.ranges.senior, '超过 1 年 6 个月');
  assert.match(reference.sourceLabel, /Molesey Vets/);
  assert.equal(getLifeStageReference('other', '', 'Rattus norvegicus').ranges.senior, reference.ranges.senior);
  for (const species of ['仓鼠', '沙鼠', 'rat', '鼠类']) {
    assert.equal(getLifeStageReference('other', '', species).ranges, null);
  }
  form.onSpeciesChange({ detail: { value: '2' } });
  assert.ok(form.data.lifeStageOptions.slice(0, 4).every(option => option.label.includes('年月待核实')));
  form.onSpeciesChange({ detail: { value: '0' } });
  assert.equal(form.data.lifeStageOptions[3].label, '老年（超过 1 年 6 个月）');
  assert.equal(form.data.form.lifeStage, 'unknown');
  assert.equal(getLifeStageOptions(getLifeStageReference('parrot', '虎皮鹦鹉'))[3].label, '老年（超过 6 年）');
});

test('editing an unrecognized legacy stage requires explicit confirmation before any update', async () => {
  const updates = [];
  wx.setNavigationBarTitle = () => {};
  const form = page('pet-edit', {
    getPet: async () => ({ name: '旧档案', speciesCode: 'rat', lifeStage: 'future_stage' }),
    updatePet: async (id, payload) => { updates.push(payload); },
  });
  await form.onLoad({ id: 'existing' });
  form.onInput({ currentTarget: { dataset: { field: 'name' } }, detail: { value: '只改名字' } });
  await form.submit(); assert.equal(updates.length, 0);
  form.onLifeStageChange({ detail: { value: String(form.data.lifeStageOptions.findIndex(option => option.value === 'unknown')) } });
  await form.submit(); assert.equal(updates.length, 1); assert.equal(updates[0].lifeStage, 'unknown');
});

test('home weight editor opens as a modal and fixes the pet until canceled or saved', async () => {
  const home = page('home', careApi);
  await home.loadSummary(); home.setData({ weightNotice: '体重已保存' }); home.openWeightModal();
  assert.equal(home.data.weightNotice, '');
  assert.equal(home.data.activeModal, 'weight'); assert.equal(home.data.modalPetId, 'pet-a');
  await home.onPetSwipe({ detail: { current: 1 } });
  assert.equal(home.data.selectedPetId, 'pet-a');
  home.onWeightInput({ detail: { value: '321' } }); home.closeModal();
  assert.equal(home.data.activeModal, ''); assert.equal(home.data.weightInput, '321');
  await home.selectPet({ currentTarget: { dataset: { id: 'pet-b' } } });
  home.openWeightModal(); assert.equal(home.data.modalPetId, 'pet-b');
  assert.equal(home.data.weightInput, '');
});

test('home line and bar views use the same valid weights and single measurements never gain fake segments', async () => {
  let logs = [{ id: 'one', petId: 'pet-a', kind: '体重', value: '320g', recordedAt: '2026-11-15T00:00:00Z' }];
  const home = page('home', { ...careApi, listCareLogs: async () => ({ logs }) });
  await home.loadSummary(); assert.equal(home.data.weightChart.points.length, 1); assert.equal(home.data.weightChart.segments.length, 0);
  logs.push({ id: 'two', petId: 'pet-a', kind: '体重', value: '0.325kg', recordedAt: '2026-11-16T00:00:00Z' });
  await home.loadWeights();
  const history = structuredClone(home.data.weightChart.history);
  home.setChartMode({ currentTarget: { dataset: { mode: 'line' } } });
  assert.equal(home.data.weightChartMode, 'line'); assert.equal(home.data.weightChart.segments.length, 1);
  assert.equal(home.data.weightChart.points.at(-1).grams, 325);
  assert.ok(home.data.weightChart.segments.every(line => Number.isFinite(line.angle) && line.length > 0));
  home.setChartMode({ currentTarget: { dataset: { mode: 'bar' } } });
  assert.deepEqual(home.data.weightChart.history, history);
});

test('home feeding card reads only the selected pets latest feeding without inventing quantities', async () => {
  const home = page('home', { ...careApi, listCareLogs: async () => ({ logs: [
    { id: 'old', petId: 'pet-a', kind: '喂食', value: '2只蟋蟀', recordedAt: '2026-11-14T00:00:00Z' },
    { id: 'latest', petId: 'pet-a', kind: '喂食', value: null, note: '正常进食', recordedAt: '2026-11-16T00:00:00Z' },
    { id: 'unitless', petId: 'pet-a', kind: '喂食', value: '88', recordedAt: '2026-11-14T00:00:00Z' },
    { id: 'combined', petId: 'pet-a', kind: '喂食', value: '主粮 5 g + 蟋蟀 2 只', recordedAt: '2026-11-15T00:00:00Z' },
    { id: 'foreign', petId: 'pet-b', kind: '喂食', value: '999g', recordedAt: '2026-11-17T00:00:00Z' },
    { id: 'water', petId: 'pet-a', kind: '换水', value: '100ml', recordedAt: '2026-11-18T00:00:00Z' },
  ] }) });
  await home.loadSummary();
  assert.equal(home.data.latestFeeding.id, 'latest');
  assert.equal(home.data.latestFeeding.displayValue, '已记录喂食');
  assert.equal(home.data.latestFeeding.note, '正常进食');
  assert.deepEqual(home.data.feedingChart.history, []);
  assert.equal(home.data.feedingChart.latest, null);
});

test('home feeding grams use the existing care payload and chart without mixing with body weight or other pets', async () => {
  const logs = [
    { id: 'old', petId: 'pet-a', kind: '喂食', value: '5 克', recordedAt: '2026-11-14T00:00:00Z' },
    { id: 'weight', petId: 'pet-a', kind: '体重', value: '300g', recordedAt: '2026-11-15T00:00:00Z' },
    { id: 'other', petId: 'pet-b', kind: '喂食', value: '99g', recordedAt: '2026-11-15T00:00:00Z' },
  ];
  const writes = [];
  const home = page('home', { ...careApi, listCareLogs: async () => ({ logs }),
    createCareLog: async (payload) => { writes.push(payload); logs.push({ id: 'new', ...payload }); } });
  await home.loadSummary();
  assert.equal(home.data.feedingChart.points.length, 1);
  assert.deepEqual(home.data.feedingChart.segments, []);
  home.openCareModal({ currentTarget: { dataset: { kind: '喂食' } } });
  home.onFeedingGrams({ detail: { value: '0.0001' } });
  await home.saveCareRecord();
  assert.equal(writes.length, 0);
  assert.equal(home.data.activeModal, 'care');
  home.onFeedingGrams({ detail: { value: '5.625' } });
  home.onCareValue({ detail: { value: '主粮' } });
  home.onCareNote({ detail: { value: '正常进食' } });
  await home.saveCareRecord();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].petId, 'pet-a');
  assert.equal(writes[0].kind, '喂食');
  assert.equal(writes[0].value, '5.625g');
  assert.equal(writes[0].note, '食物：主粮\n正常进食');
  assert.deepEqual(home.data.feedingChart.history.map(item => item.grams), [5, 5.625]);
  assert.equal(home.data.feedingChart.change, '+0.625 g');
  assert.equal(home.data.feedingChart.segments.length, 1);
  home.setChartMode({ currentTarget: { dataset: { kind: '喂食', mode: 'line' } } });
  assert.equal(home.data.feedingChartMode, 'line');
  assert.equal(home.data.weightChartMode, 'bar');
  assert.equal(home.data.weightChart.latest.grams, 300);
  await home.selectPet({ currentTarget: { dataset: { id: 'pet-b' } } });
  assert.deepEqual(home.data.feedingChart.history.map(item => item.grams), [99]);
});

test('home four care buttons open confirmation modals and save once to their fixed pet', async () => {
  for (const kind of ['喂食', '换水', '清洁', '生病']) {
    const pending = deferred(); const writes = [];
    const home = page('home', { ...careApi, createCareLog: async payload => { writes.push(payload); await pending.promise; } });
    await home.loadSummary(); home.openCareModal({ currentTarget: { dataset: { kind } } });
    assert.equal(home.data.activeModal, 'care'); assert.equal(writes.length, 0);
    home.onCareNote({ detail: { value: '今天的观察' } }); home.onCareValue({ detail: { value: kind === '喂食' ? '2只蟋蟀' : '' } });
    const save = home.saveCareRecord();
    home.closeModal(); await home.onPetSwipe({ detail: { current: 1 } }); await home.saveWeight(); await home.saveCareRecord();
    assert.equal(home.data.activeModal, 'care'); assert.equal(home.data.selectedPetId, 'pet-a');
    pending.resolve(); await save;
    assert.equal(writes.length, 1); assert.equal(writes[0].petId, 'pet-a'); assert.equal(writes[0].kind, kind);
    assert.equal(home.data.activeModal, ''); assert.equal(home.data.careSaving, false);
  }
});

test('ambiguous home care failures preserve their own drafts and require a successful read before retry', async () => {
  let writes = 0; let readFails = false;
  const home = page('home', { ...careApi, listCareLogs: async () => { if (readFails) throw { statusCode: 503 }; return { logs: [] }; },
    createCareLog: async () => { writes++; throw { statusCode: 502 }; } });
  await home.loadSummary(); home.openCareModal({ currentTarget: { dataset: { kind: '喂食' } } });
  home.onCareNote({ detail: { value: '喂食草稿' } }); await home.saveCareRecord(); await home.saveCareRecord();
  assert.equal(writes, 1); assert.equal(home.data.careUnconfirmed, true);
  home.closeModal(); home.openCareModal({ currentTarget: { dataset: { kind: '清洁' } } });
  assert.equal(home.data.careNote, ''); home.closeModal(); home.openCareModal({ currentTarget: { dataset: { kind: '喂食' } } });
  assert.equal(home.data.careNote, '喂食草稿'); assert.equal(home.data.careUnconfirmed, true);
  readFails = true; await home.refreshCareRecords(); assert.equal(home.data.careUnconfirmed, true);
  readFails = false; await home.refreshCareRecords(); assert.equal(home.data.careUnconfirmed, false);
});

test('a late care refresh cannot unlock a different or reopened confirmation modal', async () => {
  for (const reopenKind of ['清洁', '喂食']) {
    const pending = deferred();
    let reads = 0; let writes = 0;
    const home = page('home', { ...careApi,
      listCareLogs: async () => ++reads === 1 ? { logs: [] } : pending.promise,
      createCareLog: async () => { writes++; throw { statusCode: 502 }; },
    });
    const open = (kind) => home.openCareModal({ currentTarget: { dataset: { kind } } });
    await home.loadSummary();
    for (const kind of ['喂食', '清洁']) {
      open(kind); home.onCareNote({ detail: { value: kind + '草稿' } });
      await home.saveCareRecord(); home.closeModal();
    }
    open('喂食');
    const refresh = home.refreshCareRecords();
    home.closeModal(); open(reopenKind);
    assert.equal(home.data.careUnconfirmed, true);
    pending.resolve({ logs: [] }); await refresh;
    assert.equal(home.data.careUnconfirmed, true);
    assert.equal(home.data.careNote, reopenKind + '草稿');
    await home.saveCareRecord(); assert.equal(writes, 2);
  }
});

test('illness observations require a description and device entry never fabricates a connected reading', async () => {
  let writes = 0;
  const home = page('home', { ...careApi, createCareLog: async () => { writes++; } });
  await home.loadSummary(); home.openCareModal({ currentTarget: { dataset: { kind: '生病' } } });
  await home.saveCareRecord(); assert.equal(writes, 0);
  home.closeModal(); home.openDeviceModal();
  assert.equal(home.data.activeModal, 'device'); assert.equal(home.data.modalPetId, 'pet-a');
});

test('home care drafts stay with their pet after switching away and returning', async () => {
  const home = page('home', careApi);
  await home.loadSummary(); home.openCareModal({ currentTarget: { dataset: { kind: '喂食' } } });
  home.onCareValue({ detail: { value: '主粮' } }); home.onFeedingGrams({ detail: { value: '5.5' } }); home.onCareNote({ detail: { value: 'A 的草稿' } }); home.closeModal();
  await home.selectPet({ currentTarget: { dataset: { id: 'pet-b' } } });
  home.openCareModal({ currentTarget: { dataset: { kind: '喂食' } } });
  assert.equal(home.data.careValue, ''); assert.equal(home.data.careNote, ''); assert.equal(home.data.feedingGrams, '');
  home.onCareNote({ detail: { value: 'B 的草稿' } }); home.closeModal();
  await home.selectPet({ currentTarget: { dataset: { id: 'pet-a' } } });
  home.openCareModal({ currentTarget: { dataset: { kind: '喂食' } } });
  assert.equal(home.data.careValue, '主粮'); assert.equal(home.data.careNote, 'A 的草稿'); assert.equal(home.data.feedingGrams, '5.5');
});

test('confirmed home care writes remain saved when their following read fails', async () => {
  let reads = 0; let writes = 0;
  const home = page('home', { ...careApi,
    listCareLogs: async () => { if (++reads > 1) throw { statusCode: 503 }; return { logs: [] }; },
    createCareLog: async () => { writes++; },
  });
  await home.loadSummary(); home.openCareModal({ currentTarget: { dataset: { kind: '换水' } } });
  await home.saveCareRecord(); await home.saveCareRecord();
  assert.equal(writes, 1); assert.equal(home.data.activeModal, '');
  assert.match(home.data.recordNotice, /换水已保存/); assert.match(home.data.recordNotice, /暂未刷新/);
  assert.equal(home.data.careUnconfirmed, false); assert.equal(home.data.careNote, '');
});
