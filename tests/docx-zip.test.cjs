const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { inflateRawSync } = require('node:zlib');

const file = path.join(__dirname, '../shared/docx-zip.mjs');
const api = async () => {
  const m = fs.existsSync(file) ? await import(pathToFileURL(file).href) : {};
  assert.equal(typeof m.scanDocxZip, 'function', 'scanDocxZip export must exist');
  assert.equal(typeof m.expandDocxZip, 'function', 'expandDocxZip export must exist');
  return m;
};
const codec = () => import('fflate');
const u16 = (bytes, offset) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
const u32 = (bytes, offset) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
const set16 = (bytes, offset, value) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(offset, value, true);
const set32 = (bytes, offset, value) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true);
const layout = bytes => {
  let end = bytes.length - 22;
  while (end >= 0 && u32(bytes, end) !== 0x06054b50) end--;
  const central = u32(bytes, end + 16);
  const entries = [];
  for (let p = central; p < end;) {
    const nameLength = u16(bytes, p + 28);
    const local = u32(bytes, p + 42);
    const data = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    entries.push({ central: p, local, data, dataEnd: data + u32(bytes, p + 20), nameLength });
    p += 46 + nameLength + u16(bytes, p + 30) + u16(bytes, p + 32);
  }
  return { end, central, entries };
};
const zip = async (files, level = 6, options = {}) => (await codec()).zipSync(files, { level, ...options });
const rejectBoth = (m, input, pattern = /ZIP|DOCX 容器/) => {
  assert.throws(() => m.scanDocxZip(input), pattern);
  assert.throws(() => m.expandDocxZip(input), pattern);
};
const alter = (bytes, mutate) => { const copy = bytes.slice(); mutate(copy, layout(copy)); return copy; };
const rename = (bytes, entry, name) => {
  const encoded = Buffer.from(name);
  assert.equal(encoded.length, entry.nameLength);
  bytes.set(encoded, entry.local + 30);
  bytes.set(encoded, entry.central + 46);
};
const streamZip = async (files, deflate = true) => {
  const { Zip, ZipPassThrough, ZipDeflate } = await codec();
  const chunks = [];
  const archive = new Zip((error, chunk) => { if (error) throw error; chunks.push(chunk); });
  for (const [name, data] of Object.entries(files)) {
    const entry = deflate ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name);
    archive.add(entry);
    entry.push(data.subarray(0, 2), false);
    entry.push(data.subarray(2), true);
  }
  archive.end();
  return new Uint8Array(Buffer.concat(chunks));
};
const rawCompressedZip = async compressed => {
  const { Zip, ZipPassThrough, inflateSync } = await codec();
  // Reconstruct consistent ZIP metadata for the permissive codec's output;
  // the malformed raw stream must be rejected by the expansion gate itself.
  const content = inflateSync(compressed);
  const chunks = [];
  const archive = new Zip((error, chunk) => { if (error) throw error; chunks.push(chunk); });
  const entry = new ZipPassThrough('part.bin');
  entry.compression = 8;
  entry.process = (_chunk, final) => entry.ondata(null, compressed, final);
  archive.add(entry);
  entry.push(content, true);
  archive.end();
  return new Uint8Array(Buffer.concat(chunks));
};
const MiB = 1024 * 1024;
const forgeSize = (bytes, index, size) => alter(bytes, (b, { entries }) => {
  set32(b, entries[index].local + 22, size);
  set32(b, entries[index].central + 24, size);
});
const replaceCompressed = (original, data) => {
  const { end, central, entries: [e] } = layout(original);
  const delta = data.length - (e.dataEnd - e.data);
  const bytes = new Uint8Array(Buffer.concat([original.subarray(0, e.data), data, original.subarray(e.dataEnd)]));
  set32(bytes, e.local + 18, data.length);
  set32(bytes, e.central + delta + 20, data.length);
  set32(bytes, end + delta + 16, central + delta);
  return bytes;
};
const referenceCrc32 = bytes => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
};
const crcPayload = target => {
  const zero = new Uint8Array(4);
  const base = referenceCrc32(zero);
  const basis = [];
  for (let inputBit = 0; inputBit < 32; inputBit++) {
    const data = zero.slice();
    data[inputBit >>> 3] = 1 << (inputBit & 7);
    let value = (referenceCrc32(data) ^ base) >>> 0;
    let mask = (1 << inputBit) >>> 0;
    for (let outputBit = 31; outputBit >= 0; outputBit--) {
      if (!(value >>> outputBit & 1)) continue;
      if (basis[outputBit]) { value = (value ^ basis[outputBit].value) >>> 0; mask = (mask ^ basis[outputBit].mask) >>> 0; }
      else { basis[outputBit] = { value, mask }; break; }
    }
  }
  let remaining = (target ^ base) >>> 0;
  let solution = 0;
  for (let bit = 31; bit >= 0; bit--) {
    if (!(remaining >>> bit & 1)) continue;
    remaining = (remaining ^ basis[bit].value) >>> 0;
    solution = (solution ^ basis[bit].mask) >>> 0;
  }
  const output = new Uint8Array(4);
  set32(output, 0, solution);
  assert.equal(referenceCrc32(output), target);
  return output;
};
const unicodePathExtra = (name, alternate = name) => {
  const payload = new Uint8Array(5 + Buffer.byteLength(alternate));
  payload[0] = 1;
  set32(payload, 1, referenceCrc32(Buffer.from(name)));
  payload.set(Buffer.from(alternate), 5);
  return payload;
};

