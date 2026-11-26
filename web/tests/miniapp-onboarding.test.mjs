import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../miniapp/app.js', import.meta.url));
const onboarding = require('./utils/onboarding.js');
let storage;
test.beforeEach(() => {
  storage = new Map();
  globalThis.wx = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value) };
});

function application() {
  let app;
  vm.runInNewContext(fs.readFileSync(new URL('../../miniapp/app.js', import.meta.url), 'utf8'), {
    App: value => { app = value; }, wx: globalThis.wx,
    require: name => name.endsWith('/onboarding') ? onboarding : name.endsWith('/analytics') ? { track() {} } : {},
  });
  return app;
}
function guide() {
  delete require.cache[require.resolve('./pages/onboarding/index.js')];
  let page; globalThis.Page = value => { page = value; };
  require('./pages/onboarding/index.js');
  page.data = structuredClone(page.data);
  page.setData = value => Object.assign(page.data, value);
  return page;
}

test('first home visit opens once, and returning after completion never opens it again', () => {
  const app = application(); let navigations = 0;
  wx.navigateTo = ({ url }) => { assert.equal(url, '/pages/onboarding/index?entry=first'); navigations++; };
  app.onLaunch({ path: 'pages/home/index', query: {} });
  assert.equal(app.takeBrandLaunch(), true);
  assert.equal(app.takeBrandLaunch(), false);
  assert.equal(app.openOnboarding(), true); assert.equal(app.openOnboarding(), false);
  onboarding.complete(); app.onLaunch({ path: 'pages/home/index', query: {} });
  assert.equal(app.takeBrandLaunch(), true);
  assert.equal(app.openOnboarding(), false); assert.equal(navigations, 1);
});

test('cold and warm share or scan destinations keep their original route and arguments', () => {
  for (const entry of [
    { path: 'pages/article/index', query: { id: 'article-a' }, scene: 1007 },
    { path: 'pages/community-detail/index', query: { id: 'post-a' }, scene: 1047 },
    { path: 'pages/home/index', query: { scene: 'encoded-destination' } },
    { path: 'pages/home/index', query: {}, referrerInfo: { appId: 'external' } },
    { path: 'pages/home/index', query: {}, scene: 1007 },
    { path: 'pages/home/index', query: {}, scene: 1011 },
  ]) {
    const before = JSON.stringify(entry); const app = application();
    wx.navigateTo = () => assert.fail('must retain original destination');
    app.onLaunch(entry); assert.equal(app.openOnboarding(), false); assert.equal(app.takeBrandLaunch(), false);
    app.onLaunch({ path: 'pages/home/index', query: {} }); app.onShow(entry);
    assert.equal(app.openOnboarding(), false); assert.equal(JSON.stringify(entry), before);
    assert.equal(app.takeBrandLaunch(), false);
  }
});

test('onboarding entry failure restores home reading without an endless redirect', () => {
  const app = application(); let recoveries = 0;
  wx.navigateTo = options => options.fail();
  app.onLaunch({ path: 'pages/home/index', query: {} });
  assert.equal(app.openOnboarding(() => { recoveries++; }), true);
  assert.equal(recoveries, 1); assert.equal(app.openOnboarding(), false); assert.equal(onboarding.hasCompleted(), false);
});

test('skip and finish lock repeated taps, return home and mark complete only after successful navigation', () => {
  const page = guide(); let options; let calls = 0;
  wx.switchTab = value => { options = value; calls++; };
  page.next(); assert.equal(page.data.current, 1);
  page.onChange({ detail: { current: 2 } }); page.next(); page.finish(); page.next();
  assert.equal(calls, 1); assert.equal(options.url, '/pages/home/index'); assert.equal(onboarding.hasCompleted(), false);
  options.success(); assert.equal(onboarding.hasCompleted(), true);
});

test('failed home navigation unlocks retry, and unavailable local storage never blocks using the app', () => {
  const page = guide(); let options; const messages = [];
  wx.switchTab = value => { options = value; }; wx.showToast = value => messages.push(value.title);
  page.finish(); options.fail(); assert.equal(page.data.leaving, false); assert.equal(onboarding.hasCompleted(), false);
  assert.match(messages[0], /重试/);
  wx.getStorageSync = () => { throw Error('unavailable'); }; wx.setStorageSync = () => { throw Error('quota'); };
  assert.equal(onboarding.hasCompleted(), false); page.finish(); assert.doesNotThrow(() => options.success());
});

test('invalid slide events cannot move the guide past its three pages', () => {
  const page = guide();
  for (const current of [-1, 3, NaN, '1']) page.onChange({ detail: { current } });
  assert.equal(page.data.current, 0);
  page.setData({ leaving: true }); page.onChange({ detail: { current: 1 } });
  assert.equal(page.data.current, 0);
});

test('animal illustrations have pure white outer pixels without the previous rectangle frame', async () => {
  const sharp = createRequire(new URL('../package.json', import.meta.url))('sharp');
  for (const name of ['rat', 'gecko', 'snake', 'parrot', 'spider']) {
    const { data, info } = await sharp(fileURLToPath(new URL(`../../miniapp/assets/onboarding/${name}.png`, import.meta.url))).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 256); assert.equal(info.height, 256);
    let dark = 0;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const pixel = data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3);
      if (x < 8 || y < 8 || x >= info.width - 8 || y >= info.height - 8) assert.ok(pixel.every(value => value === 255), `${name}: white exterior`);
      if (Math.min(...pixel) < 220) dark++;
    }
    assert.ok(dark > 1500, `${name}: animal remains visible`);
  }
});
