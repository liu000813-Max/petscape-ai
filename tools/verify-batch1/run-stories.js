// Stories 1-3: mock full flow / size reslice / wearable regen hint.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');
const { chromium, preparePage, shot, SHOTS, BASE } = require('./lib');

const PET_IMG =
  '<USER_HOME>/Desktop/PetScape-final/.claude/worktrees/agent-aaed965fde3697a2b/web/public/mockup-assets/pet-hamster-ref.jpg';

const log = (...a) => console.log(...a);

function diffPngs(aPath, bPath) {
  const a = PNG.sync.read(fs.readFileSync(aPath));
  const b = PNG.sync.read(fs.readFileSync(bPath));
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const crop = (img) => {
    const out = new PNG({ width: w, height: h });
    PNG.bitblt(img, out, 0, 0, w, h, 0, 0);
    return out;
  };
  const diff = new PNG({ width: w, height: h });
  const n = pixelmatch(crop(a).data, crop(b).data, diff.data, w, h, { threshold: 0.1, includeAA: false });
  return { diffPixels: n, rate: n / (w * h) };
}

(async () => {
  const browser = await chromium.launch();
  const page = await preparePage(browser, `${BASE}/?mock=1`);

  // Capture projectId from any /api/project/{id}/... request.
  let projectId = null;
  page.on('request', (req) => {
    const m = req.url().match(/\/api\/project\/([0-9a-f-]{36})/);
    if (m && !projectId) projectId = m[1];
  });

  const creator = page.locator('.pet-creator-section');
  await creator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);

  // ---- Story 3 precondition: select a wearable BEFORE generating ----
  await page.locator('.wearable-card').first().click();
  await page.waitForTimeout(300);
  log('S3 pre: wearable #1 selected =', await page.locator('.wearable-card').first().getAttribute('class'));

  // ---- Story 1: upload ----
  await page.locator('.upload-pet-card input[type=file]').setInputFiles(PET_IMG);
  await page.waitForTimeout(800);
  const uploadPreview = await page.locator('.upload-pet-card img').count();
  log('S1 upload preview img count =', uploadPreview);
  await shot(page.locator('.avatar-stage-card'), 's1-01-before-generate');

  // ---- Story 1: click generate, button disabled immediately ----
  const genBtn = page.locator('.generate-avatar-button');
  const t0 = Date.now();
  await genBtn.click();
  const disabledNow = await genBtn.isDisabled();
  const btnText = (await genBtn.textContent()).trim();
  log('S1 immediately after click: disabled =', disabledNow, 'text =', btnText);

  // ---- Story 1: sample pipeline stage states until canvas appears (max 15s) ----
  const samples = [];
  let lastSig = '';
  let canvasAt = null;
  let shotIdx = 0;
  while (Date.now() - t0 < 15000) {
    const s = await page.evaluate(() => {
      const steps = [...document.querySelectorAll('.pipeline-step')].map((el) => {
        const state = el.className.replace('pipeline-step', '').trim() || 'pending';
        return `${el.querySelector('em')?.textContent}:${state}${el.querySelector('.pipeline-dot')?.textContent === '✓' ? '(✓)' : ''}`;
      });
      const canvas = !!document.querySelector('.avatar-stage canvas');
      return { steps: steps.join(' | '), canvas };
    });
    const sig = `${s.steps} canvas=${s.canvas}`;
    if (sig !== lastSig) {
      const t = ((Date.now() - t0) / 1000).toFixed(1);
      samples.push(`[${t}s] ${sig}`);
      lastSig = sig;
      shotIdx += 1;
      await shot(page.locator('.avatar-stage-card'), `s1-02-stage-${shotIdx}-t${t.replace('.', '_')}s`);
    }
    if (s.canvas && !canvasAt) {
      canvasAt = Date.now() - t0;
      break;
    }
    await page.waitForTimeout(120);
  }
  log('S1 stage samples:\n  ' + samples.join('\n  '));
  log('S1 canvas appeared at =', canvasAt ? `${(canvasAt / 1000).toFixed(1)}s` : 'NEVER (15s timeout)');
  log('S1 projectId =', projectId);

  // ---- Story 1: drag-rotate evidence (autorotate baseline vs drag delta) ----
  await page.waitForTimeout(1500); // let GLB finish loading/render
  const stage = page.locator('.avatar-stage');
  const r0 = await shot(stage, 's1-03-rotate-a');
  await page.waitForTimeout(1000);
  const r1 = await shot(stage, 's1-04-rotate-b-autorotate1s');
  const box = await page.locator('.avatar-stage canvas').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 160, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(cx - 160 + i * 32, cy, { steps: 2 });
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  const r2 = await shot(stage, 's1-05-rotate-c-after-drag');
  const dAuto = diffPngs(r0, r1);
  const dDrag = diffPngs(r1, r2);
  log(
    'S1 rotate: autorotate-1s diff =',
    (dAuto.rate * 100).toFixed(2) + '%',
    '| drag-320px diff =',
    (dDrag.rate * 100).toFixed(2) + '%'
  );

  // ---- Story 1: quote panel ----
  const manu = page.locator('.manufacturing-section');
  await manu.scrollIntoViewIfNeeded();
  const quoteTotal = page.locator('.manufacturing-section .quote-total');
  let quoteReadyText = '';
  const tq = Date.now();
  while (Date.now() - tq < 20000) {
    const txt = (await quoteTotal.textContent().catch(() => '')) || '';
    if (txt.includes('重量')) {
      quoteReadyText = txt;
      break;
    }
    await page.waitForTimeout(300);
  }
  const title1 = (await page.locator('.manufacturing-section .quote-head strong').textContent()).trim();
  log('S1 quote title =', JSON.stringify(title1));
  log('S1 quote total =', JSON.stringify(quoteReadyText.trim()));
  await shot(manu, 's1-06-quote-ready');

  const stlHref = await page.locator('.quote-download-btn', { hasText: '下载 STL' }).getAttribute('href');
  const gcodeHref = await page.locator('.quote-download-btn', { hasText: '下载 G-code' }).getAttribute('href');
  const stlRes = await page.request.get(`${BASE}${stlHref}`);
  const gcodeRes = await page.request.get(`${BASE}${gcodeHref}`);
  log('S1 STL href =', stlHref, 'HTTP', stlRes.status(), 'len', (await stlRes.body()).length);
  log('S1 GCODE href =', gcodeHref, 'HTTP', gcodeRes.status(), 'len', (await gcodeRes.body()).length);

  // ---- Story 1: rename follows ----
  await creator.scrollIntoViewIfNeeded();
  await page.locator('#pet-name').fill('米糕');
  await page.waitForTimeout(500);
  await manu.scrollIntoViewIfNeeded();
  const title2 = (await page.locator('.manufacturing-section .quote-head strong').textContent()).trim();
  log('S1 quote title after rename =', JSON.stringify(title2));
  await shot(manu, 's1-07-quote-renamed');

  const weight120 = parseFloat((quoteReadyText.match(/重量\s*([\d.]+)\s*g/) || [])[1]);

  // ---- Story 2: size 3 -> 5 ----
  await creator.scrollIntoViewIfNeeded();
  await page.locator('#pet-size').evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '5');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  log('S2 slider value =', await page.locator('#pet-size').inputValue());
  await manu.scrollIntoViewIfNeeded();
  const t2 = Date.now();
  let sawComputing = null;
  let weight160 = null;
  let quote160Text = '';
  while (Date.now() - t2 < 20000) {
    const txt = ((await quoteTotal.textContent().catch(() => '')) || '').trim();
    if (txt.includes('计算中') && sawComputing == null) {
      sawComputing = Date.now() - t2;
      await shot(manu, 's2-01-computing');
    }
    if (projectId) {
      const pr = await page.request.get(`${BASE}/api/project/${projectId}`);
      const pj = await pr.json();
      if (pj.avatarSlice?.status === 'done' && pj.avatarSlice?.scaleMm === 160) {
        await page.waitForTimeout(2500); // let UI poll pick it up
        quote160Text = ((await quoteTotal.textContent()) || '').trim();
        weight160 = pj.avatarSlice.weightG;
        break;
      }
    }
    await page.waitForTimeout(100);
  }
  log('S2 computing-state seen at =', sawComputing != null ? `${(sawComputing / 1000).toFixed(1)}s` : 'NOT SEEN');
  log('S2 quote after 160mm =', JSON.stringify(quote160Text));
  log('S2 weightG: 120mm(ui) =', weight120, '| 160mm(api) =', weight160);
  await shot(manu, 's2-02-after-160');
  if (projectId) {
    const pr = await page.request.get(`${BASE}/api/project/${projectId}`);
    const pj = await pr.json();
    log('S2 avatarSlice(api) =', JSON.stringify(pj.avatarSlice));
  }

  // ---- Story 3: toggle wearable after done -> hint; regenerate works ----
  await creator.scrollIntoViewIfNeeded();
  await page.locator('.wearable-card').nth(1).click();
  await page.waitForTimeout(400);
  const hintCount = await page.locator('.wearable-dirty-hint').count();
  const hintText = hintCount ? (await page.locator('.wearable-dirty-hint').textContent()).trim() : '';
  log('S3 hint after toggle-when-done: count =', hintCount, 'text =', JSON.stringify(hintText));
  await shot(page.locator('.wearable-shop'), 's3-01-hint-after-done-toggle');

  const t3 = Date.now();
  await genBtn.click();
  const disabled3 = await genBtn.isDisabled();
  const btnText3 = (await genBtn.textContent()).trim();
  await page.waitForTimeout(400);
  const pipelineBack = await page.locator('.avatar-pipeline').count();
  log('S3 regen click: disabled =', disabled3, 'text =', btnText3, 'pipeline visible =', pipelineBack > 0);
  await shot(page.locator('.avatar-stage-card'), 's3-02-regen-running');

  // toggle during generation -> hint again
  await page.locator('.wearable-card').nth(1).click();
  await page.waitForTimeout(300);
  const hintDuring = await page.locator('.wearable-dirty-hint').count();
  log('S3 hint after toggle-during-regen: count =', hintDuring);
  await shot(page.locator('.wearable-shop'), 's3-03-hint-during-regen');

  let canvas3At = null;
  while (Date.now() - t3 < 20000) {
    const c = await page.locator('.avatar-stage canvas').count();
    if (c > 0) {
      canvas3At = Date.now() - t3;
      break;
    }
    await page.waitForTimeout(200);
  }
  log('S3 regen canvas back at =', canvas3At ? `${(canvas3At / 1000).toFixed(1)}s` : 'NEVER');
  await page.waitForTimeout(1200);
  await shot(page.locator('.avatar-stage-card'), 's3-04-regen-done');

  await browser.close();
})();
