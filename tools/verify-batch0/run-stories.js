// Stories 2-10: interaction assertions against the ported app (localhost:3000).
// Each story runs on a fresh page; before/after screenshots saved to shots/.
const { chromium, preparePage, waitScrollEnd, shot, PORT } = require('./lib');

const UPLOAD_IMG = '<USER_HOME>/Desktop/PetScape-final/web/public/assets/species-rat.png';
const results = [];

function record(id, title, pass, evidence) {
  results.push({ id, title, verdict: pass ? 'PASS' : 'FAIL', evidence });
  console.log(`[Story ${id}] ${pass ? 'PASS' : 'FAIL'} — ${title}`);
  console.log(JSON.stringify(evidence, null, 2));
}

async function story2(browser) {
  const page = await preparePage(browser, PORT);
  const section = page.locator('.species-section');
  await section.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await shot(section, 's2-before-carousel');
  const cards = page.locator('.carousel-species-card');
  // 3rd card; overlapping stacked cards can intercept a normal click -> DOM click
  await cards.nth(2).evaluate((el) => el.click());
  await page.waitForTimeout(1400); // 0.82s pose animation
  await shot(section, 's2-after-carousel');
  const pressed = await cards.nth(2).getAttribute('aria-pressed');
  // rotateY makes computed transform a matrix3d; judge scale via rendered widths instead
  const opacities = await page.$$eval('.carousel-species-card', (els) =>
    els.map((el) => parseFloat(getComputedStyle(el).opacity))
  );
  const widths = [];
  for (let i = 0; i < 5; i++) widths.push(Math.round((await cards.nth(i).boundingBox()).width));
  const s = widths.map((w, i) => ({ width: w, opacity: opacities[i] }));
  const activeBig = opacities[2] > 0.9 && [0, 1, 3, 4].every((i) => widths[2] > widths[i]);
  const othersSmall = [0, 1, 3, 4].every((i) => widths[i] < widths[2] * 0.9 && opacities[i] < 0.8);
  const creatorRow = page.locator('.species-select-row');
  await creatorRow.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const activeText = (await page.locator('.species-select-row button.active').innerText()).trim();
  await shot(page.locator('.pet-creator-section .creator-controls'), 's2-after-creator-row');
  record(2, '轮播↔创建器联动', pressed === 'true' && activeBig && othersSmall && activeText === '蛇', {
    thirdCardAriaPressed: pressed,
    cardPoses: s,
    creatorActiveSpecies: activeText,
    shots: ['s2-before-carousel.png', 's2-after-carousel.png', 's2-after-creator-row.png'],
  });
  await page.context().close();
}

async function story3(browser) {
  const page = await preparePage(browser, PORT);
  const shop = page.locator('.wearable-shop');
  await shop.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const totalText = () => page.locator('.shop-head strong').innerText();
  const t0 = await totalText(); // default: knit-hat preselected -> ¥39
  await shot(shop, 's3-before');
  // clear default selection so "two items" sum is unambiguous
  await page.locator('.wearable-card', { hasText: '迷你针织帽' }).click();
  await page.waitForTimeout(300);
  const tCleared = await totalText();
  await page.locator('.wearable-card', { hasText: '小厨师围巾' }).click(); // ¥29
  await page.locator('.wearable-card', { hasText: '名字小吊牌' }).click(); // ¥19
  await page.waitForTimeout(300);
  const t2 = await totalText();
  await shot(shop, 's3-two-selected');
  await page.locator('.wearable-card', { hasText: '名字小吊牌' }).click(); // uncheck one
  await page.waitForTimeout(300);
  const t3 = await totalText();
  await shot(shop, 's3-one-cancelled');
  record(3, '装扮求和', tCleared.includes('¥0') && t2.includes('¥48') && t3.includes('¥29'), {
    initial: t0, cleared: tCleared, twoSelected_expect48: t2, afterCancel_expect29: t3,
    shots: ['s3-before.png', 's3-two-selected.png', 's3-one-cancelled.png'],
  });
  await page.context().close();
}

