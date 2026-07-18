// Shared helpers for batch0 verification (read-only against running dev servers).
const { chromium } = require('playwright');
const path = require('path');

const SHOTS = path.join(__dirname, 'shots');
const ORIG = 'http://localhost:5173'; // V3 original (Vite)
const PORT = 'http://localhost:3000'; // ported (Next.js)

// The species carousel auto-rotates via setInterval(fn, 4200). Neutralize it
// identically on BOTH pages so screenshots/interactions are deterministic.
function freezeCarousel() {
  const orig = window.setInterval;
  window.setInterval = function (fn, delay, ...args) {
    if (delay === 4200) return 424242; // swallow only the carousel rotation timer
    return orig.call(window, fn, delay, ...args);
  };
}

async function preparePage(browser, url, { killCssAnimations = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.addInitScript(freezeCarousel);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  if (killCssAnimations) {
    await page.addStyleTag({
      content: '*,*::before,*::after{animation:none !important;caret-color:transparent !important}',
    });
  }
  // Pause hero video at frame 0 on both sides (same mp4 asset -> same frame).
  await page.evaluate(async () => {
    const vids = [...document.querySelectorAll('video')];
    await Promise.all(
      vids.map(
        (v) =>
          new Promise((res) => {
            v.pause();
            v.addEventListener('seeked', () => res(), { once: true });
            setTimeout(res, 1500);
            try {
              v.currentTime = 0;
            } catch {
              res();
            }
          })
      )
    );
  });
  await page.waitForTimeout(2600); // let motion mount animations settle
  return page;
}

async function waitScrollEnd(page, timeoutMs = 5000) {
  const start = Date.now();
  let last = await page.evaluate(() => window.scrollY);
  while (Date.now() - start < timeoutMs) {
    await page.waitForTimeout(250);
    const now = await page.evaluate(() => window.scrollY);
    if (now === last) return now;
    last = now;
  }
  return last;
}

async function shot(target, name) {
  const p = path.join(SHOTS, `${name}.png`);
  await target.screenshot({ path: p });
  return p;
}

module.exports = { chromium, preparePage, waitScrollEnd, shot, SHOTS, ORIG, PORT };