test('ZIP APIs enforce the transport gate before parsing archive data', async () => {
  const m = await api();
  for (const input of [null, {}, [], 'PK']) rejectBoth(m, input, /数据无效/);
  rejectBoth(m, Uint8Array.of(0x50, 0x4b, 3, 4), /ZIP/);
  const over = new Uint8Array(20 * 1024 * 1024 + 1);
  rejectBoth(m, over, /大小.*20 MiB/);
});

test('real STORE and DEFLATE ZIPs scan into bounded descriptors and expand exact bytes', async () => {
  const m = await api();
  for (const level of [0, 6]) {
    const content = { 'word/document.xml': Buffer.from('<document>Hello</document>'), 'media/item.bin': Uint8Array.of(0, 255, 4) };
    const bytes = await zip(content, level);
    const descriptors = m.scanDocxZip(bytes);
    assert.equal(descriptors.length, 2);
    const first = descriptors[0];
    assert.equal(first.name, 'word/document.xml');
    assert.equal(first.directory, false);
    assert.equal(first.method, level === 0 ? 0 : 8);
    assert.equal(first.uncompressedSize, content[first.name].length);
    assert.ok(Number.isInteger(first.crc32));
    assert.equal(first.localOffset, 0);
    assert.ok(first.dataOffset > first.localOffset);
    assert.equal(first.dataEnd - first.dataOffset, first.compressedSize);
    assert.equal(first.recordEnd, first.dataEnd);
    assert.ok(Object.isFrozen(first));
    assert.ok(Object.isFrozen(descriptors));
    const expanded = m.expandDocxZip(bytes);
    assert.ok(expanded instanceof Map);
    assert.deepEqual([...expanded.keys()], Object.keys(content));
    for (const [name, expected] of Object.entries(content)) assert.deepEqual(expanded.get(name), new Uint8Array(expected));
  }
});

test('directories and strict UTF8 relative paths are accepted without changing input views', async () => {
  const m = await api();
  const bytes = await zip({ 'word/': new Uint8Array(), 'word/中文.xml': Buffer.from('你好'), 'empty.bin': new Uint8Array() });
  const backing = new Uint8Array(bytes.length + 16).fill(99);
  backing.set(bytes, 8);
  const before = backing.slice();
  for (const input of [backing.subarray(8, 8 + bytes.length), new DataView(backing.buffer, 8, bytes.length), bytes.buffer]) {
    const scanned = m.scanDocxZip(input);
    assert.equal(scanned[0].directory, true);
    assert.equal(scanned[1].name, 'word/中文.xml');
    assert.deepEqual(m.expandDocxZip(input).get('word/中文.xml'), new Uint8Array(Buffer.from('你好')));
    assert.equal(m.expandDocxZip(input).get('word/').length, 0);
  }
  assert.deepEqual(backing, before);
});

test('normal EOCD comments are accepted and ordinary ZIPs still are not DOCX proof', async () => {
  const m = await api();
  const original = await zip({ 'notes.txt': Buffer.from('ordinary ZIP') }, 0);
  for (const commentSize of [1, 65535]) {
    const bytes = new Uint8Array(original.length + commentSize);
    bytes.set(original);
    bytes.fill(65, original.length);
    set16(bytes, original.length - 2, commentSize);
    assert.equal(m.scanDocxZip(bytes)[0].name, 'notes.txt');
    assert.equal(Buffer.from(m.expandDocxZip(bytes).get('notes.txt')).toString(), 'ordinary ZIP');
  }
});