async function story4(browser) {
  const page = await preparePage(browser, PORT);
  const section = page.locator('.module-section');
  await section.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  // expand market so the two preselected defaults are reachable, then clear them
  await page.locator('.view-more-button').click();
  await page.waitForTimeout(800);
  while ((await page.locator('.module-card button', { hasText: '已加入预览' }).count()) > 0) {
    await page.locator('.module-card button', { hasText: '已加入预览' }).first().click();
    await page.waitForTimeout(250);
  }
  const preview = page.locator('.preview-section');
  await preview.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const emptyTotal = await page.locator('.preview-total strong').innerText();
  await shot(preview, 's4-before-preview-empty');
  const card = page.locator('.module-card', { hasText: '香蕉软垫小床' }); // ¥89
  await card.scrollIntoViewIfNeeded();
  await shot(card, 's4-before-card');
  await card.locator('button').click();
  await page.waitForTimeout(400);
  const btnText = (await card.locator('button').innerText()).trim();
  const cardSelected = await card.evaluate((el) => el.classList.contains('selected'));
  await shot(card, 's4-after-card');
  await preview.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const chips = await page.locator('.preview-chips span').allInnerTexts();
  const lines = await page.locator('.preview-line span').allInnerTexts();
  const total = await page.locator('.preview-total strong').innerText();
  await shot(preview, 's4-after-preview');
  record(
    4,
    '模块加入联动',
    btnText === '已加入预览' && cardSelected && chips.includes('香蕉软垫小床') && lines.includes('香蕉软垫小床') && total.trim() === '¥89' && emptyTotal.trim() === '¥0',
    {
      clearedTotal: emptyTotal, buttonAfter: btnText, cardSelectedClass: cardSelected,
      previewChips: chips, previewList: lines, moduleSubtotal_expect89: total,
      shots: ['s4-before-preview-empty.png', 's4-before-card.png', 's4-after-card.png', 's4-after-preview.png'],
    }
  );
  await page.context().close();
}

async function story5(browser) {
  const page = await preparePage(browser, PORT);
  const stage = page.locator('.avatar-stage-card');
  await stage.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const setSize = (v) =>
    page.locator('#pet-size').evaluate((el, val) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, String(val));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, v);
  const badge = () => page.locator('.avatar-species-tag strong').innerText();
  // idle CSS animation pollutes boundingBox; read the driven scale instead
  const bodyScale = () =>
    page.locator('.avatar-model-shell').evaluate((el) => {
      const m = /matrix\(([-\d.]+)/.exec(getComputedStyle(el).transform);
      return m ? parseFloat(m[1]) : 1;
    });
  const b3 = await bodyScale();
  const tag3 = await badge();
  await shot(stage, 's5-size3-default');
  await setSize(5);
  await page.waitForTimeout(600);
  const b5 = await bodyScale();
  const tag5 = await badge();
  await shot(stage, 's5-size5');
  await setSize(1);
  await page.waitForTimeout(600);
  const b1 = await bodyScale();
  const tag1 = await badge();
  await shot(stage, 's5-size1');
  record(
    5,
    '体型滑块',
    tag5.replace(/\s/g, '').includes('Lv.5档案') && tag1.replace(/\s/g, '').includes('Lv.1档案') && b5 > b3 && b1 < b3,
    {
      default: { tag: tag3, avatarScale: b3 },
      size5: { tag: tag5, avatarScale: b5 },
      size1: { tag: tag1, avatarScale: b1 },
      shots: ['s5-size3-default.png', 's5-size5.png', 's5-size1.png'],
    }
  );
  await page.context().close();
}

async function story6(browser) {
  const page = await preparePage(browser, PORT);
  const creator = page.locator('.pet-creator-section .creator-layout');
  await creator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await shot(creator, 's6-before-upload');
  await page.locator('.upload-pet-card input[type=file]').setInputFiles(UPLOAD_IMG);
  await page.waitForTimeout(700);
  const uploadPreview = await page.locator('.upload-pet-card img').isVisible();
  const overlay = page.locator('.avatar-source-photo');
  const overlayVisible = await overlay.isVisible();
  const overlayLabel = overlayVisible ? (await overlay.locator('span').innerText()).trim() : '';
  const overlayImg = overlayVisible ? await overlay.locator('img').isVisible() : false;
  await shot(creator, 's6-after-upload');
  record(6, '照片上传预览', uploadPreview && overlayVisible && overlayImg && overlayLabel === '参考照片', {
    uploadCardPreviewImg: uploadPreview, stageOverlayVisible: overlayVisible,
    overlayThumbImg: overlayImg, overlayLabel,
    shots: ['s6-before-upload.png', 's6-after-upload.png'],
  });
  await page.context().close();
}

async function story7(browser) {
  const GECKO = ['多巴胺攀爬站', '星月魔法躲屋', '星桥拱门躲屋', '蘑菇攀爬树', '星旋攀爬立柱'];
  const PARROT = ['悬挂藤篮阶梯', '藤蔓觅食托盘', '多巴胺攀爬站', 'Z 字吊桥梯'];
  const page = await preparePage(browser, PORT);
  const section = page.locator('.module-section');
  const topSlots = async () => {
    const slots = page.locator('.module-card-slot');
    const n = Math.min(await slots.count(), 3);
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push({
        title: (await slots.nth(i).locator('h3').innerText()).trim(),
        badge: (await slots.nth(i).locator('.module-recommend-badge').count()) > 0
          ? (await slots.nth(i).locator('.module-recommend-badge').innerText()).trim()
          : null,
      });
    }
    return out;
  };
  await section.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const ratTop = await topSlots(); // default species = 花枝鼠
  await shot(section, 's7-before-rat');
  await page.locator('.species-select-row button', { hasText: '守宫' }).click();
  await page.waitForTimeout(400);
  await section.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const geckoTop = await topSlots();
  await shot(section, 's7-after-gecko');
  await page.locator('.species-select-row button', { hasText: '鹦鹉' }).click();
  await page.waitForTimeout(400);
  await section.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const parrotTop = await topSlots();
  await shot(section, 's7-after-parrot');
  const geckoOk = geckoTop.every((s) => GECKO.includes(s.title) && s.badge === '推荐');
  const parrotOk = parrotTop.every((s) => PARROT.includes(s.title) && s.badge === '推荐');
  const changed = JSON.stringify(geckoTop.map((s) => s.title)) !== JSON.stringify(parrotTop.map((s) => s.title));
  record(7, 'F48 推荐置顶接线', geckoOk && parrotOk && changed, {
    defaultRatTop3: ratTop, geckoTop3: geckoTop, parrotTop3: parrotTop, recommendationSetChanged: changed,
    shots: ['s7-before-rat.png', 's7-after-gecko.png', 's7-after-parrot.png'],
  });
  await page.context().close();
}

