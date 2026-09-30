import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url);
const output = new URL('output/playwright/files/', root);
await mkdir(output, { recursive: true });
const report = { checks: [], passed: false };
// This checks source availability before browser launch, so a missing UI is a clear regression.
assert.ok(await readFile(new URL('extension/file-viewer.html', root)).catch(() => null), 'Local image/text viewer must exist');
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined, headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const unexpected = [], errors = [];
const fixture = new Map();
await context.addInitScript(() => {
  window.chrome = { runtime: { getURL: name => `http://preview.test/${name}` }, permissions: {
    contains: async () => !location.search.includes('permission=1'),
    request: async options => { window.requestedScope = options.origins; return false; },
  }, webRequest: { onBeforeRedirect: { addListener() {}, removeListener() {} } } };
  window.revokedUrls = [];
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = url => { window.revokedUrls.push(url); revoke(url); };
});
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin === 'http://preview.test') {
    const name = url.pathname.slice(1);
    const folder = name === 'formats.js' ? 'shared/' : 'extension/';
    if (!/^[\w.-]+$/.test(name)) return route.abort();
    const bytes = await readFile(new URL(folder + name, root)).catch(() => null);
    if (bytes) return route.fulfill({ body: bytes, contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript' });
  }
  if (fixture.has(url.href)) return route.fulfill(fixture.get(url.href));
  unexpected.push(url.href); return route.abort();
});
const page = await context.newPage();
page.on('pageerror', e => errors.push(e.message));
const source = 'https://elearning.fudan.edu.cn/files/42/download';
const open = async (format, body, contentType, extra = '') => {
  fixture.set(source, { body, contentType });
  await page.goto(`http://preview.test/file-viewer.html?source=${encodeURIComponent(source)}&original=${encodeURIComponent(source)}&format=${format}&name=example.${format === 'text' ? 'txt' : format}${extra}`);
};
const ready = () => page.waitForFunction(() => document.querySelector('#status').hidden);
const failed = () => page.waitForFunction(() => document.querySelector('#status-title').textContent === '暂时无法预览');
const check = async (name, run) => { await run(); report.checks.push(name); console.log('PASS ' + name); };
try {
  await check('text renders script literally; wrap/copy denial and raw download', async () => {
    const body = '中文 <script>window.pwned=1</script>\n' + 'long '.repeat(200);
    await open('text', body, 'text/plain'); await ready();
    assert.equal(await page.locator('#text').textContent(), body);
    await page.screenshot({ path: new URL('text.png', output).pathname });
    assert.equal(await page.evaluate(() => window.pwned), undefined);
    await page.locator('#wrap').click(); assert.equal(await page.locator('#wrap').getAttribute('aria-pressed'), 'false');
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw Error('denied'); } }, configurable: true }));
    await page.locator('#copy').click(); assert.match(await page.locator('#copy-status').textContent(), /手动/);
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copiedText = text; } }, configurable: true }));
    await page.locator('#copy').click(); assert.equal(await page.evaluate(() => window.copiedText), body);
    const pending = page.waitForEvent('download'); await page.locator('#download').click(); const download = await pending;
    const chunks = []; for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(), body);
  });
  await check('GB18030 recovery retains raw bytes; UTF16 BOM automatic decoding', async () => {
    await open('text', Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), 'text/plain'); await failed();
    assert.equal(await page.locator('#encoding').isEnabled(), true);
    await page.locator('#encoding').selectOption('gb18030'); await ready(); assert.equal(await page.locator('#text').textContent(), '中文');
    await open('text', Buffer.from([255,254,0x2d,0x4e,0x87,0x65]), 'text/plain'); await ready(); assert.equal(await page.locator('#text').textContent(), '中文');
  });
  const images = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 120;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#2456a6'; ctx.fillRect(0,0,240,120);
    return ['png','jpeg','webp'].map(type => [type, canvas.toDataURL('image/' + type).split(',')[1]]);
  });
  for (const [format, base64] of images) await check(`${format} browser decode, rotate bounds, zoom and fit`, async () => {
    await open(format, Buffer.from(base64, 'base64'), 'image/' + format); await ready();
    assert.equal(await page.locator('#image').evaluate(img => img.naturalWidth), 240);
    await page.locator('#rotate').click();
    assert.equal(await page.locator('#image').getAttribute('data-rotation'), '90');
    const before = await page.locator('#zoom-label').textContent(); await page.locator('#zoom-out').click();
    assert.notEqual(await page.locator('#zoom-label').textContent(), before);
    await page.locator('#fit').click();
    const fits = await page.locator('#image-frame').evaluate(el => el.clientWidth <= document.querySelector('#workspace').clientWidth && el.clientHeight <= document.querySelector('#workspace').clientHeight);
    assert.ok(fits);
    await page.screenshot({ path: new URL(`${format}.png`, output).pathname });
  });
  await check('corrupt image body fails full decode and oversize headers fail validation', async () => {
    const png = Buffer.from(images[0][1], 'base64');
    await open('png', png.subarray(0,33), 'image/png'); await failed(); assert.equal(await page.locator('#rotate').isDisabled(), true);
    const huge = Buffer.from(png); huge.writeUInt32BE(20000,16);
    await open('png', huge, 'image/png'); await failed(); assert.match(await page.locator('#status-detail').textContent(), /尺寸/);
  });
  await check('login response, unsupported and untrusted query blocked', async () => {
    await open('text', '<html>login</html>', 'text/html'); await failed();
    await page.goto('http://preview.test/file-viewer.html?format=svg&source=https://evil.test/file'); await failed();
    assert.equal(await page.locator('#download').isVisible(), false);
    await page.goto('http://preview.test/file-viewer.html?format=text&source=' + encodeURIComponent(source) + '&original=javascript:alert(1)'); await failed();
    assert.equal(await page.locator('#original').isVisible(), false);
    fixture.set(source, { body: Buffer.from(images[0][1], 'base64'), contentType: 'image/png' });
    await page.goto('http://preview.test/file-viewer.html?format=png&name=file.txt&source=' + encodeURIComponent(source)); await failed();
    assert.equal(await page.locator('#download').isVisible(), false);
  });
  await check('permission gesture requests exact source scope; pagehide releases URLs', async () => {
    await open('text', 'ok', 'text/plain', '&permission=1'); await page.locator('#grant').waitFor({ state: 'visible' });
    await page.locator('#grant').click(); assert.deepEqual(await page.evaluate(() => window.requestedScope), ['https://elearning.fudan.edu.cn/*']);
    await open('text', 'ok', 'text/plain'); await ready();
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    assert.equal(await page.evaluate(() => window.revokedUrls.length), 1);
  });
  await check('oversized image and text responses leave content controls disabled', async () => {
    for (const [format,size,mime] of [['text',2*1024*1024+1,'text/plain'],['png',20*1024*1024+1,'image/png']]) {
      await open(format,Buffer.alloc(size,65),mime); await failed();
      assert.match(await page.locator('#status-detail').textContent(), /超过/);
      assert.equal(await page.locator('#download').isVisible(),false);
      assert.equal(await page.locator('#encoding').isDisabled(),true);
      assert.equal(await page.locator('#rotate').isDisabled(),true);
    }
  });
  await check('retry aborts old work and stale image decoding cannot replace current image', async () => {
    await page.addInitScript(() => {
      const decode = HTMLImageElement.prototype.decode;
      let calls = 0;
      HTMLImageElement.prototype.decode = async function() {
        await decode.call(this);
        if (++calls === 1) await new Promise(resolve => { window.releaseOldDecode = resolve; });
      };
      const originalFetch = window.fetch;
      window.abortCount = 0;
      window.fetch = (url,options) => { options?.signal?.addEventListener('abort',() => window.abortCount++); return originalFetch(url,options); };
    });
    await open('png',Buffer.from(images[0][1],'base64'),'image/png');
    await page.waitForFunction(() => typeof window.releaseOldDecode === 'function');
    await page.evaluate(() => document.querySelector('#retry').dispatchEvent(new Event('click'))); await ready();
    const current = await page.locator('#image').getAttribute('src');
    await page.evaluate(() => window.releaseOldDecode());
    assert.equal(await page.locator('#image').getAttribute('src'),current);
    assert.equal(await page.locator('#download').getAttribute('href'),current);
    assert.equal(await page.evaluate(() => window.revokedUrls.length),1);
    assert.ok(await page.evaluate(() => window.abortCount >= 1));
  });
  assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
  await page.screenshot({ path: new URL('viewer.png', output).pathname }); report.passed = true;
} catch (error) { report.error = error.stack; process.exitCode = 1; console.error(error); }
finally { await writeFile(new URL('result.json', output), JSON.stringify(report,null,2)); await browser.close(); }