test('signed streaming data descriptors support STORE and DEFLATE and local zero or actual fields', async () => {
  const m = await api();
  const content = Buffer.from('streaming descriptor content');
  for (const deflate of [false, true]) {
    const original = await streamZip({ 'word/document.xml': content }, deflate);
    for (const actualLocal of [false, true]) {
      const bytes = alter(original, (b, { entries: [e] }) => {
        if (actualLocal) {
          set32(b, e.local + 14, u32(b, e.central + 16));
          set32(b, e.local + 18, u32(b, e.central + 20));
          set32(b, e.local + 22, u32(b, e.central + 24));
        }
      });
      const descriptor = m.scanDocxZip(bytes)[0];
      assert.equal(descriptor.flags & 8, 8);
      assert.equal(descriptor.recordEnd, descriptor.dataEnd + 16);
      assert.equal(u32(bytes, descriptor.dataEnd), 0x08074b50);
      assert.deepEqual(m.expandDocxZip(bytes).get('word/document.xml'), new Uint8Array(content));
    }
  }
});

test('standard unsigned data descriptors are accepted with their exact bounded range', async () => {
  const m = await api();
  for (const deflate of [false, true]) {
    const original = await streamZip({ 'part.bin': Buffer.from('unsigned descriptor') }, deflate);
    const { entries: [e] } = layout(original);
    assert.equal(u32(original, e.dataEnd), 0x08074b50);
    const bytes = new Uint8Array(Buffer.concat([original.subarray(0, e.dataEnd), original.subarray(e.dataEnd + 4)]));
    const metadata = layout(original);
    set32(bytes, metadata.end - 4 + 16, metadata.central - 4);
    const descriptor = m.scanDocxZip(bytes)[0];
    assert.equal(descriptor.recordEnd, descriptor.dataEnd + 12);
    assert.equal(Buffer.from(m.expandDocxZip(bytes).get('part.bin')).toString(), 'unsigned descriptor');
  }
});

test('EOCD disk, count, size, offset and ZIP64 sentinel fields must agree exactly', async () => {
  const m = await api();
  const original = await zip({ 'a.bin': Buffer.from('a'), 'b.bin': Buffer.from('b') });
  const mutations = [
    (b, l) => set16(b, l.end + 4, 1),
    (b, l) => set16(b, l.end + 6, 1),
    (b, l) => set16(b, l.end + 8, 1),
    (b, l) => set16(b, l.end + 10, 1),
    (b, l) => set16(b, l.end + 8, 0xffff),
    (b, l) => set16(b, l.end + 10, 0xffff),
    (b, l) => set32(b, l.end + 12, 0xffffffff),
    (b, l) => set32(b, l.end + 16, 0xffffffff),
    (b, l) => set32(b, l.end + 12, u32(b, l.end + 12) - 1),
    (b, l) => set32(b, l.end + 16, l.central + 1),
    (b, l) => set16(b, l.end + 20, 1),
  ];
  for (const mutate of mutations) rejectBoth(m, alter(original, mutate));
});

test('central and local signatures, names, flags, methods, CRC and sizes must match', async () => {
  const m = await api();
  const original = await zip({ 'a.bin': Buffer.from('agreement') });
  const mutations = [
    (b, { entries: [e] }) => set32(b, e.central, 0x04034b50),
    (b, { entries: [e] }) => set32(b, e.local, 0x02014b50),
    (b, { entries: [e] }) => { b[e.local + 30] ^= 1; },
    (b, { entries: [e] }) => set16(b, e.local + 6, u16(b, e.local + 6) ^ 0x800),
    (b, { entries: [e] }) => set16(b, e.local + 8, 0),
    (b, { entries: [e] }) => set32(b, e.local + 14, u32(b, e.local + 14) ^ 1),
    (b, { entries: [e] }) => set32(b, e.local + 18, u32(b, e.local + 18) - 1),
    (b, { entries: [e] }) => set32(b, e.local + 22, u32(b, e.local + 22) - 1),
    (b, { entries: [e] }) => set16(b, e.central + 28, e.nameLength + 1),
    (b, { entries: [e] }) => set16(b, e.local + 26, e.nameLength + 1),
  ];
  for (const mutate of mutations) rejectBoth(m, alter(original, mutate));
});

