import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { createDemoPdf } from './demo-pdf.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'output/playwright/firefox');
await mkdir(output, { recursive: true });
const downloads = await mkdtemp(path.join(tmpdir(), 'canvas-firefox-downloads-'));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json')));
const report = { platform: process.platform, started: new Date().toISOString(), checks: [], passed: false };
const requests = [], unexpected = [], interceptErrors = [];
const pdf = createDemoPdf();
let driver, phase = 'launch', base;
process.env.SE_AVOID_STATS = 'true';

async function check(name, action) {
  phase = name;
  await action();
  report.checks.push(name);
  console.log(`PASS ${name}`);
}
const evaluate = (fn, ...args) => driver.executeScript(fn, ...args);
const click = (selector) => driver.findElement(By.css(selector)).click();
const rendered = (text = 'PDF preview works') => driver.wait(() => evaluate((text) =>
  document.querySelector('#text-layer')?.textContent.includes(text) && document.querySelector('#status')?.hidden, text), 30000);
const screenshot = async (name) => writeFile(path.join(output, name), Buffer.from(await driver.takeScreenshot(), 'base64'));
async function openedByClick(selector) {
  const before = await driver.getAllWindowHandles();
  await click(selector);
  const handle = await driver.wait(async () => {
    for (const id of await driver.getAllWindowHandles()) {
      if (before.includes(id)) continue;
      await driver.switchTo().window(id);
      if ((await driver.getCurrentUrl()).startsWith(`${base}viewer.html?`)) return id;
    }
    return false;
  }, 30000);
  await driver.switchTo().window(handle);
  return handle;
}

