import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { createTwoPagePdf } from './reader-test-fixtures.mjs';

const script = await readFile(new URL('../elearning-pdf-preview.user.js', import.meta.url), 'utf8');
const engineName = process.env.BROWSER_ENGINE || 'chromium';
const engine = engineName === 'firefox' ? firefox : chromium;
const browser = await engine.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined });
const origin = 'https://elearning.fudan.edu.cn', pdf = createTwoPagePdf();
const errors = [], unexpected = [];
let requests = 0;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url === `${origin}/courses/1`) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="zh-CN"><body style="background:#e2e8f0;font:16px system-ui;padding:30px"><h1>课程文件 · 窗口操作示例</h1><a id="file" href="/files/42">阅读示例.pdf</a></body></html>' });
    if (url === `${origin}/files/42/download?download_frd=1`) { requests++; return route.fulfill({ body: pdf, contentType: 'application/pdf' }); }
    if (url.startsWith('chrome://resources/') || url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/')) return route.continue();
    unexpected.push(url); return route.abort();
  });
  await context.addInitScript(() => {
    window.GM_getValue = (key, fallback) => fallback;
    window.GM_setValue = () => {};
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  page.setDefaultTimeout(15000);
  await page.goto(`${origin}/courses/1`); await page.addScriptTag({ content: script });
  await page.locator('#file').click();
  await page.locator('[data-action=open-tab]').waitFor();
  const dialog = page.locator('.fdpdf-dialog'), title = page.locator('.fdpdf-title');
  const rect = () => dialog.boundingBox();
  const close = () => page.locator('.fdpdf-close').click();
  const maximize = () => page.locator('[data-action=maximize]').click();
  const reset = () => page.locator('[data-action=reset-window]').click();
  const drag = async (locator, dx, dy) => {
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 }); await page.mouse.up();
  };
  const near = (actual, expected) => { for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(actual[key] - expected[key]) < 2, `${key}: ${actual[key]} ≠ ${expected[key]}`); };
  const visible = async () => {
    await page.waitForFunction(() => {
      const box = document.querySelector('.fdpdf-dialog').getBoundingClientRect();
      return box.x >= 0 && box.y >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1;
    });
    const box = await rect(), view = page.viewportSize();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= view.width + 1 && box.y + box.height <= view.height + 1);
    assert.ok(await page.locator('.fdpdf-close').isVisible());
  };
  // Native PDF must keep the same iframe and source through every window operation.
  const initial = await rect();
  await page.locator('.fdpdf-viewer').evaluate(frame => {
    window.originalFrame = frame; window.originalSrc = frame.src; window.srcChanges = 0;
    new MutationObserver(changes => { window.srcChanges += changes.length; }).observe(frame, { attributes: true, attributeFilter: ['src'] });
  });
  await title.click(); assert.ok(await dialog.isVisible(), 'a title click must not close the backdrop');
  await drag(title, 50, 25); near(await rect(), { ...initial, x: initial.x + 50, y: initial.y + 25 });
  await drag(page.locator('.fdpdf-resize-se'), -260, -180);
  const smaller = await rect(); near(smaller, { x: initial.x + 50, y: initial.y + 25, width: initial.width - 260, height: initial.height - 180 });
  for (const [edge, dx, dy] of [['e', 35, 0], ['w', -25, 0], ['n', 0, -20], ['s', 0, 20], ['nw', 15, 15], ['ne', -15, 15], ['sw', 15, -15]]) {
    const before = await rect(); await drag(page.locator(`.fdpdf-resize-${edge}`), dx, dy);
    assert.notDeepEqual(await rect(), before, `${edge} handle resizes`); await visible();
  }
  const beforeMax = await rect();
  await maximize(); near(await rect(), { x: 0, y: 0, width: 1440, height: 1000 });
  await maximize(); near(await rect(), beforeMax);
  await title.dblclick(); assert.equal(await dialog.evaluate(d => d.classList.contains('fdpdf-maximized')), true);
  await title.dblclick(); near(await rect(), beforeMax);
  await reset(); near(await rect(), initial);
  assert.ok(await page.evaluate(() => originalFrame === document.querySelector('.fdpdf-viewer') && originalFrame.src === originalSrc && srcChanges === 0));
  assert.equal(requests, 1);
  // Dragging across the reader or beyond the viewport must finish without closing the dialog.
  await drag(page.locator('.fdpdf-resize-se'), -400, -300);
  await drag(title, -2000, -2000); await visible(); assert.ok(await dialog.isVisible());
  await page.mouse.move(30, 30); // Recover a release that Firefox did not deliver outside its viewport.
  assert.equal(await page.locator('.fdpdf-window-shield').isVisible(), false);
  await title.focus(); const beforeKeys = await rect();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown');
  near(await rect(), { ...beforeKeys, x: beforeKeys.x + 20, height: beforeKeys.height + 20 });
  const titleBox = await title.boundingBox();
  await page.mouse.move(titleBox.x + 30, titleBox.y + 10); await page.mouse.down();
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.mouse.up();
  assert.equal(await page.locator('.fdpdf-window-shield').isVisible(), false);
  await close();
  await page.locator('#file').click(); await page.locator('[data-action=open-tab]').waitFor();
  near(await rect(), { ...beforeKeys, x: beforeKeys.x + 20, height: beforeKeys.height + 20 });
  // Viewport shrink and restore while maximized must keep controls reachable.
  await maximize(); await page.setViewportSize({ width: 390, height: 600 }); await visible();
  near(await rect(), { x: 0, y: 0, width: 390, height: 600 });
  await maximize(); await visible();
  await page.setViewportSize({ width: 1440, height: 1000 }); await reset();
  // PDF.js page and relative reading position survive fit-to-width re-rendering.
  await page.getByRole('combobox', { name: '阅读器', exact: true }).selectOption('pdfjs');
  const painted = () => page.waitForFunction(() => {
    const sheet = document.querySelector('.fdpdf-pdf-page'), scroll = document.querySelector('.fdpdf-pdf-scroll');
    return sheet?.dataset.ready === 'true' && Math.abs(sheet.offsetWidth - (scroll.clientWidth - 24)) < 2;
  });
  await painted(); await page.locator('[data-action=pdf-next]').click();
  await page.waitForFunction(() => document.querySelector('.fdpdf-pdf-page')?.dataset.page === '2' && document.querySelector('.fdpdf-pdf-page')?.dataset.ready === 'true');
  await page.locator('.fdpdf-pdf-scroll').evaluate(s => { s.scrollTop = 200; window.oldReader = document.querySelector('.fdpdf-reader'); });
  const ratio = () => page.locator('.fdpdf-pdf-scroll').evaluate(s => s.scrollTop / s.firstElementChild.offsetHeight);
  const oldRatio = await ratio(), beforeResizeRequests = requests;
  await drag(page.locator('.fdpdf-resize-se'), -220, -150); await painted();
  assert.equal(await page.getByLabel('页码', { exact: true }).inputValue(), '2');
  assert.ok(await page.evaluate(() => oldReader === document.querySelector('.fdpdf-reader')));
  assert.ok(Math.abs(await ratio() - oldRatio) < 0.01, 'keep relative reading position on resize');
  assert.equal(requests, beforeResizeRequests);
  if (process.env.WINDOW_SCREENSHOT_DIR) {
    await mkdir(process.env.WINDOW_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${process.env.WINDOW_SCREENSHOT_DIR}/${engineName}-window.png` });
    await maximize(); await painted();
    await page.screenshot({ path: `${process.env.WINDOW_SCREENSHOT_DIR}/${engineName}-maximized.png` });
    await maximize();
  }
  // A blocked popup gives feedback without disturbing the current reader.
  await page.evaluate(() => { window.realOpen = window.open; window.open = () => null; });
  await page.locator('[data-action=open-tab]').click(); assert.match(await page.locator('.fdpdf-tab-feedback').textContent(), /拦截/);
  await page.evaluate(() => { window.open = window.realOpen; });
  const popupPromise = context.waitForEvent('page'); await page.locator('[data-action=open-tab]').click();
  const popup = await popupPromise; await popup.waitForFunction(() => document.querySelector('iframe')?.src.startsWith('blob:'));
  assert.equal(await popup.title(), '阅读示例.pdf'); assert.equal(await popup.evaluate(() => window.opener), null);
  const tabBytes = () => popup.evaluate(async () => Array.from(new Uint8Array(await (await fetch(document.querySelector('iframe').src)).arrayBuffer())));
  assert.deepEqual(await tabBytes(), [...pdf]); assert.equal(requests, beforeResizeRequests);
  if (process.env.WINDOW_NATIVE_VIEWER) {
    // Full Chromium includes the native PDF extension; headless-shell does not.
    // Allow native PDF painting to settle before the optional visual capture.
    await popup.waitForTimeout(2000);
    assert.ok(popup.frames().some(frame => frame.url().startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/')));
    const embeds = await Promise.all(popup.frames().map(frame => frame.evaluate(() => document.querySelectorAll('embed').length).catch(() => 0)));
    assert.ok(embeds.some(count => count > 0), 'the native PDF plugin is present');
  }
  await close(); await page.goto('about:blank');
  assert.deepEqual(await tabBytes(), [...pdf], 'independent tab owns bytes after original page leaves');
  if (process.env.WINDOW_SCREENSHOT_DIR) await popup.screenshot({ path: `${process.env.WINDOW_SCREENSHOT_DIR}/${engineName}-tab.png` });
  await popup.close();
  assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
  console.log(`PASS ${engineName} ${browser.version()}: drag, eight resize handles, maximize/restore, reset, keyboard, viewport bounds, blur cleanup, native iframe retained, PDF.js reading position, independent PDF tab and blocked popup feedback (offline fixtures; injected userscript).`);
} finally { await browser.close(); }
