// Batch2 4B verifier — independent acceptance run against spec assertions only.
// Playwright borrowed from main-repo tools/verify-batch0/node_modules (same repo tooling).
const { chromium } = require('<USER_HOME>/Desktop/PetScape-final/tools/verify-batch0/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3012';
const WT = '<USER_HOME>/Desktop/PetScape-final/.claude/worktrees/agent-a82575011fef2753b/web';
const SHOTS = '<USER_HOME>/Desktop/PetScape-final/.claude/worktrees/agent-a82575011fef2753b/tools/verify-batch2/shots';
const CAGE_IMG = path.join(WT, 'public/assets/scene-urban-base.jpg');
const PET_IMG = path.join(WT, 'public/mockup-assets/pet-hamster-ref.jpg');
const PET_IMG2 = path.join(WT, 'public/assets/species-rat.png');
const DEFAULT_VIBE = '森林奶酪屋，童话厨房氛围，适合花枝鼠钻洞、觅食和攀爬。';

const results = []; // {story, assertion, pass, detail}
function record(story, assertion, pass, detail = '') {
  results.push({ story, assertion, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} [S${story}] ${assertion}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  const projectResp = page.waitForResponse(r => r.url().includes('/api/project') && r.request().method() === 'POST', { timeout: 15000 });
  await page.goto(`${BASE}/?mock=1`, { waitUntil: 'networkidle' });
  const project = await (await projectResp).json().catch(() => null);
  console.log('projectId =', project && project.id);
  await page.waitForTimeout(500);

  const vibeSection = page.locator('section.builder-section');
  const textarea = vibeSection.locator('textarea.vibe-textarea');
  const genBtn = vibeSection.locator('.prompt-box button');
  const cageCard = page.locator('.upload-vibe-card[data-ratio="4:3"]');
  const petCard = page.locator('.upload-vibe-card[data-ratio="1:1"]');

  // ---------- Story 4: textarea default text + editable ----------
  await vibeSection.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await vibeSection.screenshot({ path: `${SHOTS}/story4-01-default.png` });
  const defVal = await textarea.inputValue();
  record(4, 'textarea 默认文案与原版示例一致', defVal === DEFAULT_VIBE, JSON.stringify(defVal));
  await textarea.click();
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('vibe-textarea'));
  record(4, '光标可进入 textarea', focused);
  await page.keyboard.press('End');
  await textarea.pressSequentially('测试增字', { delay: 20 });
  const afterAdd = await textarea.inputValue();
  record(4, '可增文字', afterAdd === DEFAULT_VIBE + '测试增字', JSON.stringify(afterAdd.slice(-8)));
  await vibeSection.screenshot({ path: `${SHOTS}/story4-02-after-typing.png` });
  for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');
  const afterDel = await textarea.inputValue();
  record(4, '可删文字（退回默认）', afterDel === DEFAULT_VIBE, JSON.stringify(afterDel.slice(-8)));
  await vibeSection.screenshot({ path: `${SHOTS}/story4-03-restored.png` });

  // ---------- Story 2 (part 1): button disabled before cage upload ----------
  const disabledBefore = await genBtn.isDisabled();
  record(2, '未传笼箱照时"生成"按钮 disabled', disabledBefore);
  await vibeSection.screenshot({ path: `${SHOTS}/story2-01-no-cage-disabled.png` });

  // ---------- Story 3: pet photo auto-carried from creator ----------
  const creatorCard = page.locator('label.upload-pet-card');
  await creatorCard.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await creatorCard.screenshot({ path: `${SHOTS}/story3-01-creator-before.png` });
  await creatorCard.locator('input[type="file"]').setInputFiles(PET_IMG);
  await creatorCard.locator('img').waitFor({ timeout: 5000 });
  const creatorSrc = await creatorCard.locator('img').getAttribute('src');
  await creatorCard.screenshot({ path: `${SHOTS}/story3-02-creator-uploaded.png` });
  await vibeSection.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const petImgVisible = await petCard.locator('img').count();
  const petSrc = petImgVisible ? await petCard.locator('img').getAttribute('src') : null;
  record(3, '宠物位(1:1)自动显示创建器同一张图缩略', petImgVisible > 0 && petSrc === creatorSrc, `creator=${creatorSrc} vibe=${petSrc}`);
  await page.locator('.upload-grid').screenshot({ path: `${SHOTS}/story3-03-vibe-autofill.png` });
  // replace via pet slot
  await petCard.locator('input[type="file"]').setInputFiles(PET_IMG2);
  await page.waitForTimeout(500);
  const petSrc2 = await petCard.locator('img').getAttribute('src');
  record(3, '点击宠物位可另选替换（src 变化）', !!petSrc2 && petSrc2 !== petSrc, `new=${petSrc2}`);
  const creatorSrcAfter = await creatorCard.locator('img').getAttribute('src');
  record(3, '替换后创建器照片不受影响', creatorSrcAfter === creatorSrc, `creator=${creatorSrcAfter}`);
  await page.locator('.upload-grid').screenshot({ path: `${SHOTS}/story3-04-vibe-replaced.png` });
  await creatorCard.screenshot({ path: `${SHOTS}/story3-05-creator-unchanged.png` });

  // ---------- Story 1: mock full flow ----------
  const renderSection = page.locator('section.render-section');
  await renderSection.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await renderSection.screenshot({ path: `${SHOTS}/story1-01-render-placeholders.png` });
  await vibeSection.scrollIntoViewIfNeeded();
  await cageCard.locator('input[type="file"]').setInputFiles(CAGE_IMG);
  await cageCard.locator('img').waitFor({ timeout: 8000 });
  const cageSrc = await cageCard.locator('img').getAttribute('src');
  record(1, '笼箱位(4:3)出现上传图预览', !!cageSrc, `src=${cageSrc}`);
  await page.locator('.upload-grid').screenshot({ path: `${SHOTS}/story1-02-cage-preview.png` });

  // Story 2 (part 2): button re-enabled after cage upload
  const enabledAfter = await genBtn.isEnabled();
  record(2, '传图后"生成"按钮恢复可点', enabledAfter);
  await vibeSection.screenshot({ path: `${SHOTS}/story2-02-cage-enabled.png` });

  // clear textarea + type new vibe
  await textarea.fill('');
  await textarea.pressSequentially('温馨森林风', { delay: 20 });
  const vibeNow = await textarea.inputValue();
  record(1, 'textarea 清空后输入"温馨森林风"', vibeNow === '温馨森林风', JSON.stringify(vibeNow));

  const t0 = Date.now();
  await genBtn.click();
  await page.waitForTimeout(200);
  const runningDisabled = await genBtn.isDisabled();
  const hintVisible = await vibeSection.locator('.vibe-generating-hint').isVisible().catch(() => false);
  const hintText = hintVisible ? await vibeSection.locator('.vibe-generating-hint').innerText() : '';
  record(1, '点击后按钮 disabled', runningDisabled);
  record(1, '区块出现生成中提示', hintVisible, JSON.stringify(hintText));
  await vibeSection.screenshot({ path: `${SHOTS}/story1-03-generating.png` });

  // wait for all three render cells (photo cards) — spec: <=5s
  let threeDone = false, elapsed = null;
  try {
    await page.waitForFunction(() => document.querySelectorAll('.render-section .render-photo-card img').length >= 3, { timeout: 10000 });
    elapsed = Date.now() - t0;
    threeDone = true;
  } catch (e) { elapsed = Date.now() - t0; }
  record(1, '≤5s 后三格全部出图', threeDone && elapsed <= 5000, `elapsed=${elapsed}ms, threeDone=${threeDone}`);
  await renderSection.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await renderSection.screenshot({ path: `${SHOTS}/story1-04-render-result.png` });

  if (threeDone) {
    const cards = renderSection.locator('.render-photo-card');
    const src1 = await cards.nth(0).locator('img').first().getAttribute('src');
    const src2 = await cards.nth(1).locator('img').first().getAttribute('src');
    // assertion: first cell src points to same file as uploaded cage original
    record(1, '第一格 src 与上传笼箱原图同一文件', src1 === cageSrc, `first=${src1} cage=${cageSrc}`);
    // supplementary: byte-compare first cell image with the original local file
    const resp1 = await page.request.get(BASE + src1);
    const buf1 = Buffer.from(await resp1.body());
    const orig = fs.readFileSync(CAGE_IMG);
    console.log(`INFO byte-compare first cell vs original: ${buf1.equals(orig) ? 'identical' : 'DIFFERENT'} (${buf1.length} vs ${orig.length} bytes)`);
    // second cell: new generated image
    const resp2 = await page.request.get(BASE + src2);
    record(1, '第二格为新生成图（src≠原图且可加载）', !!src2 && src2 !== src1 && resp2.status() === 200, `second=${src2} http=${resp2.status()}`);
    // third cell: 3:4 center crop of second + brand badge
    const shareCard = renderSection.locator('.share-card');
    const src3 = await shareCard.locator('.share-crop img').getAttribute('src');
    record(1, '第三格图像 = 第二格同源图', src3 === src2, `third=${src3}`);
    const cropBox = await shareCard.locator('.share-crop').boundingBox();
    const ratio = cropBox ? cropBox.width / cropBox.height : 0;
    const fit = await shareCard.locator('.share-crop img').evaluate(el => {
      const cs = getComputedStyle(el);
      return { objectFit: cs.objectFit, objectPosition: cs.objectPosition };
    });
    record(1, '第三格为 3:4 中心裁切（容器比例 + object-fit:cover 居中）',
      Math.abs(ratio - 0.75) < 0.03 && fit.objectFit === 'cover' && fit.objectPosition === '50% 50%',
      `ratio=${ratio.toFixed(3)} fit=${JSON.stringify(fit)}`);
    const badge = shareCard.locator('.share-badge');
    const badgeVisible = await badge.isVisible().catch(() => false);
    const badgeHasLogo = badgeVisible && (await badge.locator('img').count()) > 0;
    const badgeText = badgeVisible ? (await badge.innerText()).trim() : '';
    const cardBox = await shareCard.boundingBox();
    const badgeBox = badgeVisible ? await badge.boundingBox() : null;
    let cornerOk = false, cornerDesc = 'n/a';
    if (badgeBox && cardBox) {
      const inBottom = (badgeBox.y + badgeBox.height) > (cardBox.y + cardBox.height * 0.6);
      const nearLeft = (badgeBox.x - cardBox.x) < cardBox.width * 0.4;
      const nearRight = (cardBox.x + cardBox.width - badgeBox.x - badgeBox.width) < cardBox.width * 0.4;
      cornerOk = inBottom && (nearLeft || nearRight);
      cornerDesc = `bottom=${inBottom} left=${nearLeft} right=${nearRight}`;
    }
    record(1, '第三格左下/右下可见品牌角标（logo+一行文案）', badgeVisible && badgeHasLogo && badgeText.length > 0 && cornerOk,
      `text=${JSON.stringify(badgeText)} ${cornerDesc}`);
    await shareCard.screenshot({ path: `${SHOTS}/story1-05-share-card.png` });
  }
  await page.screenshot({ path: `${SHOTS}/final-fullpage.png`, fullPage: true });
  await browser.close();

  const fails = results.filter(r => !r.pass);
  console.log('\n=== SUMMARY ===');
  for (const s of [1, 2, 3, 4]) {
    const sr = results.filter(r => r.story === s);
    const ok = sr.length > 0 && sr.every(r => r.pass);
    console.log(`Story ${s}: ${ok ? 'PASS' : 'FAIL'} (${sr.filter(r => r.pass).length}/${sr.length} assertions)`);
  }
  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 2));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
