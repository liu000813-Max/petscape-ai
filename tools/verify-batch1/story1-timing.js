// Story 1 timing re-measurement: click -> canvas, tight 100ms sampling, no screenshots in loop.
const { chromium, preparePage, BASE } = require('./lib');

const PET_IMG =
  '<USER_HOME>/Desktop/PetScape-final/.claude/worktrees/agent-aaed965fde3697a2b/web/public/mockup-assets/pet-hamster-ref.jpg';

(async () => {
  const browser = await chromium.launch();
  const page = await preparePage(browser, `${BASE}/?mock=1`);
  await page.locator('.pet-creator-section').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await page.locator('.upload-pet-card input[type=file]').setInputFiles(PET_IMG);
  await page.waitForTimeout(800);

  const t0 = Date.now();
  await page.locator('.generate-avatar-button').click();
  let lastSig = '';
  const samples = [];
  let canvasAt = null;
  while (Date.now() - t0 < 20000) {
    const s = await page.evaluate(() => {
      const steps = [...document.querySelectorAll('.pipeline-step')]
        .map((el) => `${el.querySelector('em')?.textContent}:${el.className.replace('pipeline-step', '').trim() || 'pending'}`)
        .join('|');
      return { steps, canvas: !!document.querySelector('.avatar-stage canvas') };
    });
    const sig = `${s.steps} canvas=${s.canvas}`;
    if (sig !== lastSig) {
      samples.push(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${sig}`);
      lastSig = sig;
    }
    if (s.canvas) {
      canvasAt = Date.now() - t0;
      break;
    }
    await page.waitForTimeout(100);
  }
  console.log(samples.join('\n'));
  console.log('canvas at:', canvasAt ? `${(canvasAt / 1000).toFixed(1)}s` : 'NEVER');
  await browser.close();
})();
