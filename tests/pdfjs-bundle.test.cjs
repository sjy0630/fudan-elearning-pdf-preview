const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('offline PDF.js bundle is deterministic, private, licensed and byte-exact', async () => {
  assert.ok(fs.existsSync(path.join(__dirname, '../scripts/bundle-pdfjs.mjs')), 'bundlePdfjs API exists');
  const { bundlePdfjs } = await import('../scripts/bundle-pdfjs.mjs');
  const source = await bundlePdfjs();
  assert.equal(source, await bundlePdfjs());
  assert.match(source, /Apache License/);
  assert.match(source, /LICENSE_FOXIT/);
  assert.match(source, /LICENSE_LIBERATION/);
  assert.doesNotMatch(source, /[ \t]+$/m, 'embedded notices have no trailing whitespace');
  assert.doesNotMatch(source, /sourceMappingURL|globalThis\.pdfjsLib\s*=|globalThis\.pdfjsWorker\s*=|\beval\s*\(|new Function\s*\(/);
  const sandbox = { atob, Uint8Array };
  vm.createContext(sandbox);
  const assets = vm.runInContext(`${source}\ncreateEmbeddedPdfjs()`, sandbox);
  assert.equal(assets.version, '6.3.289');
  assert.equal(typeof assets.getLibrary, 'function');
  assert.match(assets.workerSource, /WorkerMessageHandler|initializeFromPort/);
  assert.ok(assets.workerSource.length > 100000, 'worker is embedded source, not a URL');
  assert.equal(sandbox.pdfjsLib, undefined);
  const factory = new assets.BinaryDataFactory();
  for (const [kind, folder, extension] of [
    ['cMapUrl', 'cmaps', '.bcmap'],
    ['standardFontDataUrl', 'standard_fonts', /\.(pfb|ttf)$/],
    ['wasmUrl', 'wasm', '.wasm'],
  ]) {
    const directory = path.join(__dirname, '../node_modules/pdfjs-dist', folder);
    for (const filename of fs.readdirSync(directory).sort().filter(name => !name.startsWith('quickjs-eval') && (typeof extension === 'string' ? name.endsWith(extension) : extension.test(name)))) {
      const actual = await factory.fetch({ kind, filename });
      assert.deepEqual(Buffer.from(actual), fs.readFileSync(path.join(directory, filename)), `${kind}/${filename}`);
      actual.fill(0);
      assert.deepEqual(Buffer.from(await factory.fetch({ kind, filename })), fs.readFileSync(path.join(directory, filename)), 'callers get independent bytes');
    }
  }
  for (const resource of [
    { kind: 'other', filename: 'H.bcmap' },
    { kind: '__proto__', filename: 'toString' },
    { kind: 'cMapUrl', filename: '../H.bcmap' },
    { kind: 'cMapUrl', filename: 'https://example.invalid/H.bcmap' },
    { kind: 'cMapUrl', filename: 'missing.bcmap' },
    { kind: 'cMapUrl', filename: 'constructor' },
    { kind: 'wasmUrl', filename: 'quickjs-eval.wasm' },
  ]) await assert.rejects(factory.fetch(resource), /embedded PDF\.js resource/);
});

test('userscript embeds the private runtime and bundle exactly once inside its closure', async () => {
  const { generateUserscript } = await import('../scripts/build-userscript.mjs');
  const source = await generateUserscript();
  assert.equal(source.split('function createEmbeddedPdfjs()').length, 2);
  assert.equal(source.split('function createPdfjsRuntime()').length, 2);
  assert.doesNotMatch(source, /EMBED_PDFJS/);
  assert.ok(source.indexOf('function createEmbeddedPdfjs()') > source.indexOf('(function () {'));
});
