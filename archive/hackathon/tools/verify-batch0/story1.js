// Story 1: visual zero-regression. Capture 7 segments on original (5173) and
// ported (3000), then pixel-diff each pair (pixelmatch, AA ignored).
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');
const { chromium, preparePage, shot, SHOTS, ORIG, PORT } = require('./lib');

const SEGMENTS = [
  ['01-hero', '.hero-shell'],
  ['02-carousel', '.species-section'],
  ['03-creator', '.pet-creator-section'],
  ['04-modules', '.module-section'],
  ['05-preview', '.preview-section'],
  ['06-quote', '.manufacturing-section'],
  ['07-orderflow', '.order-section'],
];

async function capture(browser, url, tag) {
  const page = await preparePage(browser, url, { killCssAnimations: true });
  // scroll through whole page once to force any lazy work, then back to top
  await page.evaluate(async () => {
    for (let y = 0; y <= document.body.scrollHeight; y += 800) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(800);
  const out = {};
  for (const [name, sel] of SEGMENTS) {
    const loc = page.locator(sel).first();
    await loc.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    out[name] = await shot(loc, `s1-${tag}-${name}`);
  }
  await page.context().close();
  return out;
}

function diffPair(aPath, bPath, name) {
  const a = PNG.sync.read(fs.readFileSync(aPath));
  const b = PNG.sync.read(fs.readFileSync(bPath));
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const crop = (img) => {
    const out = new PNG({ width: w, height: h });
    PNG.bitblt(img, out, 0, 0, w, h, 0, 0);
    return out;
  };
  const ca = crop(a);
  const cb = crop(b);
  const diff = new PNG({ width: w, height: h });
  const n = pixelmatch(ca.data, cb.data, diff.data, w, h, {
    threshold: 0.1,
    includeAA: false,
  });
  fs.writeFileSync(path.join(SHOTS, `s1-diff-${name}.png`), PNG.sync.write(diff));
  return {
    name,
    origSize: `${a.width}x${a.height}`,
    portSize: `${b.width}x${b.height}`,
    diffPixels: n,
    diffRatio: +(n / (w * h) * 100).toFixed(3),
  };
}

(async () => {
  const browser = await chromium.launch();
  const orig = await capture(browser, ORIG, 'orig');
  const port = await capture(browser, PORT, 'port');
  await browser.close();
  const results = SEGMENTS.map(([name]) => diffPair(orig[name], port[name], name));
  console.log(JSON.stringify(results, null, 2));
})().catch((e) => {
  console.error('STORY1 ERROR:', e);
  process.exit(1);
});
