const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = name => import(pathToFileURL(path.join(__dirname, `../shared/presentation-${name}.mjs`)));
const enc = s => new TextEncoder().encode(s);
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
async function pptx(changes = {}) {
  const { zipSync } = await import('fflate');
  return zipSync(Object.fromEntries(Object.entries({
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
    '_rels/.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
    'ppt/presentation.xml': `<p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/slide" Target="slides/slide1.xml"/></Relationships>`,
    'ppt/slides/slide1.xml': `<p:sld xmlns:p="${P}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Text"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="100000" y="100000"/><a:ext cx="8000000" cy="1000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="2400"/><a:t>真实幻灯片内容</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    ...changes,
  }).filter(([, v]) => v !== null).map(([k, v]) => [k, enc(v)])), { level: 6 });
}
test('presentation policy accepts exact format containers and enforces limits', async () => {
  const p = await load('policy');
  assert.equal(p.PRESENTATION_LIMITS.fileBytes, 50 * 1024 * 1024);
  assert.equal(p.PRESENTATION_LIMITS.slides, 500);
  assert.equal(p.PRESENTATION_LIMITS.timeoutMs, 30000);
  const b = await pptx();
  assert.equal(p.checkPresentationTransfer(b, 'pptx'), b);
  assert.throws(() => p.checkPresentationTransfer(b, 'ppt'), /格式|容器/);
  assert.throws(() => p.checkPresentationTransfer(b, 'pptx', 'text/html'), /网页/);
  assert.throws(() => p.checkPresentationTransfer(new Uint8Array(p.PRESENTATION_LIMITS.fileBytes + 1), 'pptx'), /50 MiB/);
});
test('PPTX package requires genuine parts, relationships, namespace and no macros', async () => {
  const { verifyPresentationPackage } = await load('package');
  assert.equal(verifyPresentationPackage(await pptx(), 'pptx').slideCount, 1);
  assert.throws(() => verifyPresentationPackage(new Uint8Array([80,75,3,4]), 'pptx'), /ZIP/);
  for (const mutation of [{ 'ppt/presentation.xml': '<presentation/>' }, { '_rels/.rels': '<Relationships/>' }, { 'ppt/slides/slide1.xml': null }, { 'ppt/vbaProject.bin': 'bad' }, { 'ppt/presentation.xml': '<!DOCTYPE a><a/>' }]) {
    const input = await pptx(mutation);
    assert.throws(() => verifyPresentationPackage(input, 'pptx'));
  }
});
test('worker parses actual PPTX lazily and renders only requested slide with SVG text', async () => {
  const { createPresentationWorkerHandler } = await load('worker');
  const messages = [];
  const handle = createPresentationWorkerHandler(m => messages.push(m));
  await handle({ data: { type: 'open', id: 'p1', bytes: await pptx(), format: 'pptx' } });
  assert.equal(messages[0].type, 'ready');
  assert.equal(messages[0].slideCount, 1);
  assert.equal(messages[0].svg, undefined);
  await handle({ data: { type: 'render', id: 'p2', page: 0 } });
  assert.equal(messages[1].type, 'slide');
  assert.match(messages[1].svg, /真实幻灯片内容/);
  assert.doesNotMatch(messages[1].svg, /foreignObject|@font-face/);
  await handle({ data: { type: 'render', id: 'p3', page: 1 } });
  assert.equal(messages[2].type, 'error');
  handle.dispose();
});
test('sanitizer preserves SVG text/shapes but removes all request and navigation sources', async () => {
  const { sanitizePresentationSlide } = await load('sanitize');
  const result = await sanitizePresentationSlide({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 720"><script>alert(1)</script><style>@import "https://evil.invalid";</style><foreignObject><iframe src="https://evil.invalid"/></foreignObject><a href="https://evil.invalid"><text x="20" y="30" style="font-size:24px;fill:url(https://evil.invalid)">保留文字</text></a><image href="https://evil.invalid/x.png"/><path d="M0 0L10 10" stroke="red"/><rect fill="url(https://evil.invalid)"/><use href="https://evil.invalid/x.svg#p"/></svg>', assets: [], warnings: [], page: 0 }, { width: 960, height: 720 });
  assert.match(result.srcdoc, /保留文字/);
  assert.match(result.srcdoc, /<path/);
  assert.doesNotMatch(result.srcdoc, /evil\.invalid|<script|<style[^>]*>@|foreignObject|<a\s|<use/);
  assert.match(result.srcdoc, /default-src 'none'/);
  assert.match(result.srcdoc, /connect-src 'none'/);
  assert.ok(result.warnings.length);
});
test('runtime verifies after ready, keeps original bytes and ignores stale replies', async () => {
  const { createPresentationSession } = await load('runtime');
  const handlers = new Map(), sent = [];
  let terminated = 0, disposed = 0, verified = 0;
  const worker = { addEventListener: (n, f) => handlers.set(n, f), removeEventListener: n => handlers.delete(n), postMessage: m => sent.push(m), terminate: () => terminated++ };
  const bytes = await pptx();
  const task = createPresentationSession(bytes, 'pptx', '', { makeWorker: () => ({ worker, dispose: () => disposed++ }), onVerified: () => verified++ });
  assert.notEqual(sent[0].bytes.buffer, bytes.buffer);
  assert.equal(verified, 0);
  handlers.get('message')({ data: { id: 'stale', type: 'ready', slideCount: 1, width: 960, height: 720, format: 'pptx', warnings: [] } });
  handlers.get('message')({ data: { id: sent[0].id, type: 'ready', slideCount: 1, width: 960, height: 720, format: 'pptx', warnings: [] } });
  const session = await task;
  assert.equal(verified, 1);
  const render = session.render(0);
  handlers.get('message')({ data: { id: sent[1].id, type: 'slide', page: 0, svg: '<svg/>', assets: [], warnings: [] } });
  assert.equal((await render).page, 0);
  session.dispose(); session.dispose();
  assert.equal(terminated, 1); assert.equal(disposed, 1);
  assert.ok(bytes.length);
});
test('normal binary PPT renders real text, raster image and table in page order', async () => {
  const fs = require('node:fs');
  const { createPresentationWorkerHandler } = await load('worker');
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/presentation/normal.ppt'));
  const messages = [], handle = createPresentationWorkerHandler(m => messages.push(m));
  await handle({ data: { type: 'open', id: 'normal-open', bytes, format: 'ppt' } });
  assert.equal(messages[0].type, 'ready', messages[0].message);
  assert.equal(messages[0].slideCount, 3);
  for (const page of [0, 1, 2, 0]) await handle({ data: { type: 'render', id: `normal-${messages.length}`, page } });
  assert.deepEqual(messages.slice(1).map(m => m.page), [0, 1, 2, 0]);
  assert.ok(messages[1].svg.includes('<text'));
  assert.equal(messages[2].assets.length, 1);
  assert.ok(messages[3].svg.includes('<text'));
  assert.equal(messages[1].svg, messages[4].svg);
  handle.dispose();
});
function fakeReaderDom() {
  class Element {
    constructor(tag, document) { this.localName = tag; this.ownerDocument = document; this.children = []; this.attributes = {}; this.style = {}; this.events = new Map(); this.clientWidth = 1000; this.clientHeight = 700; }
    setAttribute(k, v) { this.attributes[k] = v; }
    addEventListener(k, f) { if (!this.events.has(k)) this.events.set(k, new Set()); this.events.get(k).add(f); }
    removeEventListener(k, f) { this.events.get(k)?.delete(f); }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    replaceChildren(...children) { this.children.forEach(c => c.parent = null); this.children = []; this.append(...children); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; }
    fire(type) { for (const f of this.events.get(type) || []) f({ type }); this[`on${type}`]?.(); }
    click() { if (!this.disabled) this.fire('click'); }
  }
  const document = { createElement: tag => new Element(tag, document), defaultView: { addEventListener() {}, removeEventListener() {} } };
  const host = new Element('div', document);
  return { host, find: tag => { const pending = [host]; while (pending.length) { const n = pending.pop(); if (n.localName === tag) return n; pending.push(...n.children); } } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function fakeWorker() {
  const handlers = new Map(), sent = [];
  let terminated = 0, disposed = 0;
  const worker = { addEventListener: (n, f) => handlers.set(n, f), removeEventListener: n => handlers.delete(n), postMessage: m => sent.push(m), terminate: () => terminated++ };
  return { sent, makeWorker: () => ({ worker, dispose: () => disposed++ }), reply: data => handlers.get('message')?.({ data }), counts: () => [terminated, disposed] };
}
test('reader resolves only once sandboxed first slide has loaded, then disposes on abort', async () => {
  const { createPresentationReader } = await load('reader');
  const dom = fakeReaderDom(), fake = fakeWorker(), aborter = new AbortController();
  let resolved = false;
  const opening = createPresentationReader({ host: dom.host, bytes: await pptx(), format: 'pptx', makeWorker: fake.makeWorker, signal: aborter.signal }).then(v => { resolved = true; return v; });
  fake.reply({ id: fake.sent[0].id, type: 'ready', format: 'pptx', slideCount: 1, width: 960, height: 720, warnings: [] });
  await tick();
  fake.reply({ id: fake.sent[1].id, type: 'slide', page: 0, svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>第一页</text></svg>', assets: [], warnings: [] });
  await tick();
  const frame = dom.find('iframe');
  assert.ok(frame);
  const beforeLoad = resolved;
  frame.fire('load');
  const reader = await opening;
  assert.equal(beforeLoad, false, 'Reader must not resolve before iframe load');
  assert.equal(frame.attributes.sandbox, '');
  assert.equal(frame.attributes.referrerpolicy, 'no-referrer');
  aborter.abort(); reader.dispose();
  assert.deepEqual(fake.counts(), [1, 1]);
  assert.equal(dom.host.children.length, 0);
});
test('runtime abort and invalid current replies terminate and revoke exactly once', async () => {
  const { createPresentationSession } = await load('runtime');
  const fake = fakeWorker(), aborter = new AbortController();
  const opening = createPresentationSession(await pptx(), 'pptx', '', { makeWorker: fake.makeWorker, signal: aborter.signal });
  aborter.abort();
  await assert.rejects(opening, { name: 'AbortError' });
  assert.deepEqual(fake.counts(), [1, 1]);
  const bad = fakeWorker(); let verified = 0;
  const invalid = createPresentationSession(await pptx(), 'pptx', '', { makeWorker: bad.makeWorker, onVerified: () => verified++ });
  bad.reply({ id: bad.sent[0].id, type: 'ready', format: 'pptx', slideCount: 501, width: 960, height: 720, warnings: [] });
  await assert.rejects(invalid, /结果无效/);
  assert.equal(verified, 0); assert.deepEqual(bad.counts(), [1, 1]);
});
test('normal PPTX and PPT keep slide order and image bytes through safe output', async () => {
  require('../shared/formats.js');
  const fs = require('node:fs'), { createPresentationWorkerHandler } = await load('worker'), { sanitizePresentationSlide } = await load('sanitize');
  for (const format of ['pptx', 'ppt']) {
    const messages = [], h = createPresentationWorkerHandler(m => messages.push(m));
    const bytes = fs.readFileSync(path.join(__dirname, `fixtures/presentation/normal.${format}`));
    await h({ data: { type: 'open', id: 'fixture', format, bytes } });
    assert.equal(messages[0].type, 'ready', messages[0].message);
    assert.equal(messages[0].slideCount, 3);
    for (const [page, phrase] of [[0, '第一张幻灯片'], [1, '第二张幻灯片'], [2, '基本表格']]) {
      await h({ data: { type: 'render', id: `fixture-${page}`, page } });
      const output = await sanitizePresentationSlide(messages.at(-1), messages[0]);
      assert.match(output.srcdoc, new RegExp(phrase));
      if (page === 1) assert.match(output.srcdoc, /data:image\/png;base64,/);
      if (page === 2) for (const label of ['Format', 'Mode', 'PPTX', 'Local']) assert.match(output.srcdoc, new RegExp(label));
      assert.doesNotMatch(output.srcdoc, /blob:|foreignObject|@font-face/);
    }
    h.dispose();
  }
});
test('CFB preflight rejects forged sector sizes, oversized streams and cycles before parse', async () => {
  const fs = require('node:fs'), { verifyPresentationPackage } = await load('package');
  const normal = fs.readFileSync(path.join(__dirname, 'fixtures/presentation/normal.ppt'));
  const mutate = fn => { const b = Buffer.from(normal); fn(b); return b; };
  assert.throws(() => verifyPresentationPackage(mutate(b => b.writeUInt16LE(30, 30)), 'ppt'), /扇区/);
  assert.throws(() => verifyPresentationPackage(mutate(b => b.writeUInt32LE(1000000, 44)), 'ppt'), /FAT/);
  const dirSector = normal.readUInt32LE(48), fatSector = normal.readUInt32LE(76);
  assert.throws(() => verifyPresentationPackage(mutate(b => b.writeUInt32LE(dirSector, (fatSector + 1) * 512 + dirSector * 4)), 'ppt'), /循环/);
  assert.throws(() => verifyPresentationPackage(mutate(b => b.writeUInt32LE(0x7fffffff, (dirSector + 1) * 512 + 120)), 'ppt'), /大小/);
});
test('runtime parse timeout terminates worker and never marks the file verified', async t => {
  const { createPresentationSession } = await load('runtime');
  const bytes = await pptx(), fake = fakeWorker();
  let verified = 0;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const opening = createPresentationSession(bytes, 'pptx', '', { makeWorker: fake.makeWorker, onVerified: () => verified++ });
  const rejected = assert.rejects(opening, /超时（30 秒）/);
  t.mock.timers.tick(30000);
  await rejected;
  assert.deepEqual(fake.counts(), [1, 1]); assert.equal(verified, 0);
});
test('sanitizer rejects DTD and oversized canvases; raster pixels are bounded per displayed reference', async () => {
  require('../shared/formats.js');
  const { sanitizePresentationSlide, validatePresentationImage } = await load('sanitize');
  const { unzipSync } = await import('fflate');
  const fs = require('node:fs');
  const base = { page: 0, assets: [], warnings: [], svg: '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>' };
  await assert.rejects(sanitizePresentationSlide(base, { width: 960, height: 720 }), /实体/);
  await assert.rejects(sanitizePresentationSlide({ ...base, svg: '<svg/>' }, { width: Infinity, height: 720 }), /尺寸/);
  const bytes = unzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/presentation/normal.pptx')))['ppt/media/image-2-1.png'];
  const large = Uint8Array.from(bytes), view = new DataView(large.buffer);
  view.setUint32(16, 100000); view.setUint32(20, 100000);
  assert.throws(() => validatePresentationImage({ mime: 'image/png', bytes: large }), /尺寸/);
  view.setUint32(16, 8000); view.setUint32(20, 4000);
  const output = { page: 0, assets: [{ id: 'presentation-image-1', mime: 'image/png', bytes: large }], warnings: [], svg: '<svg xmlns="http://www.w3.org/2000/svg"><image href="presentation-image-1"/><image href="presentation-image-1"/></svg>' };
  await assert.rejects(sanitizePresentationSlide(output, { width: 960, height: 720 }), /超过预览限制/);
});
test('one page deadline covers rendering plus iframe load together', async t => {
  const { createPresentationReader } = await load('reader');
  const dom = fakeReaderDom(), fake = fakeWorker(), bytes = await pptx();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const opening = createPresentationReader({ host: dom.host, bytes, format: 'pptx', makeWorker: fake.makeWorker });
  const rejected = assert.rejects(opening, /超时/);
  fake.reply({ id: fake.sent[0].id, type: 'ready', format: 'pptx', slideCount: 1, width: 960, height: 720, warnings: [] });
  await tick();
  t.mock.timers.tick(20000);
  fake.reply({ id: fake.sent[1].id, type: 'slide', page: 0, svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>第一页</text></svg>', assets: [], warnings: [] });
  await tick();
  assert.ok(dom.find('iframe'));
  t.mock.timers.tick(10000);
  await tick();
  const atDeadline = fake.counts();
  // Ensure a failing pre-fix implementation still settles and cleans up.
  t.mock.timers.tick(30000);
  await rejected;
  assert.deepEqual(atDeadline, [1, 1], 'Worker must be stopped by the single 30-second page deadline');
});
test('XML identified by content type or relationship is checked before parsing regardless of suffix', async () => {
  const fs = require('node:fs'), { unzipSync, zipSync } = await import('fflate');
  const { verifyPresentationPackage } = await load('package');
  const files = unzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/presentation/normal.pptx')));
  const original = new TextDecoder().decode(files['ppt/theme/theme1.xml']);
  const rename = (malicious, opaque) => {
    const modified = { ...files }; delete modified['ppt/theme/theme1.xml'];
    modified['ppt/theme/theme1.bin'] = enc(malicious ? '<!DOCTYPE theme>' + original.replace(/^<\?xml[^>]*>\s*/, '') : original);
    for (const name of Object.keys(modified).filter(n => n.endsWith('.rels') || n === '[Content_Types].xml')) {
      let xml = new TextDecoder().decode(modified[name]).replaceAll('theme1.xml', 'theme1.bin');
      if (opaque && name === '[Content_Types].xml') xml = xml.replaceAll('application/vnd.openxmlformats-officedocument.theme+xml', 'application/octet-stream');
      modified[name] = enc(xml);
    }
    return zipSync(modified, { level: 6 });
  };
  for (const opaque of [false, true]) assert.throws(() => verifyPresentationPackage(rename(true, opaque), 'pptx'), /XML/);
  assert.equal(verifyPresentationPackage(rename(false, true), 'pptx').slideCount, 3);
  const forged = rename(false, true), dv = new DataView(forged.buffer), end = forged.length - 22;
  for (let at = dv.getUint32(end + 16, true); at < end;) {
    const length = dv.getUint16(at + 28, true), name = new TextDecoder().decode(forged.subarray(at + 46, at + 46 + length));
    if (name === 'ppt/theme/theme1.bin') {
      dv.setUint32(at + 24, 8 * 1024 * 1024 + 1, true);
      dv.setUint32(dv.getUint32(at + 42, true) + 22, 8 * 1024 * 1024 + 1, true);
    }
    at += 46 + length + dv.getUint16(at + 30, true) + dv.getUint16(at + 32, true);
  }
  assert.throws(() => verifyPresentationPackage(forged, 'pptx'), /声明 XML 大小超过限制（8 MiB）/);
});
test('external relationship targets cannot alias local ZIP parts consumed by the engine', async () => {
  const fs = require('node:fs'), { unzipSync, zipSync } = await import('fflate');
  const { verifyPresentationPackage } = await load('package');
  const files = unzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/presentation/normal.pptx')));
  const theme = new TextDecoder().decode(files['ppt/theme/theme1.xml']);
  delete files['ppt/theme/theme1.xml'];
  files['ppt/theme/theme1.bin'] = enc('<!DOCTYPE theme>' + theme.replace(/^<\?xml[^>]*>\s*/, ''));
  for (const name of Object.keys(files).filter(name => name.endsWith('.rels') || name === '[Content_Types].xml')) {
    let xml = new TextDecoder().decode(files[name]);
    if (name === '[Content_Types].xml') xml = xml.replaceAll('theme1.xml', 'theme1.bin').replaceAll('application/vnd.openxmlformats-officedocument.theme+xml', 'application/octet-stream');
    else xml = xml.replace(/Target="[^"]*theme1\.xml"/g, 'Target="ppt/theme/theme1.bin" TargetMode="External"');
    files[name] = enc(xml);
  }
  assert.throws(() => verifyPresentationPackage(zipSync(files, { level: 6 }), 'pptx'), /外部关系.*包内部件/);
});
