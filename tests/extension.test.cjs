const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const corePath = path.join(__dirname, '../extension/core.js');
require(path.join(__dirname, '../shared/formats.js'));
require(path.join(__dirname, '../extension/catalog.js'));
require(corePath);
const core = globalThis.FdPdf;
const source = `${core.ORIGIN}/courses/123/files/456/download?download_frd=1`;

test('routes exact registered suffixes and falls back to direct URL names', () => {
  for (const [name, format] of [['a.png', 'png'], ['a.JPEG', 'jpeg'], ['a.webp', 'webp'], ['a.py', 'text']]) {
    assert.equal(core.describe(source, name).format, format);
    assert.equal(core.fileName(name, format), name);
  }
  assert.equal(core.describe(source, 'a.txt.backup'), null);
  assert.equal(core.describe(`${core.ORIGIN}/assets/a%20b.txt`, '打开').name, 'a b.txt');
  assert.equal(core.describe(`${core.ORIGIN}/files/123/extra`, 'a.txt'), null);
  assert.equal(core.describe(`${core.ORIGIN}/files/123/extra.txt`, 'a.txt'), null);
  assert.equal(core.describe(source, 'a.pdf').format, 'pdf');
});

test('format-aware names keep suffix within the existing 180 character bound', () => {
  const name = core.fileName('a'.repeat(200) + '.jpeg', 'jpeg');
  assert.ok(name.length <= 180);
  assert.match(name, /\.jpeg$/);
});

test('click filename priority includes useful title fallback', () => {
  const link = { nodeType: 1, href: source, dataset: {}, textContent: '打开文件', title: 'a.png', closest() { return this; }, hasAttribute: () => false, matches: () => false };
  assert.equal(core.fromClick({ target: link, button: 0 }).format, 'png');
  link.dataset.filename = 'a.txt';
  assert.equal(core.fromClick({ target: link, button: 0 }).format, 'text');
});

test('generic messages require agreeing format and filename; legacy PDF remains compatible', () => {
  const sender = { id: 'id', tab: { id: 1 }, url: core.ORIGIN };
  const file = { source, original: source, name: 'a.png', format: 'png' };
  assert.ok(core.allowedMessage({ type: 'open-file', file }, sender, 'id'));
  for (const change of [{ name: 'a.txt' }, { format: 'svg' }, { name: 'a' }, { original: undefined }]) {
    assert.equal(core.allowedMessage({ type: 'open-file', file: { ...file, ...change } }, sender, 'id'), false);
  }
  assert.equal(core.allowedMessage({ type: 'open-pdf', file }, sender, 'id'), false);
  assert.ok(core.allowedMessage({ type: 'open-pdf', file: { source } }, sender, 'id'));
  assert.ok(core.allowedMessage({ type: 'open-pdf', file: { source, name: 'lecture' } }, sender, 'id'));
  assert.ok(core.allowedMessage({ type: 'open-pdf', file: { source, name: 'lecture.docx' } }, sender, 'id'));
  assert.equal(core.filename('lecture.docx'), 'lecture.docx.pdf');
  assert.equal(core.allowedMessage({ type: 'open-file', file: { source, original: source, name: 'lecture', format: 'pdf' } }, sender, 'id'), false);
});

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
  await new Promise(resolve => listener({ type: 'open-file', file: { source, original: source, name: 'a.txt', format: 'text', viewer: 'https://evil.test/' } }, { id: 'id', tab: { id: 9 }, url: core.ORIGIN }, resolve));
  assert.equal(new URL(opened.url).pathname, '/file-viewer.html');
  assert.equal(new URL(opened.url).searchParams.get('name'), 'a.txt');
  assert.equal(new URL(opened.url).searchParams.get('format'), 'text');
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