async function story8(browser) {
  const page = await preparePage(browser, PORT);
  const stage = page.locator('.avatar-stage-card');
  await stage.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const btn = page.locator('.generate-avatar-button');
  const disabledBefore = await btn.isDisabled();
  await shot(stage, 's8-before-disabled');
  await page.locator('.upload-pet-card input[type=file]').setInputFiles(UPLOAD_IMG);
  await page.waitForTimeout(700);
  const disabledAfter = await btn.isDisabled();
  let clickWorked = false;
  if (!disabledAfter) {
    await btn.click();
    await page.waitForTimeout(500);
    clickWorked = (await btn.innerText()).includes('重新生成');
  }
  await shot(stage, 's8-after-enabled-clicked');
  record(8, 'F22 生成按钮禁用接线', disabledBefore && !disabledAfter && clickWorked, {
    disabledBeforeUpload: disabledBefore, disabledAfterUpload: disabledAfter,
    clickRegeneratedLabel: clickWorked,
    shots: ['s8-before-disabled.png', 's8-after-enabled-clicked.png'],
  });
  await page.context().close();
}

async function story9(browser) {
  const page = await preparePage(browser, PORT);
  await shot(page, 's9-before-top');
  await page.locator('.add-species-card').click();
  const yAfterCard = await waitScrollEnd(page);
  const creatorTop = await page
    .locator('.pet-creator-section')
    .evaluate((el) => el.getBoundingClientRect().top);
  await shot(page, 's9-after-card-scrolled');
  // logo is off-screen now; DOM click avoids Playwright auto-scrolling it into view
  await page.locator('.brand-button').evaluate((el) => el.click());
  const yAfterLogo = await waitScrollEnd(page);
  await shot(page, 's9-after-logo-top');
  record(9, 'F12/F02 滚动接线', Math.abs(creatorTop) < 160 && yAfterCard > 500 && yAfterLogo < 4, {
    scrollYAfterCardClick: yAfterCard,
    creatorRectTopAfterScroll: creatorTop,
    scrollYAfterLogoClick: yAfterLogo,
    shots: ['s9-before-top.png', 's9-after-card-scrolled.png', 's9-after-logo-top.png'],
  });
  await page.context().close();
}

async function story10(browser) {
  const page = await preparePage(browser, PORT);
  const section = page.locator('.module-section');
  await section.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const count = () => page.locator('.module-card').count();
  const status = () => page.locator('.market-status span').innerText();
  const c0 = await count();
  const st0 = await status();
  await shot(section, 's10-before-collapsed');
  await page.locator('.view-more-button').click();
  await page.waitForTimeout(1000);
  const c1 = await count();
  const st1 = await status();
  await shot(section, 's10-expanded');
  await page.locator('.view-more-button').click();
  await page.waitForTimeout(1000);
  const c2 = await count();
  const st2 = await status();
  await shot(section, 's10-collapsed-again');
  record(
    10,
    '展开/收起',
    c0 === 3 && c1 === 13 && c2 === 3 && st1.replace(/\s/g, '').includes('已加载13个'),
    {
      collapsed: { cards: c0, status: st0 },
      expanded: { cards: c1, status: st1 },
      collapsedAgain: { cards: c2, status: st2 },
      shots: ['s10-before-collapsed.png', 's10-expanded.png', 's10-collapsed-again.png'],
    }
  );
  await page.context().close();
}

(async () => {
  const browser = await chromium.launch();
  const stories = [story2, story3, story4, story5, story6, story7, story8, story9, story10];
  for (const fn of stories) {
    try {
      await fn(browser);
    } catch (e) {
      const id = parseInt(fn.name.replace('story', ''), 10);
      record(id, fn.name, false, { error: String(e).slice(0, 500) });
    }
  }
  await browser.close();
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(results.map(({ id, verdict }) => ({ id, verdict }))));
})();
