const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const file = path.join(__dirname, '../shared/docx-policy.mjs');
const api = async () => fs.existsSync(file) ? import(pathToFileURL(file).href) : {};
const zipHeader = () => Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
const transferApi = async () => {
  const m = await api();
  assert.equal(typeof m.checkDocxTransfer, 'function', 'checkDocxTransfer export must exist');
  return m;
};

test('DOCX policy is exported, immutable and matches approved byte budgets', async () => {
  const m = await api();
  assert.ok(m.DOCX_LIMITS, 'DOCX_LIMITS export must exist');
  assert.ok(Object.isFrozen(m.DOCX_LIMITS));
  assert.equal(m.DOCX_LIMITS.fileBytes, 20 * 1024 * 1024);
  assert.equal(m.DOCX_LIMITS.expandedBytes, 60 * 1024 * 1024);
  assert.equal(m.DOCX_LIMITS.timeoutMs, 20000);
});

test('DOCX policy exports the exact MIME', async () => {
  const m = await api();
  assert.equal(m.DOCX_MIME, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
});

test('DOCX policy exports every approved limit without extra budgets', async () => {
  const m = await api();
  assert.deepEqual(m.DOCX_LIMITS, {
    fileBytes: 20 * 1024 * 1024,
    entries: 1000,
    entryBytes: 20 * 1024 * 1024,
    expandedBytes: 60 * 1024 * 1024,
    xmlBytes: 4 * 1024 * 1024,
    htmlBytes: 4 * 1024 * 1024,
    nodes: 50000,
    images: 200,
    imagePixels: 40000000,
    timeoutMs: 20000,
  });
});

test('transfer check returns the same Uint8Array without modifying or detaching its buffer', async () => {
  const m = await transferApi();
  const original = Uint8Array.from([9, 0x50, 0x4b, 3, 4, 8]);
  const input = original.subarray(1, 5);
  const before = [...original];
  const result = m.checkDocxTransfer(input);
  assert.equal(result, input);
  assert.equal(result.buffer, original.buffer);
  assert.equal(result.byteOffset, 1);
  assert.equal(result.byteLength, 4);
  assert.deepEqual([...original], before);
  assert.equal(original.buffer.byteLength, 6);
});

test('transfer check views an ArrayBuffer without copying or detaching it', async () => {
  const m = await transferApi();
  const input = zipHeader().buffer;
  const result = m.checkDocxTransfer(input);
  assert.ok(result instanceof Uint8Array);
  assert.equal(result.buffer, input);
  assert.equal(result.byteOffset, 0);
  assert.equal(result.byteLength, 4);
  assert.equal(input.byteLength, 4);
  assert.deepEqual([...new Uint8Array(input)], [0x50, 0x4b, 3, 4]);
});

test('transfer check preserves offsets and byte lengths for every ArrayBuffer view', async () => {
  const m = await transferApi();
  const constructors = [
    Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
    Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array,
  ];
  if (typeof Float16Array === 'function') constructors.push(Float16Array);
  const makeViews = [
    buffer => new DataView(buffer, 8, 8),
    buffer => Buffer.from(buffer, 8, 8),
    ...constructors.map(Type => buffer => new Type(buffer, 8, 8 / Type.BYTES_PER_ELEMENT)),
  ];
  for (const makeView of makeViews) {
    const buffer = new ArrayBuffer(24);
    const allBytes = new Uint8Array(buffer);
    allBytes.fill(9);
    allBytes.set([0x50, 0x4b, 3, 4, 1, 2, 3, 4], 8);
    const before = [...allBytes];
    const view = makeView(buffer);
    const result = m.checkDocxTransfer(view, 'application/octet-stream');
    assert.ok(result instanceof Uint8Array);
    assert.equal(result.buffer, buffer);
    assert.equal(result.byteOffset, 8);
    assert.equal(result.byteLength, 8);
    assert.deepEqual([...result], [0x50, 0x4b, 3, 4, 1, 2, 3, 4]);
    assert.deepEqual([...allBytes], before);
    assert.equal(buffer.byteLength, 24);
    assert.equal(view.byteLength, 8);
    if (view instanceof Uint8Array) assert.equal(result, view);
  }
});

test('transfer check rejects non-buffer inputs including objects that imitate byte views', async () => {
  const m = await transferApi();
  const invalid = [
    undefined, null, true, 42, 1n, Symbol('bytes'), () => zipHeader(), 'PK\u0003\u0004', [], {},
    { buffer: zipHeader().buffer, byteOffset: 0, byteLength: 4 }, new Set([0x50, 0x4b, 3, 4]),
  ];
  if (typeof SharedArrayBuffer === 'function') invalid.push(new SharedArrayBuffer(4));
  for (const input of invalid) assert.throws(() => m.checkDocxTransfer(input), /数据无效/);
});

test('transfer check accepts empty, official and octet-stream MIME with normalized case and parameters', async () => {
  const m = await transferApi();
  const input = zipHeader();
  for (const mime of [
    '', '   ', '; charset=utf-8', m.DOCX_MIME,
    ` ${m.DOCX_MIME.toUpperCase()} ; charset=UTF-8`,
    'application/octet-stream', ' APPLICATION/OCTET-STREAM ; charset=utf-8',
  ]) assert.equal(m.checkDocxTransfer(input, mime), input);
});

test('transfer check identifies HTML and XHTML responses as possible login pages', async () => {
  const m = await transferApi();
  for (const mime of [
    'text/html', ' TEXT/HTML; charset=UTF-8',
    'application/xhtml+xml', ' APPLICATION/XHTML+XML ; charset=utf-8',
  ]) assert.throws(() => m.checkDocxTransfer(zipHeader(), mime), /网页.*重新登录/);
});

test('transfer check rejects every other MIME even when the ZIP signature matches', async () => {
  const m = await transferApi();
  for (const mime of [
    'application/zip', 'application/pdf', 'text/plain', 'image/png', 'application/msword',
    'application/vnd.ms-word.document.macroEnabled.12',
  ]) assert.throws(() => m.checkDocxTransfer(zipHeader(), mime), /类型.*DOCX/);
});

test('transfer check accepts exactly 20 MiB and rejects one byte over the file budget', async () => {
  const m = await transferApi();
  const input = new Uint8Array(20 * 1024 * 1024);
  input.set(zipHeader());
  assert.equal(m.checkDocxTransfer(input), input);
  assert.equal(input.buffer.byteLength, 20 * 1024 * 1024);
  const oversized = new Uint8Array(input.byteLength + 1);
  oversized.set(zipHeader());
  assert.throws(() => m.checkDocxTransfer(oversized), /大小.*20 MiB/);
  assert.equal(oversized.buffer.byteLength, 20 * 1024 * 1024 + 1);
  oversized.set(zipHeader(), 1);
  const view = new DataView(oversized.buffer, 1, input.byteLength);
  const result = m.checkDocxTransfer(view);
  assert.equal(result.buffer, oversized.buffer);
  assert.equal(result.byteOffset, 1);
  assert.equal(result.byteLength, input.byteLength);
});

test('transfer check rejects empty, truncated and incorrect ZIP local-file signatures', async () => {
  const m = await transferApi();
  for (const input of [
    [], [0x50], [0x50, 0x4b], [0x50, 0x4b, 3], [0, 0, 0, 0],
    [0x50, 0x4b, 5, 6], [0x50, 0x4b, 7, 8], [0x50, 0x4b, 3, 5],
  ]) assert.throws(() => m.checkDocxTransfer(Uint8Array.from(input)), /DOCX 容器.*损坏/);
});

test('transfer check reports complete OLE signatures as unsupported encrypted or old Word files', async () => {
  const m = await transferApi();
  const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  for (const input of [signature, [...signature, 0, 0, 0, 0]]) {
    assert.throws(() => m.checkDocxTransfer(Uint8Array.from(input)), /加密 Office.*旧版 Word.*不支持/);
  }
  assert.throws(() => m.checkDocxTransfer(Uint8Array.from(signature.slice(0, 7))), /DOCX 容器.*损坏/);
});

test('an ordinary ZIP passes only the transport gate and still requires full DOCX package verification', async () => {
  const m = await transferApi();
  const { zipSync } = await import('fflate');
  // A real ZIP with a text file still has no DOCX content types or Word body.
  const ordinaryZip = zipSync({ 'notes.txt': Buffer.from('ordinary ZIP, not Word') }, { level: 0 });
  assert.equal(m.checkDocxTransfer(ordinaryZip), ordinaryZip);
});

test('the policy imports and checks bytes without DOM, network or filesystem access', async () => {
  await transferApi();
  const source = fs.readFileSync(file, 'utf8');
  const script = `
    import assert from 'node:assert/strict';
    import vm from 'node:vm';
    const context = vm.createContext({});
    const module = new vm.SourceTextModule(${JSON.stringify(source)}, { context });
    await module.link(() => { throw new Error('Policy must not load filesystem or network dependencies.'); });
    const before = Reflect.ownKeys(context);
    await module.evaluate();
    assert.deepEqual(Reflect.ownKeys(context), before);
    const input = vm.runInContext('new Uint8Array([0x50, 0x4b, 3, 4])', context);
    assert.equal(module.namespace.checkDocxTransfer(input), input);
  `;
  const result = spawnSync(process.execPath, [
    '--experimental-vm-modules', '--no-warnings', '--input-type=module', '--eval', script,
  ], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});