test('encryption, unsupported flags/methods, entry disks and every ZIP64 source are rejected', async () => {
  const m = await api();
  const original = await zip({ 'a.bin': Buffer.from('supported') });
  for (const flags of [1, 0x10, 0x20, 0x40, 0x100, 0x2000, 0x8000]) {
    rejectBoth(m, alter(original, (b, { entries: [e] }) => {
      set16(b, e.local + 6, flags); set16(b, e.central + 8, flags);
    }));
  }
  for (const method of [9, 12, 99]) rejectBoth(m, alter(original, (b, { entries: [e] }) => {
    set16(b, e.local + 8, method); set16(b, e.central + 10, method);
  }));
  for (const mutate of [
    (b, { entries: [e] }) => set16(b, e.central + 34, 1),
    (b, { entries: [e] }) => set16(b, e.central + 34, 0xffff),
    (b, { entries: [e] }) => set32(b, e.central + 20, 0xffffffff),
    (b, { entries: [e] }) => set32(b, e.central + 24, 0xffffffff),
    (b, { entries: [e] }) => set32(b, e.central + 42, 0xffffffff),
    (b, { entries: [e] }) => set32(b, e.local + 18, 0xffffffff),
    (b, { entries: [e] }) => set32(b, e.local + 22, 0xffffffff),
    (b, { entries: [e] }) => set16(b, e.local + 4, 45),
    (b, { entries: [e] }) => set16(b, e.central + 6, 45),
  ]) rejectBoth(m, alter(original, mutate));
  rejectBoth(m, await zip({ 'a.bin': [Buffer.from('extra'), { extra: { 1: new Uint8Array(8) } }] }));
  const stored = await zip({ 'a.bin': Buffer.from('store') }, 0);
  rejectBoth(m, alter(stored, (b, { entries: [e] }) => {
    set16(b, e.local + 6, 2); set16(b, e.central + 8, 2);
  }));
});

test('descriptor CRC/sizes, mixed local placeholders and missing or truncated descriptors are rejected', async () => {
  const m = await api();
  const original = await streamZip({ 'a.bin': Buffer.from('descriptor checks') });
  for (const delta of [4, 8, 12]) rejectBoth(m, alter(original, (b, { entries: [e] }) => {
    set32(b, e.dataEnd + delta, u32(b, e.dataEnd + delta) ^ 1);
  }));
  rejectBoth(m, alter(original, (b, { entries: [e] }) => {
    set32(b, e.local + 18, u32(b, e.central + 20));
  }));
  rejectBoth(m, alter(original, (b, { entries: [e] }) => set32(b, e.dataEnd, 0)));
  const { end, central, entries: [e] } = layout(original);
  const missing = new Uint8Array(Buffer.concat([original.subarray(0, e.dataEnd), original.subarray(central)]));
  set32(missing, end - 16 + 16, central - 16);
  rejectBoth(m, missing);
  for (const cut of [1, 2, 8, 20]) rejectBoth(m, original.subarray(0, original.length - cut));
});

test('unsafe absolute, URI, encoded traversal, control and noncanonical paths are rejected', async () => {
  const m = await api();
  const names = [
    '', '/', '/word/a.xml', 'C:/word/a.xml', 'https:word/a.xml', 'word\\a.xml',
    'word//a.xml', './a.xml', '../a.xml', 'word/./a.xml', 'word/../a.xml',
    'word/a\u0000.xml', 'word/a\u001f.xml', 'word/a\u007f.xml', 'word/a\u0085.xml',
    '%2e%2e/a.xml', 'word/%2e/a.xml', 'word%2fa.xml', 'word%5ca.xml',
    'word/%252e%252e/a.xml', 'word/a%00.xml', '%43%3a/a.xml', 'word/a%3a.xml',
  ];
  for (const name of names) rejectBoth(m, await zip({ [name]: Buffer.from('path') }, 0));
  const original = await zip({ 'a.bin': Buffer.from('name') }, 0);
  rejectBoth(m, alter(original, (b, { entries: [e] }) => {
    b[e.local + 30] = 0xff; b[e.central + 46] = 0xff;
  }));
});

test('duplicate names, file/directory aliases and file ancestors are rejected in either order', async () => {
  const m = await api();
  const original = await zip({ 'a.bin': Buffer.from('a'), 'b.bin': Buffer.from('b') });
  rejectBoth(m, alter(original, (b, { entries }) => rename(b, entries[1], 'a.bin')));
  for (const files of [
    { word: Buffer.from('file'), 'word/': new Uint8Array() },
    { 'word/': new Uint8Array(), word: Buffer.from('file') },
    { word: Buffer.from('file'), 'word/a.xml': Buffer.from('child') },
    { 'word/a.xml': Buffer.from('child'), word: Buffer.from('file') },
  ]) rejectBoth(m, await zip(files));
  rejectBoth(m, await zip({ 'word/': Buffer.from('directory with bytes') }));
});

