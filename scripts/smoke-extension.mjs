import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createDemoPdf } from './demo-pdf.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'output/playwright/ci');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), 'canvas-preview-smoke-'));
const extension = path.join(root, 'dist/chromium');
const channel = process.env.BROWSER_CHANNEL || 'chromium';
const executablePath = process.env.BROWSER_EXECUTABLE || undefined;
const report = { platform: process.platform, channel, started: new Date().toISOString(), checks: [], passed: false };
const downloads = [], pageErrors = [], unexpectedRequests = [];
let context;
let phase = 'launch';
async function check(name, action) {
  phase = name;
  await action();
  report.checks.push(name);
  console.log(`PASS ${name}`);
}
async function rendered(page, text = 'PDF preview works') {
  await page.waitForFunction((text) => document.querySelector('#text-layer')?.textContent.includes(text)
    && document.querySelector('#status')?.hidden, text);
}
try {
  context = await chromium.launchPersistentContext(profile, {
    ...(executablePath ? { executablePath } : { channel }),
    headless: process.env.HEADED !== '1',
    viewport: { width: 1280, height: 800 }, acceptDownloads: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(30000);
  const watch = (page) => {
    page.on('download', (download) => downloads.push(download));
    page.on('pageerror', (error) => pageErrors.push(error.message));
  };
  context.on('page', watch);
  context.pages().forEach(watch);
  const pdf = createDemoPdf();
  // Fail closed: no test request is allowed to reach a real school or login page.
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!/^https?:$/.test(url.protocol)) return route.continue();
    if (url.origin === 'https://elearning.fudan.edu.cn') {
      if (/\/files\/\d+\/download$/.test(url.pathname)) {
        if (url.pathname.includes('/789/')) return route.fulfill({ status: 403, body: 'Forbidden' });
        if (url.pathname.includes('/999/')) return route.fulfill({ status: 302, headers: { location: 'https://files.example.test/demo.pdf' } });
        return route.fulfill({ contentType: 'application/pdf', body: pdf });
      }
      if (url.pathname === '/courses/123/assignments/456') return route.fulfill({ contentType: 'text/html; charset=utf-8', body:
        '<!doctype html><html lang="zh"><head><title>模拟课程</title></head><body><h1>模拟课程（不包含真实资料）</h1>' +
        '<a href="/courses/123/files/456?wrap=1">演示文件.pdf</a>' +
        '<a class="download" href="/courses/123/files/456/download" download>Download 演示文件.pdf</a>' +
        '<a href="/courses/123/files/789?wrap=1">权限失效示例.pdf</a></body></html>' });
    }
    if (url.href === 'https://files.example.test/demo.pdf') return route.fulfill({ contentType: 'application/pdf', body: pdf });
    unexpectedRequests.push(url.href);
    return route.abort('blockedbyclient');
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const base = new URL('/', worker.url()).href;
  const diagnostic = await context.newPage();
  await diagnostic.goto(`${base}popup.html`);
  report.userAgent = await diagnostic.evaluate(() => navigator.userAgent);
  await check('default permissions are restricted to school and webRequest', async () => {
    report.permissions = await diagnostic.evaluate(() => chrome.permissions.getAll());
    assert.deepEqual(report.permissions.origins, ['https://elearning.fudan.edu.cn/*']);
    assert.deepEqual(report.permissions.permissions, ['webRequest']);
  });

  let welcome;
  await check('installation opens welcome page', async () => {
    const deadline = Date.now() + 30000;
    while (!(welcome = context.pages().find((page) => page.url() === `${base}help.html`)) && Date.now() < deadline) await delay(100);
    assert.ok(welcome, 'No welcome page from onInstalled');
  });
  await check('bundled demo works offline with no external requests', async () => {
    const requests = [];
    const observe = (request) => { if (/^https?:/.test(request.url())) requests.push(request.url()); };
    context.on('request', observe);
    await context.setOffline(true);
    try {
      await welcome.getByRole('link', { name: '先体验示例 PDF', exact: true }).click();
      await rendered(welcome);
      assert.equal(await welcome.locator('#page-count').textContent(), '/ 2');
      assert.equal(await welcome.locator('#original').isVisible(), false);
      assert.equal(await welcome.locator('#demo-note').isVisible(), true);
      await welcome.getByRole('button', { name: '下一页', exact: true }).click();
      await rendered(welcome, 'Second page');
      await welcome.goto(`${base}viewer.html?demo=1&source=https://example.invalid/private.pdf&original=https://elearning.fudan.edu.cn/files/123`);
      await rendered(welcome);
      assert.equal(await welcome.locator('#original').isVisible(), false);
      assert.deepEqual(requests, []);
      await welcome.screenshot({ path: path.join(output, 'offline-demo.png') });
    } finally { await context.setOffline(false); context.off('request', observe); }
  });

  const course = await context.newPage();
  await course.goto('https://elearning.fudan.edu.cn/courses/123/assignments/456');
  let viewer;
  await check('ordinary PDF click opens extension reader and renders text', async () => {
    const opened = context.waitForEvent('page');
    await course.getByRole('link', { name: '演示文件.pdf', exact: true }).click();
    viewer = await opened;
    await rendered(viewer);
    assert.ok(viewer.url().startsWith(`${base}viewer.html?`));
    assert.equal(await viewer.locator('#page-count').textContent(), '/ 2');
    assert.equal(await viewer.locator('#original').isVisible(), true);
    assert.equal(await viewer.locator('#demo-note').isVisible(), false);
    assert.ok(await viewer.locator('#canvas').evaluate((canvas) => canvas.width > 0 && canvas.height > 0));
  });
  await check('navigation and zoom work without automatic downloads', async () => {
    await viewer.getByRole('button', { name: '下一页', exact: true }).click();
    await rendered(viewer, 'Second page');
    assert.equal(await viewer.locator('#page').inputValue(), '2');
    const before = await viewer.locator('#zoom-label').textContent();
    await viewer.getByRole('button', { name: '缩小', exact: true }).click();
    await viewer.waitForFunction((before) => document.querySelector('#zoom-label').textContent !== before, before);
    await rendered(viewer, 'Second page');
    assert.equal(downloads.length, 0);
    await viewer.screenshot({ path: path.join(output, 'course-reader.png') });
  });
  await check('explicit download has correct name and PDF bytes', async () => {
    const pending = viewer.waitForEvent('download');
    await viewer.getByRole('link', { name: '下载 PDF', exact: true }).click();
    const download = await pending;
    assert.equal(download.suggestedFilename(), '演示文件.pdf');
    assert.equal(await download.failure(), null);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), pdf);
    assert.equal(downloads.length, 1);
  });
  await check('original download control is not intercepted', async () => {
    const count = context.pages().length;
    await course.evaluate(() => document.addEventListener('click', (event) => {
      if (event.target.closest('a.download')) {
        document.documentElement.dataset.originalDownloadUnchanged = String(!event.defaultPrevented);
        event.preventDefault(); // Do not navigate away from the controlled fixture.
      }
    }));
    await course.getByRole('link', { name: 'Download 演示文件.pdf', exact: true }).click();
    assert.equal(await course.evaluate(() => document.documentElement.dataset.originalDownloadUnchanged), 'true');
    assert.equal(context.pages().length, count);
  });
  await check('403 shows actionable login error', async () => {
    const opened = context.waitForEvent('page');
    await course.getByRole('link', { name: '权限失效示例.pdf', exact: true }).click();
    const denied = await opened;
    await denied.waitForFunction(() => document.querySelector('#status-detail')?.textContent.includes('登录已失效'));
    assert.equal(await denied.locator('#grant').isVisible(), false);
  });
  await check('cross-host redirect offers only actual destination permission', async () => {
    const redirect = await context.newPage();
    const url = new URL(viewer.url());
    url.searchParams.set('source', 'https://elearning.fudan.edu.cn/courses/123/files/999/download?download_frd=1');
    await redirect.goto(url.href);
    await redirect.locator('#grant').waitFor({ state: 'visible' });
    assert.ok((await redirect.locator('#status-detail').textContent()).includes('files.example.test'));
    assert.deepEqual(await redirect.evaluate(() => chrome.permissions.getAll()), report.permissions);
    await redirect.screenshot({ path: path.join(output, 'permission-prompt.png') });
  });
  await check('untrusted source rejected before any external request', async () => {
    const invalid = await context.newPage();
    await invalid.goto(`${base}viewer.html?source=https://example.invalid/private.pdf`);
    await invalid.waitForFunction(() => document.querySelector('#status-title')?.textContent === '请从 eLearning 打开 PDF');
    assert.equal(await invalid.locator('#download').isVisible(), false);
  });
  assert.deepEqual(unexpectedRequests, []);
  assert.deepEqual(pageErrors, []);
  report.passed = true;
} catch (error) {
  report.failedPhase = phase;
  report.error = error.stack;
  if (context) for (const [i, page] of context.pages().entries()) {
    await page.screenshot({ path: path.join(output, `failure-${i}.png`) }).catch(() => {});
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  report.pageErrors = pageErrors;
  report.unexpectedRequests = unexpectedRequests;
  await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  await context?.close();
  // Only the isolated profile created by this run is removed, never user profiles.
  await rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