test('generic reader validates MIME and enforces descriptor and smaller caller limits', async () => {
  const { readFile } = await readerModule;
  assert.equal(typeof readFile, 'function');
  const result = await readFile(source, { api: fakeApi(), format: 'text', fetchImpl: async () => new Response('hello') });
  assert.equal(result.mime, 'text/plain');
  assert.equal(new TextDecoder().decode(result.bytes), 'hello');
  for (const limit of [Infinity, -1, NaN, 999999999]) {
    await assert.rejects(readFile(source, { api: fakeApi(), format: 'text', limit, fetchImpl: async () => new Response('x', { headers: { 'content-length': String(3 * 1024 * 1024) } }) }), /2 MiB/);
  }
  await assert.rejects(readFile(source, { api: fakeApi(), format: 'text', limit: 3, fetchImpl: async () => new Response('four') }), /3 字节/);
  await assert.rejects(readFile(source, { api: fakeApi(), format: 'text', fetchImpl: async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }) }), /网页/);
});

test('caller cancellation before and during streams is distinct from timeout and releases resources', async () => {
  const { readFile } = await readerModule;
  assert.equal(typeof readFile, 'function');
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(readFile(source, { api: fakeApi(), format: 'text', signal: aborted.signal, fetchImpl: () => { throw Error('must not fetch'); } }), { name: 'AbortError' });
  const controller = new AbortController(), api = fakeApi();
  let cancelled = false;
  await assert.rejects(readFile(source, { api, format: 'text', signal: controller.signal, fetchImpl: async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([65])); setTimeout(() => controller.abort(), 5); }, cancel() { cancelled = true; } })) }), { name: 'AbortError' });
  assert.equal(api.listening, false);
  assert.equal(cancelled, true);
});

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

test('legacy PDF reading remains signature based regardless of server MIME', async () => {
  const { readPdf, readFile } = await readerModule;
  for (const mime of ['application/x-pdf', 'application/download', 'image/png', 'text/html']) {
    const fetchImpl = async () => new Response('%PDF-1.7\nlegacy', { headers: { 'content-type': mime } });
    assert.equal(new TextDecoder().decode(await readPdf(source, { api: fakeApi(), fetchImpl })), '%PDF-1.7\nlegacy');
    await assert.rejects(readFile(source, { api: fakeApi(), format: 'pdf', fetchImpl }), /类型|网页/);
  }
  await assert.rejects(readPdf(source, { api: fakeApi(), fetchImpl: async () => new Response('not PDF', { headers: { 'content-type': 'application/x-pdf' } }) }), /不是 PDF/);
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

test('reader cleanup failures cannot hide a size failure and descriptor validation precedes fetching', async () => {
  const { readFile } = await readerModule;
  const api = fakeApi();
  api.webRequest.onBeforeRedirect.removeListener = () => { throw Error('cleanup failed'); };
  await assert.rejects(readFile(source, { api, format: 'text', limit: 1, fetchImpl: async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2])); }, cancel() { throw Error('cancel failed'); } })) }), /1 字节/);
  await assert.rejects(readFile(source, { api, format: 'svg', fetchImpl: () => { throw Error('must not fetch'); } }), /不支持/);
});

test('a stalled real response stream times out and is cancelled', async () => {
  const { readFile } = await readerModule;
  const api = fakeApi(); let cancelled = false;
  await assert.rejects(readFile(source, { api, format: 'text', timeout: 5, fetchImpl: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })) }), /超时/);
  assert.equal(cancelled, true);
  assert.equal(api.listening, false);
});

test('generic image reading validates bytes and leaves the stream unlocked', async () => {
  const { readFile } = await readerModule;
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const response = new Response(bytes, { headers: { 'content-type': 'image/png' } });
  const result = await readFile(source, { api: fakeApi(), format: 'png', fetchImpl: async () => response });
  assert.equal(result.mime, 'image/png');
  assert.deepEqual(Buffer.from(result.bytes), bytes);
  assert.equal(response.body.locked, false);
  await assert.rejects(readFile(source, { api: fakeApi(), format: 'png', fetchImpl: async () => new Response('not an image', { headers: { 'content-type': 'image/png' } }) }), /格式不符/);
});