test('overlapping records, central-directory data and unreferenced unknown ranges are rejected', async () => {
  const m = await api();
  const original = await zip({ 'a.bin': Buffer.from('a'), 'b.bin': Buffer.from('b') }, 0);
  for (const mutate of [
    (b, { entries }) => set32(b, entries[1].central + 42, entries[0].local),
    (b, { entries }) => { set32(b, entries[0].central + 20, 40); set32(b, entries[0].local + 18, 40); },
    (b, { entries, central }) => { set32(b, entries[1].central + 20, central); set32(b, entries[1].local + 18, central); },
    (b, { entries }) => set16(b, entries[0].local + 28, 0xffff),
    (b, { entries }) => set16(b, entries[0].central + 30, 0xffff),
    (b, { entries }) => set16(b, entries[0].central + 32, 0xffff),
  ]) rejectBoth(m, alter(original, mutate));
  const one = await zip({ 'a.bin': Buffer.from('a') }, 0);
  const { central, end } = layout(one);
  const gap = new Uint8Array(Buffer.concat([one.subarray(0, central), Uint8Array.of(0), one.subarray(central)]));
  set32(gap, end + 1 + 16, central + 1);
  rejectBoth(m, gap);
  const trailing = new Uint8Array(Buffer.concat([one, Uint8Array.of(0)]));
  rejectBoth(m, trailing);
  const centralGap = new Uint8Array(Buffer.concat([one.subarray(0, end), Uint8Array.of(0), one.subarray(end)]));
  rejectBoth(m, centralGap);
});

test('entry count accepts exactly 1000 entries and rejects the 1001st', async () => {
  const m = await api();
  const files = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`part${i}.bin`, Uint8Array.of(i & 255)]));
  const exact = await zip(files, 0);
  assert.equal(m.scanDocxZip(exact).length, 1000);
  assert.equal(m.expandDocxZip(exact).size, 1000);
  files['part1000.bin'] = new Uint8Array();
  rejectBoth(m, await zip(files, 0), /1000/);
});

test('XML and relationship parts accept exactly 4 MiB and reject one extra byte', async () => {
  const m = await api();
  for (const name of ['word/document.xml', '_rels/.rels', 'part.XML', 'part%2exml']) {
    const exact = await zip({ [name]: new Uint8Array(4 * MiB) });
    assert.equal(m.scanDocxZip(exact)[0].uncompressedSize, 4 * MiB);
    assert.equal(m.expandDocxZip(exact).get(name).length, 4 * MiB);
    rejectBoth(m, await zip({ [name]: new Uint8Array(4 * MiB + 1) }), /4 MiB/);
  }
});

test('individual binary entries accept exactly 20 MiB and reject one extra byte', async () => {
  const m = await api();
  const exact = await zip({ 'media.bin': new Uint8Array(20 * MiB) });
  assert.equal(m.scanDocxZip(exact)[0].uncompressedSize, 20 * MiB);
  assert.equal(m.expandDocxZip(exact).get('media.bin').length, 20 * MiB);
  rejectBoth(m, await zip({ 'media.bin': new Uint8Array(20 * MiB + 1) }), /20 MiB/);
});

test('total expansion accepts exactly 60 MiB and rejects one extra declared byte', async () => {
  const m = await api();
  const files = { 'one.bin': new Uint8Array(20 * MiB), 'two.bin': new Uint8Array(20 * MiB), 'three.bin': new Uint8Array(20 * MiB) };
  const exact = await zip(files);
  assert.equal(m.scanDocxZip(exact).reduce((sum, e) => sum + e.uncompressedSize, 0), 60 * MiB);
  assert.equal([...m.expandDocxZip(exact).values()].reduce((sum, b) => sum + b.length, 0), 60 * MiB);
  files['four.bin'] = Uint8Array.of(1);
  rejectBoth(m, await zip(files), /60 MiB/);
});

test('high ratio bombs with forged matching small headers hit actual XML and per-entry counters', async () => {
  const m = await api();
  for (const [name, actual, pattern] of [
    ['word/document.xml', 4 * MiB + 1, /实际.*4 MiB/],
    ['_rels/.rels', 4 * MiB + 1, /实际.*4 MiB/],
    ['media.bin', 20 * MiB + 1, /实际.*20 MiB/],
  ]) {
    const bytes = forgeSize(await zip({ [name]: new Uint8Array(actual) }), 0, 1);
    assert.ok(bytes.length < 25000, 'fixture must be a compressed high ratio bomb');
    assert.equal(m.scanDocxZip(bytes)[0].uncompressedSize, 1, 'bomb must pass the structure gate and reach decompression');
    assert.throws(() => m.expandDocxZip(bytes), pattern);
  }
});

