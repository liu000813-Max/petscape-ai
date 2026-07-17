// Story 4: failure state + retry.
// Injection: temporarily rename web/public/mockup-assets/mock-model.glb in the worktree
// -> mock modeling step (copyFile) throws -> avatar.status=failed via job catch.
// Then restore the file and click 重试 -> chain completes.
const fs = require('fs');
const { chromium, preparePage, shot, BASE } = require('./lib');

const ASSETS = '<REPOSITORY_ROOT>/.claude/worktrees/agent-aaed965fde3697a2b/web/public/mockup-assets';
const GLB = `${ASSETS}/mock-model.glb`;
const GLB_BAK = `${ASSETS}/mock-model.glb.injected-away`;
const PET_IMG = `${ASSETS}/pet-hamster-ref.jpg`;

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await preparePage(browser, `${BASE}/?mock=1`);
    await page.locator('.pet-creator-section').scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await page.locator('.upload-pet-card input[type=file]').setInputFiles(PET_IMG);
    await page.waitForTimeout(800);

    // ---- inject failure ----
    fs.renameSync(GLB, GLB_BAK);
    console.log('S4 injection: mock-model.glb renamed away');

    const genBtn = page.locator('.generate-avatar-button');
    const t0 = Date.now();
    await genBtn.click();

    // wait for failure UI
    let failAt = null;
    while (Date.now() - t0 < 20000) {
      if ((await page.locator('.avatar-failure').count()) > 0) {
        failAt = Date.now() - t0;
        break;
      }
      await page.waitForTimeout(200);
    }
    console.log('S4 failure UI appeared at =', failAt ? `${(failAt / 1000).toFixed(1)}s` : 'NEVER');
    if (failAt) {
      const failText = (await page.locator('.avatar-failure').textContent()).trim();
      console.log('S4 failure text =', JSON.stringify(failText));
      console.log('S4 retry button count =', await page.locator('.avatar-retry').count());
    }
    // not stuck / not white screen evidence
    await page.waitForTimeout(2500);
    const stillFailure = (await page.locator('.avatar-failure').count()) > 0;
    const pipelineGone = (await page.locator('.avatar-pipeline').count()) === 0;
    const btnEnabled = !(await genBtn.isDisabled());
    const bodyChildren = await page.evaluate(() => document.querySelectorAll('main section').length);
    console.log(
      'S4 after 2.5s: failure persists =', stillFailure,
      '| pipeline overlay gone =', pipelineGone,
      '| generate button enabled =', btnEnabled,
      '| page sections rendered =', bodyChildren
    );
    await shot(page.locator('.avatar-stage-card'), 's4-01-failure-state');
    await shot(page, 's4-02-fullpage-not-white');

    // ---- restore and retry ----
    fs.renameSync(GLB_BAK, GLB);
    console.log('S4 injection restored: mock-model.glb back');
    const t1 = Date.now();
    await page.locator('.avatar-retry').click();
    await page.waitForTimeout(300);
    console.log('S4 after retry click: pipeline visible =', (await page.locator('.avatar-pipeline').count()) > 0,
      '| failure gone =', (await page.locator('.avatar-failure').count()) === 0);
    await shot(page.locator('.avatar-stage-card'), 's4-03-retry-running');
    let canvasAt = null;
    while (Date.now() - t1 < 20000) {
      if ((await page.locator('.avatar-stage canvas').count()) > 0) {
        canvasAt = Date.now() - t1;
        break;
      }
      await page.waitForTimeout(200);
    }
    console.log('S4 retry canvas at =', canvasAt ? `${(canvasAt / 1000).toFixed(1)}s` : 'NEVER');
    await page.waitForTimeout(1200);
    await shot(page.locator('.avatar-stage-card'), 's4-04-retry-done');
  } finally {
    if (fs.existsSync(GLB_BAK)) {
      fs.renameSync(GLB_BAK, GLB);
      console.log('S4 cleanup: glb restored in finally');
    }
    await browser.close();
  }
})();
