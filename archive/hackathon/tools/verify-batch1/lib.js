// Shared helpers for batch1 verification (independent verifier, worktree dev server on 3011).
const { chromium } = require('playwright');
const path = require('path');

const SHOTS = path.join(__dirname, 'shots');
const BASE = 'http://localhost:3011';

// Neutralize the species carousel auto-rotation (same trick as batch0 lib).
function freezeCarousel() {
  const orig = window.setInterval;
  window.setInterval = function (fn, delay, ...args) {
    if (delay === 4200) return 424242;
    return orig.call(window, fn, delay, ...args);
  };
}

async function preparePage(browser, url, { killCssAnimations = false, freeze = true } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  if (freeze) await page.addInitScript(freezeCarousel);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  if (killCssAnimations) {
    await page.addStyleTag({
      content: '*,*::before,*::after{animation:none !important;caret-color:transparent !important}',
    });
  }
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
  await page.waitForTimeout(2600);
  return page;
}

async function shot(target, name) {
  const p = path.join(SHOTS, `${name}.png`);
  await target.screenshot({ path: p });
  return p;
}

module.exports = { chromium, preparePage, shot, SHOTS, BASE };
