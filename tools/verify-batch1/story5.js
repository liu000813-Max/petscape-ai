// Story 5: pre-generation visual unchanged vs batch0 acceptance screenshot.
// Reference: tools/verify-batch0/shots/s1-port-03-creator.png (batch0 acceptance capture of .pet-creator-section)
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');
const { chromium, preparePage, shot, SHOTS, BASE } = require('./lib');

const REF = '<USER_HOME>/Desktop/PetScape-final/tools/verify-batch0/shots/s1-port-03-creator.png';

(async () => {
  const browser = await chromium.launch();
  const page = await preparePage(browser, `${BASE}/?mock=1`, { killCssAnimations: true });
  // Same warm-up scroll as batch0 story1.js
  await page.evaluate(async () => {
    for (let y = 0; y <= document.body.scrollHeight; y += 800) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(800);
  const loc = page.locator('.pet-creator-section').first();
  await loc.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const cur = await shot(loc, 's5-creator-now');

  const a = PNG.sync.read(fs.readFileSync(REF));
  const b = PNG.sync.read(fs.readFileSync(cur));
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const crop = (img) => {
    const out = new PNG({ width: w, height: h });
    PNG.bitblt(img, out, 0, 0, w, h, 0, 0);
    return out;
  };
  const diff = new PNG({ width: w, height: h });
  const n = pixelmatch(crop(a).data, crop(b).data, diff.data, w, h, { threshold: 0.1, includeAA: false });
  fs.writeFileSync(path.join(SHOTS, 's5-diff.png'), PNG.sync.write(diff));
  console.log(
    JSON.stringify({
      refSize: `${a.width}x${a.height}`,
      curSize: `${b.width}x${b.height}`,
      diffPixels: n,
      diffRate: `${((n / (w * h)) * 100).toFixed(2)}%`,
    })
  );
  await browser.close();
})();