test('the actual global counter stops a forged final entry beyond 60 MiB', async () => {
  const m = await api();
  const bytes = forgeSize(await zip({
    'one.bin': new Uint8Array(20 * MiB), 'two.bin': new Uint8Array(20 * MiB),
    'three.bin': new Uint8Array(20 * MiB), 'four.bin': Uint8Array.of(1),
  }), 3, 0);
  assert.equal(m.scanDocxZip(bytes).reduce((sum, e) => sum + e.uncompressedSize, 0), 60 * MiB);
  assert.throws(() => m.expandDocxZip(bytes), /实际.*60 MiB/);
});

test('CRC32 is verified against real expanded STORE and DEFLATE bytes', async () => {
  const m = await api();
  for (const level of [0, 6]) {
    const original = await zip({ 'part.bin': Buffer.from('real CRC') }, level);
    const forged = alter(original, (b, { entries: [e] }) => {
      const wrong = u32(b, e.central + 16) ^ 1;
      set32(b, e.local + 14, wrong); set32(b, e.central + 16, wrong);
    });
    assert.equal(m.scanDocxZip(forged).length, 1);
    assert.throws(() => m.expandDocxZip(forged), /CRC/);
    if (level === 0) {
      const damaged = alter(original, (b, { entries: [e] }) => { b[e.data] ^= 1; });
      assert.throws(() => m.expandDocxZip(damaged), /CRC/);
    }
  }
});

test('the real expanded length must equal the declared size even below all budgets', async () => {
  const m = await api();
  const original = await zip({ 'part.bin': Buffer.from('size agreement') });
  for (const size of [0, 1, 100]) {
    const forged = forgeSize(original, 0, size);
    assert.equal(m.scanDocxZip(forged).length, 1);
    assert.throws(() => m.expandDocxZip(forged), /实际.*声明/);
  }
});

test('truncated, malformed and trailing DEFLATE bytes cannot masquerade as complete streams', async () => {
  const m = await api();
  const original = await zip({ 'part.bin': Buffer.from('completed DEFLATE stream') });
  const { entries: [e] } = layout(original);
  const data = original.subarray(e.data, e.dataEnd);
  for (const replacement of [
    new Uint8Array(Buffer.concat([data, Uint8Array.of(0)])),
    new Uint8Array(Buffer.concat([data, data])),
    data.subarray(0, data.length - 1),
    Uint8Array.of(7),
  ]) {
    const forged = replaceCompressed(original, replacement);
    assert.equal(m.scanDocxZip(forged).length, 1);
    assert.throws(() => m.expandDocxZip(forged), /ZIP.*DEFLATE/);
  }
});

test('strict UTF8 decoding preserves a literal initial BOM in the ZIP name', async () => {
  const m = await api();
  const name = '\ufeffnotes.bin';
  const bytes = await zip({ [name]: Uint8Array.of(1) });
  assert.equal(m.scanDocxZip(bytes)[0].name, name);
  assert.deepEqual([...m.expandDocxZip(bytes).keys()], [name]);
});

test('Unicode Path extra names must be valid, unique and agree with raw UTF8 names and CRC', async () => {
  const m = await api();
  const name = '中文.bin';
  const agreeing = unicodePathExtra(name);
  const make = extra => zip({ [name]: [Uint8Array.of(1), { extra }] });
  const normal = await make({ 0xcafe: Uint8Array.of(1, 2, 3), 0x7075: agreeing });
  assert.equal(m.scanDocxZip(normal)[0].name, name);
  assert.deepEqual(m.expandDocxZip(normal).get(name), Uint8Array.of(1));
  rejectBoth(m, await make({ 0x7075: unicodePathExtra(name, 'evil.bin') }));
  for (const payload of [
    Uint8Array.of(1),
    Uint8Array.from([2, ...agreeing.subarray(1)]),
    Uint8Array.from([1, 0, 0, 0, 0, ...agreeing.subarray(5)]),
    Uint8Array.from([...agreeing.subarray(0, 5), 0xff]),
  ]) rejectBoth(m, await make({ 0x7075: payload }));
  const duplicated = await make({ 0x7075: agreeing, 0x7076: agreeing });
  rejectBoth(m, alter(duplicated, (b, { entries: [e] }) => {
    for (const start of [e.local + 30 + e.nameLength, e.central + 46 + e.nameLength]) {
      set16(b, start + 4 + agreeing.length, 0x7075);
    }
  }));
});

