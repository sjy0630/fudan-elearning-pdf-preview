import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { createTwoPagePdf } from './reader-test-fixtures.mjs';

const script = await readFile(new URL('../elearning-pdf-preview.user.js', import.meta.url), 'utf8');
const pdf = createTwoPagePdf();
const engine = process.env.BROWSER_ENGINE === 'firefox' ? firefox : chromium;
const browser = await engine.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined });
const origin = 'https://elearning.fudan.edu.cn';
const storageKey = 'fudan-preview.pdf-reader';
const errors = [], unexpected = [];
let requests = 0;
try {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
  let body = pdf, contentType = 'application/pdf', csp = '';
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url === `${origin}/courses/1`) return route.fulfill({ contentType: 'text/html', headers: csp ? { 'Content-Security-Policy': csp } : {}, body: '<!doctype html><a id="file" href="/files/42">sample.pdf</a>' });
    if (url === `${origin}/files/42/download?download_frd=1`) { requests++; return route.fulfill({ body, contentType }); }
    // Chromium's native PDF viewer loads packaged browser resources, not network assets.
    if (url.startsWith('chrome://resources/') || url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/')) return route.continue();
    unexpected.push(url); return route.abort();
  });
  // This emulates only manager storage. A real userscript manager is a separate release check.
  await context.addInitScript(({ key }) => {
    window.GM_getValue = (name, fallback) => JSON.parse(localStorage.getItem(name) || JSON.stringify(fallback));
    window.GM_setValue = (name, value) => localStorage.setItem(name, JSON.stringify(value));
    window.workerCount = 0; window.terminated = 0; window.testWorkers = [];
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); workerCount++; testWorkers.push(this); }
      terminate() { terminated++; return super.terminate(); }
    };
    window.fixtureStorageKey = key;
  }, { key: storageKey });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(15000);
  const load = async () => { await page.goto(`${origin}/courses/1`); await page.addScriptTag({ content: script }); };
  const open = async (name = 'sample.pdf') => { await page.locator('#file').evaluate((link, name) => { link.textContent = name; }, name); await page.locator('#file').click(); };
  const close = () => page.locator('.fdpdf-close').click();
  const selector = page.getByRole('combobox', { name: '阅读器', exact: true });
  const painted = async (number = 1) => {
    await page.waitForFunction(number => {
      const sheet = document.querySelector('.fdpdf-pdf-page');
      return sheet?.dataset.page === String(number) && sheet.dataset.ready === 'true';
    }, number);
  };
  const downloadBytes = async () => {
    const pending = page.waitForEvent('download'); await page.locator('.fdpdf-download').click();
    const chunks = []; for await (const chunk of await (await pending).createReadStream()) chunks.push(chunk);
    return Buffer.concat(chunks);
  };
  await load(); await open(); await selector.waitFor();
  assert.equal(await selector.inputValue(), 'native');
  assert.equal(await page.locator('iframe.fdpdf-viewer').isVisible(), true);
  assert.equal(await page.evaluate(() => workerCount), 0);
  const firstRequestCount = requests;
  const originalUrl = await page.locator('.fdpdf-download').getAttribute('href');
  await selector.selectOption('pdfjs'); await painted();
  assert.equal(await page.locator('iframe.fdpdf-viewer').isVisible(), false);
  assert.equal(await page.getByLabel('页码', { exact: true }).inputValue(), '1');
  assert.match(await page.locator('.fdpdf-page-count').textContent(), /2/);
  assert.match(await page.locator('.fdpdf-text-layer').textContent(), /Offline PDF fixture - page 1/);
  await page.locator('.fdpdf-overlay').evaluate(node => { node.style.letterSpacing = '3px'; node.style.wordSpacing = '5px'; });
  assert.ok(await page.locator('.fdpdf-text-layer span').first().evaluate(node => [getComputedStyle(node).letterSpacing, getComputedStyle(node).wordSpacing].every(value => value === 'normal' || value === '0px')), 'host typography must not move PDF text selection away from the canvas');
  assert.ok(await page.locator('.fdpdf-pdf-page canvas').evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels.some((value, index) => index % 4 !== 3 && value < 200) && canvas.width * canvas.height <= 16000000;
  }));
  // Real mouse selection must land on PDF text at its rendered position.
  const text = page.locator('.fdpdf-text-layer span').filter({ hasText: 'Synthetic document' }).first();
  const box = await text.boundingBox(); assert.ok(box && box.width > 100 && box.height > 5);
  await page.mouse.move(box.x + 1, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 15 }); await page.mouse.up();
  assert.match(await page.evaluate(() => getSelection().toString()), /Synthetic document/);
  await page.getByRole('button', { name: '下一页', exact: true }).click(); await painted(2);
  assert.match(await page.locator('.fdpdf-text-layer').textContent(), /Offline PDF fixture - page 2/);
  const width = await page.locator('.fdpdf-pdf-page').evaluate(node => node.clientWidth);
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await page.waitForFunction(width => document.querySelector('.fdpdf-pdf-page')?.clientWidth > width, width); await painted(2);
  await page.getByRole('button', { name: '适合宽度', exact: true }).click(); await painted(2);
  await page.waitForFunction(() => document.querySelector('.fdpdf-pdf-page').clientWidth <= document.querySelector('.fdpdf-pdf-scroll').clientWidth);
  await page.getByLabel('页码', { exact: true }).fill('999'); await page.getByLabel('页码', { exact: true }).press('Enter'); await painted(2);
  assert.equal(await page.getByLabel('页码', { exact: true }).inputValue(), '2');
  assert.deepEqual(await downloadBytes(), pdf);
  assert.equal(await page.locator('.fdpdf-download').getAttribute('href'), originalUrl);
  await selector.selectOption('native'); assert.equal(await page.locator('iframe.fdpdf-viewer').isVisible(), true);
  await selector.selectOption('pdfjs'); await painted(); assert.equal(requests, firstRequestCount);
  await close(); assert.equal(await page.evaluate(() => document.activeElement.id), 'file');
  await load(); await open(); await painted(); assert.equal(await selector.inputValue(), 'pdfjs');
  // Page/zoom/switch/close may overlap worker and text tasks without stale painting.
  await page.evaluate(() => {
    document.querySelector('[data-action=pdf-next]').click();
    document.querySelector('[data-action=pdf-zoom-in]').click();
    document.querySelector('[data-action=pdf-prev]').click();
    document.querySelector('.fdpdf-close').click();
  });
  await open(); await painted();
  assert.match(await page.locator('.fdpdf-text-layer').textContent(), /page 1/);
  await close();
  body = 'hello'; contentType = 'text/plain'; await open('sample.txt');
  await page.locator('.fdpdf-text').waitFor(); assert.equal(await selector.isVisible(), false); await close();
  body = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=', 'base64'); contentType = 'image/png';
  await open('sample.png'); await page.waitForFunction(() => document.querySelector('.fdpdf-image-tools')?.hidden === false || document.querySelector('.fdpdf-status')?.textContent.includes('无法'));
  assert.equal(await selector.isVisible(), false); await close();
  body = pdf; contentType = 'application/pdf';
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify('invalid')), storageKey);
  await load(); await open(); assert.equal(await selector.inputValue(), 'native'); await close();
  await load();
  await page.evaluate(() => { GM_getValue = () => new Promise(resolve => { window.resolvePreference = resolve; }); });
  await open(); await selector.selectOption('pdfjs'); await painted(); await close();
  await open(); await painted(); await page.getByRole('button', { name: '下一页', exact: true }).click(); await painted(2);
  const workersBeforeLateRead = await page.evaluate(() => workerCount);
  await page.evaluate(async () => { resolvePreference('native'); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  assert.equal(await page.evaluate(() => workerCount), workersBeforeLateRead, 'late preference read must not remount an unchanged reopened reader');
  assert.equal(await page.getByLabel('页码', { exact: true }).inputValue(), '2'); await close();
  await load(); await open(); await painted();
  await page.evaluate(() => { GM_setValue = () => new Promise((resolve, reject) => { window.rejectPreferenceSave = reject; }); });
  await selector.selectOption('native'); await page.waitForFunction(() => typeof rejectPreferenceSave === 'function'); await close();
  await open(); await page.evaluate(() => rejectPreferenceSave(Error('storage unavailable')));
  await page.waitForFunction(() => document.querySelector('.fdpdf-preference-warning').textContent.includes('记住'));
  assert.equal(await selector.inputValue(), 'native'); await close();
  await load(); await page.evaluate(() => { GM_getValue = () => { throw Error('storage unavailable'); }; GM_setValue = () => Promise.reject(Error('storage unavailable')); });
  await open(); await selector.selectOption('pdfjs'); await painted();
  await page.waitForFunction(() => document.querySelector('.fdpdf-preference-warning')?.textContent.includes('记住'));
  assert.equal(await selector.inputValue(), 'pdfjs');
  await page.evaluate(() => { GM_setValue = (name, value) => localStorage.setItem(name, JSON.stringify(value)); });
  await selector.selectOption('native');
  await page.waitForFunction(() => document.querySelector('.fdpdf-preference-warning').textContent === ''); await close();
  await open(); await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  assert.equal(await page.locator('.fdpdf-preference-warning').textContent(), '', 'cached failed initial read must not overwrite a later successful choice save');
  await selector.selectOption('pdfjs'); await painted(); await close();
  body = await readFile(new URL('../tests/fixtures/reader/chinese-cmap-fonts.pdf', import.meta.url));
  await open(); await painted();
  assert.match(await page.locator('.fdpdf-text-layer').textContent(), /[\u4e00-\u9fff]/u);
  await page.getByRole('button', { name: '下一页', exact: true }).click(); await painted(2);
  assert.match(await page.locator('.fdpdf-text-layer').textContent(), /[\u4e00-\u9fff]/u); await close();
  // Password and damaged files retain the original bytes and explicit native fallback.
  body = await readFile(new URL('../tests/fixtures/reader/encrypted-known-password.pdf', import.meta.url));
  await open(); await selector.selectOption('pdfjs');
  const password = page.getByLabel('PDF 密码', { exact: true }); await password.waitFor();
  await password.fill('wrong'); await page.getByRole('button', { name: '解锁', exact: true }).click();
  await page.getByText('密码不正确，请重试。', { exact: true }).waitFor();
  assert.equal(await password.inputValue(), '');
  await password.fill('reader-test-2026'); await page.getByRole('button', { name: '解锁', exact: true }).click(); await painted();
  assert.equal(await password.count(), 0); await close();
  await open(); await selector.selectOption('pdfjs'); await password.waitFor();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '切换到浏览器自带', exact: true }).waitFor();
  assert.equal(await selector.inputValue(), 'pdfjs'); assert.deepEqual(await downloadBytes(), body); await close();
  await open(); await password.waitFor(); await password.fill('discard-on-close'); await close();
  body = pdf; await open(); await painted();
  assert.equal(await password.count(), 0, 'closing a password prompt must not leave stale input in the next document');
  // Trigger an actual uncaught error inside the real PDF.js worker after first paint.
  await page.evaluate(() => testWorkers.at(-1).postMessage({ targetName: 'worker', sourceName: 'main', action: 'reader-smoke-fatal-worker-error' }));
  await page.getByRole('button', { name: '切换到浏览器自带', exact: true }).waitFor();
  assert.match(await page.locator('.fdpdf-status').textContent(), /Worker/);
  assert.equal(await selector.inputValue(), 'pdfjs'); assert.deepEqual(await downloadBytes(), pdf); await close();
  body = await readFile(new URL('../tests/fixtures/reader/damaged-valid-header.pdf', import.meta.url));
  await open(); await selector.selectOption('pdfjs');
  await page.getByRole('button', { name: '切换到浏览器自带', exact: true }).waitFor();
  assert.deepEqual(await downloadBytes(), body); await close();
  body = pdf; csp = "worker-src 'none'";
  await load(); await open(); await selector.selectOption('pdfjs');
  await page.getByRole('button', { name: '切换到浏览器自带', exact: true }).click();
  assert.equal(await selector.inputValue(), 'native'); assert.deepEqual(await downloadBytes(), pdf);
  await close();
  await page.waitForFunction(() => workerCount === terminated);
  assert.equal(errors.length, 1, 'only the deliberately injected worker failure may reach the browser error event');
  assert.match(errors[0], /Unknown action from worker: reader-smoke-fatal-worker-error/);
  assert.deepEqual(unexpected, []);
  console.log(`PASS ${process.env.BROWSER_ENGINE || 'chromium'} ${browser.version()}: PDF reader choice, real text selection, paging/zoom/fit, original-byte downloads, stored preference races, non-PDF isolation, rapid lifecycle, password cancel/close, post-ready worker failure and CSP fallback (injected GM storage, not a manager installation)`);
} finally { await browser.close(); }
