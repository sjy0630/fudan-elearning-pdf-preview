import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { bundlePdfjs } from './bundle-pdfjs.mjs';
import { createTwoPagePdf } from './reader-test-fixtures.mjs';

const [bundle, runtime] = await Promise.all([
  bundlePdfjs(), readFile(new URL('../userscript/pdfjs-runtime.js', import.meta.url), 'utf8'),
]);
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined });
try {
  const context = await browser.newContext({ offline: true });
  const requests = [], errors = [];
  await context.route('**/*', route => {
    if (route.request().url() === 'https://reader.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Offline PDF runtime verification</title>' });
    requests.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://reader.test/');
  await page.evaluate(() => {
    window.workerCount = 0; window.terminated = 0; window.revoked = [];
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); window.workerCount++; }
      terminate() { window.terminated++; return super.terminate(); }
    };
    const revoke = URL.revokeObjectURL;
    URL.revokeObjectURL = url => { window.revoked.push(url); revoke(url); };
    window.pdfjsLib = 'existing page value';
  });
  // Test-only exposure of the source factory. The generated installable script
  // has no exports, globals or alternate production paths for testing.
  await page.addScriptTag({ content: `(() => {\n${bundle}\n${runtime}\nwindow.testRuntime = createPdfjsRuntime();\n})();` });
  const render = async bytes => page.evaluate(async input => {
    const original = Uint8Array.from(input), copy = original.slice();
    const opened = window.testRuntime.open(original);
    try {
      const document = await opened.promise;
      const pages = [];
      for (let number = 1; number <= document.numPages; number++) {
        const page = await document.getPage(number);
        const viewport = page.getViewport({ scale: 1 });
        const canvas = window.document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        window.document.body.append(canvas);
        const context = canvas.getContext('2d');
        await page.render({ canvasContext: context, viewport }).promise;
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let ink = 0;
        for (let offset = 0; offset < pixels.length; offset += 4) if (pixels[offset] < 240 || pixels[offset + 1] < 240 || pixels[offset + 2] < 240) ink++;
        pages.push({ text: (await page.getTextContent()).items.map(item => item.str).join(' '), ink });
      }
      return { pages, unchanged: original.length === copy.length && original.every((value, index) => value === copy[index]) };
    } finally { await opened.destroy(); await opened.destroy(); }
  }, [...bytes]);
  const simple = await render(createTwoPagePdf());
  assert.equal(simple.pages.length, 2);
  assert.ok(simple.unchanged);
  for (const [index, page] of simple.pages.entries()) {
    assert.match(page.text, new RegExp(`Offline PDF fixture - page ${index + 1}`));
    assert.ok(page.ink > 10000, `page ${index + 1} rendered visible content`);
  }
  if (process.env.PDFJS_CJK_FIXTURE) {
    const cjk = await render(await readFile(process.env.PDFJS_CJK_FIXTURE));
    assert.equal(cjk.pages.length, 2);
    assert.ok(cjk.unchanged);
    assert.ok(cjk.pages.every(page => /[\u4e00-\u9fff]/u.test(page.text) && page.ink > 1000));
  }
  assert.equal(await page.evaluate(() => testRuntime.getLibrary().version), '6.3.289');
  assert.equal(await page.evaluate(() => window.pdfjsLib), 'existing page value');
  assert.equal(await page.evaluate(() => window.pdfjsWorker), undefined);
  assert.deepEqual(await page.evaluate(() => [workerCount, terminated, revoked.length]), process.env.PDFJS_CJK_FIXTURE ? [2, 2, 2] : [1, 1, 1]);
  // A real CSP block must reject without attempting PDF.js fake-worker fallback.
  await page.addScriptTag({ content: `document.head.insertAdjacentHTML('beforeend', '<meta http-equiv="Content-Security-Policy" content="worker-src \\'none\\'">');` });
  const csp = await page.evaluate(async () => {
    const opened = testRuntime.open(new Uint8Array([37, 80, 68, 70]));
    try { await opened.promise; return 'unexpected success'; }
    catch (error) { return error.message; }
    finally { await opened.destroy(); }
  });
  assert.match(csp, /Worker|Content Security Policy|worker/i);
  assert.deepEqual(requests, [], 'all runtime resource loads stay offline');
  assert.deepEqual(errors, []);
  console.log(`PASS Chromium ${browser.version()}: embedded PDF.js 6.3.289, two-page render/text, byte preservation, worker cleanup, private registry, CSP rejection, zero network requests${process.env.PDFJS_CJK_FIXTURE ? ', Chinese/CMap/font fixture' : ''}.`);
} finally { await browser.close(); }