test('an unsigned descriptor with CRC equal to optional signature magic is disambiguated by expected fields', async () => {
  const m = await api();
  const data = crcPayload(0x08074b50);
  const original = await streamZip({ 'magic.bin': data }, false);
  const { end, central, entries: [e] } = layout(original);
  const bytes = new Uint8Array(Buffer.concat([original.subarray(0, e.dataEnd), original.subarray(e.dataEnd + 4)]));
  set32(bytes, end - 4 + 16, central - 4);
  assert.equal(u32(bytes, e.dataEnd), 0x08074b50);
  assert.equal(m.scanDocxZip(bytes)[0].recordEnd, e.dataEnd + 12);
  assert.deepEqual(m.expandDocxZip(bytes).get('magic.bin'), data);
});

test('the ZIP module runs in a worker-like realm without DOM, network or filesystem globals', async () => {
  await api();
  const source = fs.readFileSync(file, 'utf8');
  const policy = fs.readFileSync(path.join(__dirname, '../shared/docx-policy.mjs'), 'utf8');
  const pako = fs.readFileSync(path.join(__dirname, '../node_modules/pako/dist/pako.mjs'), 'utf8');
  const bytes = await zip({ 'part.bin': Buffer.from('pure worker') });
  const script = `
    import assert from 'node:assert/strict';
    import vm from 'node:vm';
    const context = vm.createContext({ TextDecoder });
    const codec = new vm.SourceTextModule(${JSON.stringify(pako)}, { context });
    const policy = new vm.SourceTextModule(${JSON.stringify(policy)}, { context });
    const module = new vm.SourceTextModule(${JSON.stringify(source)}, { context });
    const reject = specifier => { throw new Error('Unexpected dependency: ' + specifier); };
    await codec.link(reject);
    await policy.link(reject);
    await module.link(specifier => specifier === 'pako' ? codec : specifier === './docx-policy.mjs' ? policy : reject(specifier));
    const before = Reflect.ownKeys(context);
    await module.evaluate();
    assert.deepEqual(Reflect.ownKeys(context), before);
    const input = vm.runInContext('new Uint8Array(${JSON.stringify([...bytes])})', context);
    const copy = [...input];
    assert.equal(module.namespace.scanDocxZip(input)[0].name, 'part.bin');
    assert.equal(Buffer.from(module.namespace.expandDocxZip(input).get('part.bin')).toString(), 'pure worker');
    assert.deepEqual([...input], copy);
  `;
  const result = spawnSync(process.execPath, [
    '--experimental-vm-modules', '--no-warnings', '--input-type=module', '--eval', script,
  ], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('real streaming inflation feeds at most 256 compressed bytes and aborts before the full bomb expands', async () => {
  const m = await api();
  const { Inflate } = await import('pako');
  const bytes = forgeSize(await zip({ 'bomb.bin': new Uint8Array(80 * MiB) }), 0, 1);
  assert.equal(m.scanDocxZip(bytes)[0].uncompressedSize, 1);
  const compressedSize = m.scanDocxZip(bytes)[0].compressedSize;
  const originalPush = Inflate.prototype.push;
  let fed = 0;
  let produced = 0;
  // Instrument the real codec rather than substituting decompression results.
  Inflate.prototype.push = function (chunk, final) {
    assert.ok(chunk.length <= 256, 'compressed input chunks must stay bounded');
    fed += chunk.length;
    const onData = this.onData;
    this.onData = output => {
      assert.ok(output.length <= 65536, 'expanded output chunks must stay bounded');
      produced += output.length;
      return onData(output);
    };
    try { return originalPush.call(this, chunk, final); } finally { this.onData = onData; }
  };
  try {
    assert.throws(() => m.expandDocxZip(bytes), /实际.*20 MiB/);
    assert.ok(fed < compressedSize, 'decompression must stop feeding bytes immediately at the limit');
    assert.ok(produced > 20 * MiB && produced < 21 * MiB, 'only a bounded crossing chunk may be produced');
  } finally { Inflate.prototype.push = originalPush; }
});

test('non-ASCII names require the UTF8 flag to avoid disagreement with legacy ZIP name decoding', async () => {
  const m = await api();
  const name = '中文.bin';
  const original = await zip({ [name]: Uint8Array.of(1) });
  assert.equal(m.scanDocxZip(original)[0].flags & 0x800, 0x800);
  assert.equal(m.expandDocxZip(original).get(name).length, 1);
  const legacy = alter(original, (b, { entries: [e] }) => {
    set16(b, e.local + 6, u16(b, e.local + 6) & ~0x800);
    set16(b, e.central + 8, u16(b, e.central + 8) & ~0x800);
  });
  rejectBoth(m, legacy, /UTF8.*编码/);
  const ascii = await zip({ 'normal.bin': Uint8Array.of(1) });
  assert.equal(m.scanDocxZip(ascii)[0].flags & 0x800, 0);
  assert.equal(m.expandDocxZip(ascii).get('normal.bin').length, 1);
});

test('supported DEFLATE option flags and stored DEFLATE blocks remain compatible', async () => {
  const m = await api();
  const data = new Uint8Array(100000);
  for (let i = 0; i < data.length; i++) data[i] = (i * 7) & 255;
  for (const level of [1, 9]) {
    const bytes = await zip({ 'part.bin': data }, level);
    assert.equal(m.scanDocxZip(bytes)[0].method, 8);
    assert.deepEqual(m.expandDocxZip(bytes).get('part.bin'), data);
  }
  const original = await zip({ 'part.bin': data });
  const storedBlocks = (await codec()).deflateSync(data, { level: 0 });
  const bytes = replaceCompressed(original, storedBlocks);
  assert.equal(m.scanDocxZip(bytes)[0].method, 8);
  assert.deepEqual(m.expandDocxZip(bytes).get('part.bin'), data);
});

test('ambiguous EOCD candidates are rejected while ordinary signature bytes inside comments are supported', async () => {
  const m = await api();
  const original = await zip({ 'part.bin': Uint8Array.of(1) }, 0);
  const goodComment = Uint8Array.from([65, 0x50, 0x4b, 5, 6, 66]);
  const normal = new Uint8Array(Buffer.concat([original, goodComment]));
  set16(normal, original.length - 2, goodComment.length);
  assert.equal(m.scanDocxZip(normal).length, 1);
  const ambiguous = new Uint8Array(Buffer.concat([original, original.subarray(original.length - 22)]));
  set16(ambiguous, original.length - 2, 22);
  rejectBoth(m, ambiguous, /歧义/);
});

test('malformed raw DEFLATE stored-block length complements reach expansion and are rejected', async () => {
  const m = await api();
  const { deflateSync } = await codec();
  for (const length of [0, 20, 100000]) {
    const data = new Uint8Array(length).fill(65);
    const original = await zip({ 'part.bin': data });
    const stored = deflateSync(data, { level: 0 });
    const offsets = length > 65535 ? [0, 65535 + 5] : [0];
    for (const offset of offsets) {
      assert.equal(stored[offset] >>> 1 & 3, 0, 'fixture targets a stored DEFLATE block');
      const corrupt = stored.slice();
      corrupt[offset + 3] ^= 1;
      assert.throws(() => inflateRawSync(corrupt), /stored block lengths/);
      const bytes = replaceCompressed(original, corrupt);
      assert.equal(m.scanDocxZip(bytes).length, 1, 'invalid compressed block must reach expansion');
      assert.throws(() => m.expandDocxZip(bytes), /ZIP.*DEFLATE/);
    }
  }
});

for (const [error, hex] of [
  ['invalid literal/length code', 'e3951364931513e4e3e5131c0300'],
  ['invalid distance code', '6360646266616563e7e0e4e2e6e1a5e3171014120600'],
  ['invalid distances set', '0dc0820dc0b0d9ac6dfcff61d3f5c338cdcbbaedc779ddcffbfd00224c28e3422a6dacf321a65c6a03'],
  ['invalid bit length repeat', '05c4820dc0b0d9ac6dfcff61d3f5c338cdcbbaedc779ddcffbfd00224c28e3422a6dacf321a65c6a03'],
  ['invalid code lengths set', '05c0c20dc0b0d9ac6dfcff61d3f5c338cdcbbaedc779ddcffbfd00224c28e3422a6dacf321a65c6a03'],
]) {
  test(`RFC-invalid DEFLATE ${error} is rejected after valid ZIP metadata passes scanning`, async () => {
    const m = await api();
    const compressed = new Uint8Array(Buffer.from(hex, 'hex'));
    assert.throws(() => inflateRawSync(compressed), new RegExp(error.replace('/', '\\/')));
    const bytes = await rawCompressedZip(compressed);
    assert.equal(m.scanDocxZip(bytes).length, 1);
    assert.throws(() => m.expandDocxZip(bytes), /ZIP.*DEFLATE/);
  });
}