try {
  const options = new firefox.Options().enableBidi().addArguments('-headless');
  if (process.env.FIREFOX_BINARY) options.setBinary(process.env.FIREFOX_BINARY);
  else options.setBrowserVersion('stable');
  // A fresh WebDriver profile only. An unreachable local proxy is the safety net:
  // even if BiDi misses a request, it cannot reach the school or an external server.
  for (const [key, value] of Object.entries({
    'network.proxy.type': 1, 'network.proxy.http': '127.0.0.1', 'network.proxy.http_port': 9,
    'network.proxy.ssl': '127.0.0.1', 'network.proxy.ssl_port': 9, 'network.proxy.no_proxies_on': '',
    'browser.download.folderList': 2, 'browser.download.dir': downloads,
    'browser.download.useDownloadDir': true, 'browser.download.alwaysOpenPanel': false,
    'browser.helperApps.neverAsk.saveToDisk': 'application/pdf',
    'datareporting.healthreport.uploadEnabled': false, 'datareporting.policy.dataSubmissionEnabled': false,
    'toolkit.telemetry.enabled': false,
  })) options.setPreference(key, value);
  const builder = new Builder().forBrowser('firefox').setFirefoxOptions(options);
  // Firefox 138+ requires this testing flag to inspect moz-extension pages.
  // It is scoped to this fresh local WebDriver process, never the user's browser.
  builder.setFirefoxService(new firefox.ServiceBuilder(process.env.GECKODRIVER).addArguments('--allow-system-access'));
  driver = await builder.build();
  await driver.manage().setTimeouts({ pageLoad: 30000, script: 30000 });
  await driver.manage().window().setRect({ width: 1280, height: 900 });
  report.browserVersion = (await driver.getCapabilities()).get('browserVersion');
  const bidi = await driver.getBidi();
  async function send(method, params) {
    const result = await bidi.send({ method, params });
    if (result.type === 'error') throw new Error(`${method}: ${result.error}: ${result.message}`);
    return result.result;
  }
  const socket = await bidi.socket;
  socket.on('message', (raw) => {
    const event = JSON.parse(raw.toString());
    if (event.method !== 'network.beforeRequestSent' || !event.params.isBlocked) return;
    const { request } = event.params;
    requests.push(request.url);
    const url = new URL(request.url);
    let body, statusCode = 200, type = 'text/html; charset=utf-8', headers = [];
    if (url.origin === 'https://elearning.fudan.edu.cn' && url.pathname === '/courses/123/assignments/456') {
      body = '<!doctype html><html lang="zh"><head><title>模拟课程</title><link rel="icon" href="data:,"></head><body>' +
        '<h1>模拟课程（不包含真实资料）</h1><a id="pdf" href="/courses/123/files/456?wrap=1">演示文件.pdf</a>' +
        '<a id="download" class="download" href="/courses/123/files/456/download" download>Download 演示文件.pdf</a>' +
        '<a id="denied" href="/courses/123/files/789?wrap=1">权限失效示例.pdf</a></body></html>';
    } else if (url.origin === 'https://elearning.fudan.edu.cn' && /\/files\/\d+\/download$/.test(url.pathname)) {
      if (url.pathname.includes('/789/')) { statusCode = 403; body = 'Forbidden'; }
      else if (url.pathname.includes('/999/')) {
        statusCode = 302; body = ''; headers.push({ name: 'location', value: { type: 'string', value: 'https://files.example.test/demo.pdf' } });
      } else { body = pdf; type = 'application/pdf'; }
    } else if (url.href === 'https://files.example.test/demo.pdf') { body = pdf; type = 'application/pdf'; }
    else {
      unexpected.push(request.url);
      send('network.failRequest', { request: request.request }).catch((error) => interceptErrors.push(error.message));
      return;
    }
    headers.push({ name: 'content-type', value: { type: 'string', value: type } });
    send('network.provideResponse', { request: request.request, statusCode, headers,
      body: { type: 'base64', value: Buffer.from(body).toString('base64') },
    }).catch((error) => interceptErrors.push(error.message));
  });
  await send('session.subscribe', { events: ['network.beforeRequestSent'] });
  await send('network.addIntercept', { phases: ['beforeRequestSent'], urlPatterns: [
    { type: 'pattern', protocol: 'https' }, { type: 'pattern', protocol: 'http' },
  ] });

  await check('Firefox temporarily installs actual package and opens welcome', async () => {
    assert.equal(await driver.installAddon(path.join(root, `dist/fudan-elearning-pdf-preview-firefox-${pkg.version}.zip`), true), 'fudan-elearning-pdf-preview@sjy0630');
    await driver.wait(async () => {
      for (const handle of await driver.getAllWindowHandles()) {
        await driver.switchTo().window(handle);
        const url = await driver.getCurrentUrl();
        if (/^moz-extension:\/\/[^/]+\/help.html$/.test(url)) { base = new URL('/', url).href; return true; }
      }
      return false;
    }, 30000);
  });
  await check('default permissions remain school-only', async () => {
    report.permissions = await evaluate(() => browser.permissions.getAll());
    assert.deepEqual(report.permissions.origins, ['https://elearning.fudan.edu.cn/*']);
    assert.deepEqual(report.permissions.permissions, ['webRequest']);
  });
  await check('bundled demo renders without network and ignores source overrides', async () => {
    const before = requests.length;
    await click('a[href="viewer.html?demo=1"]');
    await rendered();
    assert.equal(await evaluate(() => document.querySelector('#page-count').textContent), '/ 2');
    await click('#next'); await rendered('Second page');
    await driver.get(`${base}viewer.html?demo=1&source=https://example.invalid/private.pdf&original=https://elearning.fudan.edu.cn/files/123`);
    await rendered();
    assert.equal(await evaluate(() => document.querySelector('#original').hidden), true);
    assert.equal(requests.length, before);
    await screenshot('offline-demo.png');
  });
  await driver.switchTo().newWindow('tab');
  const course = await driver.getWindowHandle();
  await driver.get('https://elearning.fudan.edu.cn/courses/123/assignments/456');
  let viewer;
  await check('Canvas click opens reader with text layer and two pages', async () => {
    viewer = await openedByClick('#pdf');
    await rendered();
    assert.ok((await driver.getCurrentUrl()).startsWith(`${base}viewer.html?`));
    assert.equal(await evaluate(() => document.querySelector('#page-count').textContent), '/ 2');
  });
  await check('navigation and zoom do not automatically download', async () => {
    await click('#next'); await rendered('Second page');
    assert.equal(await evaluate(() => document.querySelector('#page').value), '2');
    const zoom = await evaluate(() => document.querySelector('#zoom-label').textContent);
    await click('#zoom-out');
    await driver.wait(() => evaluate((before) => document.querySelector('#zoom-label').textContent !== before, zoom), 30000);
    await rendered('Second page');
    assert.deepEqual(await readdir(downloads), []);
    await screenshot('course-reader.png');
  });
  // Check interception before explicitly downloading. Firefox may asynchronously
  // open its own local PDF viewer after a completed download.
  await check('original download is not intercepted', async () => {
    await driver.switchTo().window(course);
    const count = (await driver.getAllWindowHandles()).length;
    await evaluate(() => document.addEventListener('click', (event) => {
      if (event.target.closest('a.download')) {
        document.documentElement.dataset.originalDownloadUnchanged = String(!event.defaultPrevented);
        event.preventDefault();
      }
    }));
    await click('#download');
    assert.equal(await evaluate(() => document.documentElement.dataset.originalDownloadUnchanged), 'true');
    assert.equal((await driver.getAllWindowHandles()).length, count);
  });
  await check('explicit download preserves filename and bytes', async () => {
    await driver.switchTo().window(viewer);
    await click('#download');
    await driver.wait(async () => {
      try { return (await readFile(path.join(downloads, '演示文件.pdf'))).equals(pdf); } catch { return false; }
    }, 30000);
    assert.deepEqual(await readdir(downloads), ['演示文件.pdf']);
  });
  await check('403 displays actionable login message', async () => {
    await driver.switchTo().window(course);
    await openedByClick('#denied');
    await driver.wait(() => evaluate(() => document.querySelector('#status-detail')?.textContent.includes('登录已失效')), 30000);
  });
  await check('cross-host redirect offers only actual destination permission', async () => {
    await driver.get(`${base}viewer.html?source=${encodeURIComponent('https://elearning.fudan.edu.cn/courses/123/files/999/download?download_frd=1')}`);
    await driver.wait(() => evaluate(() => document.querySelector('#grant') && !document.querySelector('#grant').hidden), 30000);
    assert.ok((await evaluate(() => document.querySelector('#status-detail').textContent)).includes('files.example.test'));
    assert.deepEqual(await evaluate(() => browser.permissions.getAll()), report.permissions);
    await screenshot('permission-prompt.png');
  });
  await check('untrusted source is rejected without external fetch', async () => {
    await driver.get(`${base}viewer.html?source=https://example.invalid/private.pdf`);
    await driver.wait(() => evaluate(() => document.querySelector('#status-title')?.textContent === '请从 eLearning 打开 PDF'), 30000);
  });
  assert.deepEqual(unexpected, []);
  assert.deepEqual(interceptErrors, []);
  report.windows = [];
  for (const handle of await driver.getAllWindowHandles()) {
    await driver.switchTo().window(handle);
    report.windows.push(await driver.getCurrentUrl());
  }
  report.passed = true;
} catch (error) {
  report.failedPhase = phase;
  report.error = error.stack;
  console.error(error);
  if (driver) {
    report.lastUrl = await driver.getCurrentUrl().catch(() => null);
    report.lastPage = await driver.getPageSource().catch(() => null);
    await screenshot('failure.png').catch(() => {});
    report.windows = [];
    for (const handle of await driver.getAllWindowHandles().catch(() => [])) {
      await driver.switchTo().window(handle);
      report.windows.push(await driver.getCurrentUrl());
    }
  }
  process.exitCode = 1;
} finally {
  report.requests = requests;
  report.unexpectedRequests = unexpected;
  report.interceptErrors = interceptErrors;
  await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  await driver?.quit();
  await rm(downloads, { recursive: true, force: true, maxRetries: 3 });
}
