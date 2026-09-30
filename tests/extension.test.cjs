const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const corePath = path.join(__dirname, '../extension/core.js');
require(path.join(__dirname, '../extension/catalog.js'));
require(corePath);
const core = globalThis.FdPdf;
const source = `${core.ORIGIN}/courses/123/files/456/download?download_frd=1`;

test('builds a school download URL and preserves the file verifier', () => {
  const file = core.describe(`${core.ORIGIN}/courses/123/files/456?wrap=1&verifier=abc`, '课堂资料.pdf');
  assert.equal(file.source, `${source}&verifier=abc`);
  assert.equal(file.name, '课堂资料.pdf');
});

test('rejects foreign origins, lookalike domains, credentials and non-file endpoints', () => {
  for (const url of ['https://example.com/a.pdf', 'https://elearning.fudan.edu.cn.evil.test/a.pdf',
    'https://user:password@elearning.fudan.edu.cn/a.pdf', `${core.ORIGIN}/api/v1/users/self`, 'javascript:alert(1)']) {
    assert.equal(core.fileUrl(url), null, url);
  }
});

test('normal download controls and modified clicks are not intercepted', () => {
  const link = { nodeType: 1, href: source, dataset: {}, textContent: '资料.pdf', closest() { return this; }, hasAttribute: () => false, matches: () => false };
  const event = { target: link, button: 0 };
  assert.ok(core.fromClick(event));
  for (const key of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey', 'defaultPrevented']) assert.equal(core.fromClick({ ...event, [key]: true }), null);
  assert.equal(core.fromClick({ ...event, button: 1 }), null);
  link.matches = () => true;
  assert.equal(core.fromClick(event), null);
  link.matches = () => false; link.hasAttribute = () => true;
  assert.equal(core.fromClick(event), null);
});

test('only the extension content script on the school origin can open the viewer', () => {
  const sender = { id: 'extension-id', tab: { id: 1 }, url: `${core.ORIGIN}/courses/123/assignments/2` };
  const message = { type: 'open-pdf', file: { source, original: source } };
  assert.ok(core.allowedMessage(message, sender, 'extension-id'));
  assert.equal(core.allowedMessage(message, { ...sender, url: 'https://example.com/' }, 'extension-id'), false);
  assert.equal(core.allowedMessage(message, { ...sender, id: 'other' }, 'extension-id'), false);
  assert.equal(core.allowedMessage(message, { ...sender, tab: null }, 'extension-id'), false);
  assert.equal(core.allowedMessage({ ...message, file: { source: 'https://evil.test/a.pdf', original: source } }, sender, 'extension-id'), false);
});

test('permission requests identify one HTTPS host and never a wildcard', () => {
  assert.equal(core.permissionScope('https://files.example.edu/path?token=secret'), 'https://files.example.edu/*');
  assert.equal(core.permissionScope('http://files.example.edu/path'), null);
  assert.equal(core.permissionScope('https://user:pass@files.example.edu/path'), null);
});

test('background opens an extension viewer and ignores unauthorized messages', async () => {
  let listener, opened;
  const context = { URL, FdPdf: core, CanvasPreviewCatalog: globalThis.CanvasPreviewCatalog, chrome: {
    runtime: { id: 'id', getURL: (p) => `chrome-extension://id/${p}`, onMessage: { addListener(fn) { listener = fn; } }, onInstalled: { addListener() {} } },
    tabs: { async create(options) { opened = options; } },
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8'), context);
  assert.equal(listener({ type: 'open-pdf' }, { url: 'https://evil.test' }, () => {}), false);
  assert.equal(opened, undefined);
  await new Promise((resolve) => {
    assert.equal(listener({ type: 'open-pdf', file: { source, original: source, name: 'demo.pdf' } }, { id: 'id', tab: { id: 9 }, url: core.ORIGIN }, (result) => { assert.equal(result.ok, true); resolve(); }), true);
  });
  assert.equal(opened.openerTabId, 9);
  assert.equal(new URL(opened.url).searchParams.get('source'), source);
});

function fakeApi() {
  let listener;
  return {
    permissions: { async contains({ origins }) { return origins[0] === `${core.ORIGIN}/*`; } },
    webRequest: { onBeforeRedirect: { addListener(fn) { listener = fn; }, removeListener(fn) { assert.equal(listener, fn); listener = null; } } },
    redirect(url, redirectUrl, requestId = '1') { listener({ url, redirectUrl, requestId }); },
    get listening() { return Boolean(listener); },
  };
}
const readerModule = import(pathToFileURL(path.join(__dirname, '../extension/reader.mjs')));

test('retrieves PDF bytes with credentials and cleans up request observers', async () => {
  const { readPdf } = await readerModule;
  const api = fakeApi();
  const bytes = await readPdf(source, { api, fetchImpl: async (url, options) => {
    assert.equal(url, source); assert.equal(options.credentials, 'include');
    return new Response('%PDF-1.7\ntest');
  } });
  assert.equal(new TextDecoder().decode(bytes), '%PDF-1.7\ntest');
  assert.equal(api.listening, false);
});

test('a blocked redirect asks only for the actual destination host', async () => {
  const { readPdf, HostPermissionError } = await readerModule;
  const api = fakeApi();
  await assert.rejects(readPdf(source, { api, fetchImpl: async () => {
    api.redirect('https://unrelated.test/file', 'https://wrong.test/');
    api.redirect(source, 'https://files.example.edu/a.pdf?secret=x');
    throw new TypeError('Failed to fetch');
  } }), (error) => error instanceof HostPermissionError && error.scope === 'https://files.example.edu/*');
  assert.equal(api.listening, false);
});

test('HTML login pages and denied files produce usable errors without requesting broader permissions', async () => {
  const { readPdf } = await readerModule;
  await assert.rejects(readPdf(source, { api: fakeApi(), fetchImpl: async () => new Response('<html>login</html>') }), /不是 PDF/);
  await assert.rejects(readPdf(source, { api: fakeApi(), fetchImpl: async () => new Response('', { status: 403 }) }), /登录已失效/);
});

test('size limits cover both declared size and streamed content', async () => {
  const { readPdf } = await readerModule;
  await assert.rejects(readPdf(source, { api: fakeApi(), limit: 10, fetchImpl: async () => new Response('%PDF-', { headers: { 'content-length': '100' } }) }), /超过/);
  await assert.rejects(readPdf(source, { api: fakeApi(), limit: 10, fetchImpl: async () => new Response('%PDF-1234567890') }), /超过/);
});

test('a timed out request is aborted and the observer is released', async () => {
  const { readPdf } = await readerModule;
  const api = fakeApi();
  await assert.rejects(readPdf(source, { api, timeout: 5, fetchImpl: (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))) }), /超时/);
  assert.equal(api.listening, false);
});
