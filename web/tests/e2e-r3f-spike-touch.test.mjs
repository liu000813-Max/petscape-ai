import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.R3F_SPIKE_BASE_URL ?? 'http://127.0.0.1:3014';

test('390×844 Chromium touch drag emits pointerType=touch and restores Orbit', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/r3f-spike`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('load-status').waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="load-status"]')?.textContent === 'ready',
  );

  const canvasShell = page.getByTestId('r3f-canvas-shell');
  await canvasShell.scrollIntoViewIfNeeded();
  const box = await canvasShell.boundingBox();
  assert.ok(box, 'Canvas 必须可见');

  const start = { x: box.x + box.width * 0.47, y: box.y + box.height * 0.58 };
  const end = { x: start.x + 65, y: start.y + 35 };
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...start, radiusX: 5, radiusY: 5, force: 1, id: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ ...end, radiusX: 5, radiusY: 5, force: 1, id: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await page.waitForFunction(
    () => document.querySelector('[data-testid="pointer-kind"]')?.textContent === 'touch',
  );
  const pointerKind = await page.getByTestId('pointer-kind').innerText();
  const position = await page.getByTestId('model-position').innerText();
  const orbit = await page.getByTestId('orbit-status').innerText();
  assert.equal(pointerKind, 'touch');
  assert.notEqual(position, '0, 0, 0');
  assert.match(orbit, /^可用 · 已暂停 [1-9]\d* 次$/);

  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/r3f-spike-touch.png', fullPage: true });
  console.log(JSON.stringify({ pointerKind, position, orbit, viewport: '390x844' }));
});
