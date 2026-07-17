/* Batch3 5B verifier — independent acceptance run against http://localhost:3013 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const EXE = '<USER_HOME>/Library/Caches/ms-playwright/chromium-1187/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const BASE = 'http://localhost:3013';
const SHOTS = '<REPOSITORY_ROOT>/tools/verify-batch3/shots';
const PET_PHOTO = '<REPOSITORY_ROOT>/.claude/worktrees/agent-a57af23c3c445901b/web/public/assets/species-rat.png';
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const INIT = `(() => {
  window.__threeCaps = [];
  const tgt = new EventTarget();
  tgt.addEventListener('observe', (e) => {
    const obj = e.detail;
    if (obj && typeof obj.render === 'function' && typeof obj.setSize === 'function' && obj.domElement) {
      const cap = { renderer: obj, scene: null, camera: null };
      window.__threeCaps.push(cap);
      const orig = obj.render.bind(obj);
      obj.render = function (scene, camera) { cap.scene = scene; cap.camera = camera; return orig(scene, camera); };
    }
  });
  window.__THREE_DEVTOOLS__ = tgt;
})()`;

// scene summary of the SceneViewer scene (background #f3f1ec, connected canvas)
const SCENE_FN = `(() => {
  const caps = window.__threeCaps || [];
  const cap = caps.find(c => c.scene && c.scene.background && c.scene.background.getHexString
    && c.scene.background.getHexString() === 'f3f1ec' && c.renderer.domElement.isConnected);
  if (!cap) return null;
  const kids = cap.scene.children.map(o => ({
    type: o.type,
    bb: o.userData ? o.userData.isBillboard : undefined,
    pos: [o.position.x, o.position.y, o.position.z],
    quat: [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w],
  }));
  const cam = cap.camera ? { pos: [cap.camera.position.x, cap.camera.position.y, cap.camera.position.z],
    quat: [cap.camera.quaternion.x, cap.camera.quaternion.y, cap.camera.quaternion.z, cap.camera.quaternion.w] } : null;
  return { kids, cam };
})()`;

const modOf = (info) => info ? info.kids.filter(k => k.bb !== undefined) : [];
const glbs = (info) => modOf(info).filter(k => k.bb === false);
const bbs = (info) => modOf(info).filter(k => k.bb === true);
const petOf = (info) => info ? info.kids.filter(k => k.bb === undefined && (k.type === 'Group' || k.type === 'Object3D')) : [];
const qdot = (a, b) => Math.abs(a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3]);

async function poll(page, fn, timeoutMs = 30000, every = 400) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await page.waitForTimeout(every);
  }
  return null;
}

async function newPage(browser, url) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const errors = { pageerrors: [], consoleErrors: [] };
  page.on('pageerror', e => errors.pageerrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.consoleErrors.push(m.text()); });
  await page.addInitScript(INIT);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.preview-section', { timeout: 30000 });
  return { ctx, page, errors };
}

async function sceneInfo(page) { return page.evaluate(SCENE_FN); }

async function openMarket(page) {
  const btn = page.locator('.view-more-button');
  await btn.scrollIntoViewIfNeeded();
  if ((await btn.textContent()).includes('查看更多')) await btn.click();
  await page.waitForTimeout(400);
}

async function toggleModule(page, title) {
  const card = page.locator('.module-card', { has: page.locator(`h3:text-is("${title}")`) });
  await card.scrollIntoViewIfNeeded();
  await card.locator('button').click();
  await page.waitForTimeout(300);
}

async function subtotal(page) {
  const t = await page.locator('.preview-side > .preview-total strong').textContent();
  return parseInt(t.replace(/[^\d]/g, ''), 10) || 0;
}

async function chips(page) {
  return page.$$eval('.preview-chips span', els => els.map(e => e.textContent.trim()));
}

async function flowStates(page) {
  return page.$$eval('.flow-step', els => els.map(el => ({
    name: el.querySelector('strong').textContent.trim(),
    active: getComputedStyle(el).backgroundColor === 'rgb(0, 0, 0)',
  })));
}

async function shootPreview(page, name) {
  const board = page.locator('.preview-board');
  await board.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await board.screenshot({ path: path.join(SHOTS, name) });
}

async function shootFlow(page, name) {
  const sec = page.locator('.order-section');
  await sec.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await sec.screenshot({ path: path.join(SHOTS, name) });
}

function record(story, pass, details) {
  results.push({ story, pass, details });
  log(`Story ${story}: ${pass ? 'PASS' : 'FAIL'}`);
  for (const d of details) log('   -', d);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });

  // ---------------- Story 1: 画布混合渲染 ----------------
  try {
    const { ctx, page } = await newPage(browser, BASE + '/');
    const det = [];
    let ok = true;
    // defaults: cheese-lounge-bed(GLB ¥89) + hanging-climb-baskets(GLB ¥59) selected
    await openMarket(page);
    await toggleModule(page, '星桥拱门躲屋'); // star-bridge-hide, billboard ¥59
    await page.locator('.preview-board').scrollIntoViewIfNeeded();
    const info1 = await poll(page, async () => {
      const i = await sceneInfo(page);
      return (i && glbs(i).length === 2 && bbs(i).length === 1) ? i : null;
    }, 40000);
    if (!info1) { ok = false; det.push('FAIL: scene did not reach 2 GLB + 1 billboard within 40s: ' + JSON.stringify(await sceneInfo(page))); }
    else det.push(`scene has ${glbs(info1).length} GLB group(s) + ${bbs(info1).length} billboard plane(s)`);
    await shootPreview(page, 's1-1-mixed-before-drag.png');

    // drag rotate on canvas
    const canvas = page.locator('.preview-section canvas');
    const box = await canvas.boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const before = await sceneInfo(page);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(cx + i * 20, cy + i * 6);
    await page.mouse.up();
    await page.waitForTimeout(1200); // damping settle
    const after = await sceneInfo(page);
    await shootPreview(page, 's1-2-mixed-after-drag.png');
    if (before && after) {
      const camMoved = before.cam.pos.some((v, i) => Math.abs(v - after.cam.pos[i]) > 5);
      const bbBefore = bbs(before)[0], bbAfter = bbs(after)[0];
      const glbBefore = glbs(before)[0], glbAfter = glbs(after)[0];
      const bbTracks = bbAfter && qdot(bbAfter.quat, after.cam.quat) > 0.999;
      const bbRotated = bbBefore && bbAfter && qdot(bbBefore.quat, bbAfter.quat) < 0.9999;
      const glbStill = glbBefore && glbAfter && qdot(glbBefore.quat, glbAfter.quat) > 0.9999;
      det.push(`drag: cameraMoved=${camMoved}, billboard·camera quat |dot|=${bbAfter ? qdot(bbAfter.quat, after.cam.quat).toFixed(6) : 'n/a'} (faces camera=${bbTracks}), billboardRotatedWithView=${bbRotated}, glbUnchanged=${glbStill}`);
      if (!camMoved || !bbTracks || !glbStill) ok = false;
    } else { ok = false; det.push('FAIL: scene info unavailable around drag'); }

    // remove the billboard module -> object disappears, chips & subtotal shrink
    const chipsBefore = await chips(page);
    const subBefore = await subtotal(page);
    await toggleModule(page, '星桥拱门躲屋');
    const gone = await poll(page, async () => {
      const i = await sceneInfo(page);
      return (i && bbs(i).length === 0 && glbs(i).length === 2) ? i : null;
    }, 15000);
    const chipsAfter = await chips(page);
    const subAfter = await subtotal(page);
    await shootPreview(page, 's1-3-after-remove.png');
    det.push(`remove: billboardGone=${!!gone}, chips ${chipsBefore.length}->${chipsAfter.length} (${JSON.stringify(chipsAfter)}), subtotal ¥${subBefore}->¥${subAfter} (expect ¥${subBefore - 59})`);
    if (!gone || chipsAfter.length !== chipsBefore.length - 1 || chipsAfter.includes('星桥拱门躲屋') || subAfter !== subBefore - 59) ok = false;
    record(1, ok, det);
    await ctx.close();
  } catch (e) { record(1, false, ['EXCEPTION: ' + e.stack]); }

  // ---------------- Story 2: 场景包假闭环 ----------------
  try {
    const { ctx, page } = await newPage(browser, BASE + '/');
    const det = [];
    let ok = true;
    // clear the 2 default modules so N0 has no overlap with pack (precise amount assertion)
    await openMarket(page);
    await toggleModule(page, '奶酪软垫小床');
    await toggleModule(page, '悬挂藤篮阶梯');
    const n0 = await subtotal(page);
    det.push(`N0 = ¥${n0} (defaults cleared for exact-amount assertion; note addModules dedups via Set union)`);
    await shootPreview(page, 's2-1-n0.png');

    const forestBtn = page.locator('.scene-card', { has: page.locator('h3:text-is("森林奶酪屋")') }).locator('button');
    await forestBtn.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, 's2-2-packs-before.png') });
    await forestBtn.click();
    await page.waitForTimeout(500);
    const forestModules = ['奶酪软垫小床', '香蕉软垫小床', '悬挂藤篮阶梯', '奶酪洞洞层板']; // 89+89+59+59 = 296
    const expected1 = n0 + 296;
    const chips1 = await chips(page);
    const sub1 = await subtotal(page);
    const btnTxt1 = (await forestBtn.textContent()).trim();
    const btnDisabled1 = await forestBtn.isDisabled();
    const sceneOk1 = await poll(page, async () => {
      const i = await sceneInfo(page);
      return (i && modOf(i).length === 4) ? i : null;
    }, 40000);
    det.push(`森林奶酪屋 click: chips=${JSON.stringify(chips1)}, subtotal=¥${sub1} (expect ¥${expected1}), button="${btnTxt1}" disabled=${btnDisabled1}, scene modules=${sceneOk1 ? modOf(sceneOk1).length : 'timeout'}`);
    if (!forestModules.every(m => chips1.includes(m)) || sub1 !== expected1 || btnTxt1 !== '已加入' || !sceneOk1) ok = false;
    await shootPreview(page, 's2-3-forest-added.png');

    // second pack stacks, does not clear the first
    const rainBtn = page.locator('.scene-card', { has: page.locator('h3:text-is("雨林树屋")') }).locator('button');
    await rainBtn.scrollIntoViewIfNeeded();
    await rainBtn.click();
    await page.waitForTimeout(500);
    const rainModules = ['蘑菇攀爬树', '星桥拱门躲屋', '星月魔法躲屋', '星旋攀爬立柱']; // 59+59+89+39 = 246
    const expected2 = expected1 + 246;
    const chips2 = await chips(page);
    const sub2 = await subtotal(page);
    const rainTxt = (await rainBtn.textContent()).trim();
    const forestTxtAfter = (await forestBtn.textContent()).trim();
    const sceneOk2 = await poll(page, async () => {
      const i = await sceneInfo(page);
      return (i && modOf(i).length === 8) ? i : null;
    }, 40000);
    det.push(`雨林树屋 click: chips=${JSON.stringify(chips2)}, subtotal=¥${sub2} (expect ¥${expected2}), 雨林 button="${rainTxt}", 森林 still "${forestTxtAfter}", scene modules=${sceneOk2 ? modOf(sceneOk2).length : 'timeout'}`);
    if (![...forestModules, ...rainModules].every(m => chips2.includes(m)) || sub2 !== expected2 || rainTxt !== '已加入' || forestTxtAfter !== '已加入' || !sceneOk2) ok = false;
    await page.locator('.scene-section').screenshot({ path: path.join(SHOTS, 's2-4-both-added-buttons.png') });
    await shootPreview(page, 's2-5-both-added-canvas.png');
    record(2, ok, det);
    await ctx.close();
  } catch (e) { record(2, false, ['EXCEPTION: ' + e.stack]); }

  // ---------------- Story 3: 订单条推导 (≥4帧) ----------------
  try {
    const { ctx, page } = await newPage(browser, BASE + '/?mock=1');
    const det = [];
    let ok = true;
    const neverSteps = ['3D 打印', '发货'];
    const frames = [];
    const snap = async (label, file) => {
      const st = await flowStates(page);
      frames.push({ label, st });
      await shootFlow(page, file);
      const active = st.filter(s => s.active).map(s => s.name);
      det.push(`[${label}] active=${JSON.stringify(active)}`);
      if (st.some(s => neverSteps.includes(s.name) && s.active)) { ok = false; det.push('FAIL: 3D打印/发货 lit'); }
      return active;
    };

    // clear default wearable + default modules -> initial no step reached
    await page.locator('.wearable-grid .wearable-card', { has: page.locator('strong:text-is("迷你针织帽")') }).click();
    await openMarket(page);
    await toggleModule(page, '奶酪软垫小床');
    await toggleModule(page, '悬挂藤篮阶梯');
    const a0 = await snap('initial (cleared)', 's3-f1-initial.png');
    if (a0.length !== 0) { ok = false; det.push('FAIL: expected no active step initially'); }

    // hold the avatar POST so slice completion cannot race past the intermediate frames
    let release; const gate = new Promise(r => { release = r; });
    await page.route(u => new URL(u).pathname.endsWith('/avatar'), async route => { await gate; await route.continue(); });

    await page.setInputFiles('.upload-pet-card input[type=file]', PET_PHOTO);
    await page.waitForTimeout(600);
    const a1 = await snap('after upload photo', 's3-f2-upload.png');
    if (!(a1.length === 1 && a1[0] === '选择宠物')) { ok = false; det.push('FAIL: expected 选择宠物 active'); }

    await page.locator('.generate-avatar-button').click();
    await page.waitForTimeout(400);
    const a2 = await snap('after 生成 3D (mock, request held)', 's3-f3-generate.png');
    if (!(a2.length === 1 && a2[0] === '创建形象')) { ok = false; det.push('FAIL: expected 创建形象 active'); }

    await page.locator('.wearable-grid .wearable-card', { has: page.locator('strong:text-is("迷你针织帽")') }).click();
    await page.waitForTimeout(300);
    const a3 = await snap('after +1 wearable', 's3-f4-wearable.png');
    if (!(a3.length === 1 && a3[0] === '添加装扮')) { ok = false; det.push('FAIL: expected 添加装扮 active'); }

    await toggleModule(page, '奶酪软垫小床');
    const a4 = await snap('after +1 module', 's3-f5-module.png');
    if (!(a4.length === 1 && a4[0] === '添加模块')) { ok = false; det.push('FAIL: expected 添加模块 active'); }

    release(); // let mock avatar pipeline run -> auto slice -> done
    const sliceLit = await poll(page, async () => {
      const st = await flowStates(page);
      return st.find(s => s.name === '确认模型' && s.active) ? st : null;
    }, 60000, 800);
    const a5 = await snap('after mock slice done', 's3-f6-slice-done.png');
    if (!sliceLit || !(a5.length === 1 && a5[0] === '确认模型')) { ok = false; det.push('FAIL: expected 确认模型 active after slice'); }
    det.push(`frames captured: ${frames.length} (>=4 required)`);
    record(3, ok, det);
    await ctx.close();
  } catch (e) { record(3, false, ['EXCEPTION: ' + e.stack]); }

  // ---------------- Story 4: F46 报价明细 ----------------
  try {
    const { ctx, page } = await newPage(browser, BASE + '/');
    const det = [];
    let ok = true;
    // defaults = exactly 2 modules: 奶酪软垫小床 ¥89 + 悬挂藤篮阶梯 ¥59 = ¥148
    const sub0 = await subtotal(page);
    const quoteBtn = page.locator('.preview-side > button:text("生成场景报价")');
    await quoteBtn.scrollIntoViewIfNeeded();
    await quoteBtn.click();
    await page.waitForTimeout(300);
    const q1 = await page.evaluate(() => {
      const box = document.querySelector('[data-testid="quote-detail"]');
      if (!box) return null;
      const lines = [...box.querySelectorAll('.preview-line')].map(l => ({
        name: l.querySelector('span').textContent.trim(), val: l.querySelector('strong').textContent.trim() }));
      const total = box.querySelector('.preview-total strong').textContent.trim();
      return { lines, total };
    });
    await shootPreview(page, 's4-1-quote-2-modules.png');
    if (!q1) { ok = false; det.push('FAIL: quote card not shown'); }
    else {
      const modLines = q1.lines.filter(l => l.name !== '材料单价');
      const matLine = q1.lines.find(l => l.name === '材料单价');
      det.push(`quote#1: lines=${JSON.stringify(q1.lines)}, total=${q1.total} (subtotal ¥${sub0})`);
      if (modLines.length !== 2 || !matLine || matLine.val !== 'PETG ¥0.42 / g' || q1.total !== `¥${sub0}` || sub0 !== 148) ok = false;
      const names = modLines.map(l => l.name);
      if (!(names.includes('奶酪软垫小床') && names.includes('悬挂藤篮阶梯'))) ok = false;
      const sumLines = modLines.reduce((s, l) => s + (parseInt(l.val.replace(/[^\d]/g, ''), 10) || 0), 0);
      if (sumLines !== 148) { ok = false; det.push('FAIL: per-line prices do not sum to total'); }
    }
    // add 1 module then re-click -> updated detail & total
    await openMarket(page);
    await toggleModule(page, '藤蔓觅食托盘'); // ¥39 -> 187
    const stale = await page.evaluate(() => {
      const box = document.querySelector('[data-testid="quote-detail"]');
      return box ? box.querySelector('.preview-total strong').textContent.trim() : null;
    });
    det.push(`before re-click quote total stays ${stale} (click-to-refresh semantics)`);
    await quoteBtn.scrollIntoViewIfNeeded();
    await quoteBtn.click();
    await page.waitForTimeout(300);
    const sub1 = await subtotal(page);
    const q2 = await page.evaluate(() => {
      const box = document.querySelector('[data-testid="quote-detail"]');
      if (!box) return null;
      const lines = [...box.querySelectorAll('.preview-line')].map(l => ({
        name: l.querySelector('span').textContent.trim(), val: l.querySelector('strong').textContent.trim() }));
      const total = box.querySelector('.preview-total strong').textContent.trim();
      return { lines, total };
    });
    await shootPreview(page, 's4-2-quote-3-modules.png');
    if (!q2) { ok = false; det.push('FAIL: quote card missing after re-click'); }
    else {
      const modLines = q2.lines.filter(l => l.name !== '材料单价');
      det.push(`quote#2: lines=${JSON.stringify(q2.lines)}, total=${q2.total} (subtotal ¥${sub1}, expect ¥187)`);
      if (modLines.length !== 3 || q2.total !== `¥${sub1}` || sub1 !== 187 || !modLines.some(l => l.name === '藤蔓觅食托盘')) ok = false;
    }
    record(4, ok, det);
    await ctx.close();
  } catch (e) { record(4, false, ['EXCEPTION: ' + e.stack]); }

  // ---------------- Story 5: 宠物位 + console ----------------
  try {
    const { ctx, page, errors } = await newPage(browser, BASE + '/?mock=1');
    const det = [];
    let ok = true;
    // phase A: no avatar -> center empty, no uncaught errors
    await page.locator('.preview-board').scrollIntoViewIfNeeded();
    const infoA = await poll(page, async () => {
      const i = await sceneInfo(page);
      return (i && modOf(i).length === 2) ? i : null; // 2 default GLB modules load
    }, 40000);
    const petsA = petOf(infoA);
    det.push(`no-avatar: pet objects at center = ${petsA.length} (expect 0), modules loaded = ${infoA ? modOf(infoA).length : 'timeout'}`);
    if (!infoA || petsA.length !== 0) ok = false;
    await shootPreview(page, 's5-1-no-avatar-center-empty.png');
    det.push(`no-avatar phase uncaught pageerrors = ${errors.pageerrors.length}`);
    if (errors.pageerrors.length) { ok = false; det.push('pageerrors: ' + JSON.stringify(errors.pageerrors)); }

    // phase B: mock-generate avatar -> pet model appears at center
    await page.setInputFiles('.upload-pet-card input[type=file]', PET_PHOTO);
    await page.waitForTimeout(400);
    await page.locator('.generate-avatar-button').click();
    const infoB = await poll(page, async () => {
      const i = await sceneInfo(page);
      return (i && petOf(i).length >= 1) ? i : null;
    }, 90000, 1000);
    const petsB = petOf(infoB);
    det.push(`after mock avatar: pet objects = ${petsB.length} at pos ${petsB[0] ? JSON.stringify(petsB[0].pos) : 'n/a'} (expect 1 at [0,0,0])`);
    if (petsB.length !== 1 || petsB[0].pos.some(v => Math.abs(v) > 0.001)) ok = false;
    await page.waitForTimeout(1500);
    await shootPreview(page, 's5-2-avatar-in-center.png');
    det.push(`total uncaught pageerrors = ${errors.pageerrors.length}; console error lines = ${errors.consoleErrors.length}`);
    if (errors.pageerrors.length) { ok = false; det.push('pageerrors: ' + JSON.stringify(errors.pageerrors)); }
    if (errors.consoleErrors.length) det.push('console errors (informational): ' + JSON.stringify(errors.consoleErrors.slice(0, 5)));
    record(5, ok, det);
    await ctx.close();
  } catch (e) { record(5, false, ['EXCEPTION: ' + e.stack]); }

  await browser.close();
  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 2));
  const passed = results.filter(r => r.pass).length;
  console.log(`\nSUMMARY: PASS ${passed}/5`);
  for (const r of results) console.log(`  Story ${r.story}: ${r.pass ? 'PASS' : 'FAIL'}`);
})();
