const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const plugin = () => import(pathToFileURL(path.join(root, 'scripts/presentation-engine-patch.mjs')));
async function engine(patched = true) {
  const { build } = await import('esbuild');
  const { presentationEnginePatchPlugin } = await plugin();
  const result = await build({ absWorkingDir: root, stdin: { contents: "export { parse } from '@web-ppt/core';", resolveDir: root, loader: 'js' }, bundle: true, write: false, format: 'esm', platform: 'browser', plugins: patched ? [presentationEnginePatchPlugin()] : [], logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
function textBodies(presentation) {
  const bodies = [];
  const visit = elements => { for (const element of elements) { if (element.text) bodies.push(element.text); if (element.children) visit(element.children); } };
  for (const slide of presentation.slides) visit(slide.elements);
  return bodies;
}
function paragraph(body, text) { return body.paragraphs.find(p => p.runs.map(r => r.text).join('') === text); }
test('build patch accepts only exact pinned source and fails closed on missing or duplicate fragments', async () => {
  const { patchPresentationEngineSource } = await plugin();
  const source = await fs.readFile(path.join(root, 'node_modules/@web-ppt/core/dist/core.js'), 'utf8');
  assert.notEqual(patchPresentationEngineSource(source, '0.4.5'), source);
  assert.throws(() => patchPresentationEngineSource(source, '0.4.6'), /0\.4\.5/);
  assert.throws(() => patchPresentationEngineSource('not the expected source', '0.4.5'), /exactly once/);
  assert.throws(() => patchPresentationEngineSource(source + source, '0.4.5'), /exactly once/);
});
test('patched binary PPT character cursor consumes paragraph separators without changing legitimate white text', async () => {
  const bytes = await fs.readFile(path.join(root, 'tests/fixtures/presentation/normal.ppt'));
  const baseline = await engine(false), patched = await engine(true);
  const old = await baseline.parse(bytes), corrected = await patched.parse(bytes);
  const bodyFor = (p, text) => textBodies(p).find(b => paragraph(b, text));
  assert.equal(paragraph(bodyFor(old, 'Hello, Canvas!'), 'Hello, Canvas!').runs[0].color, 'rgb(255,255,255)', 'Fixture must reproduce the upstream cursor defect');
  for (const text of ['Hello, Canvas!', '本地预览，不上传课件。', '原创 PNG 样例', 'Original raster image']) {
    const p = paragraph(bodyFor(corrected, text), text);
    assert.ok(p.runs.every(r => r.color === 'rgb(23,44,72)'), text);
  }
  old.dispose?.(); corrected.dispose?.();
  const intentional = Buffer.from(bytes);
  const textAt = intentional.indexOf(Buffer.from('第一张幻灯片', 'utf16le'));
  // Character-style run: 14 characters, size+explicit RGB fields, 24pt dark.
  // Change its explicit color to white; paragraph-separator styles are untouched.
  const signature = Buffer.from('0e000000000006001800172c48fe', 'hex');
  const runAt = intentional.indexOf(signature, textAt);
  assert.ok(textAt > 0 && runAt > textAt && runAt - textAt < 256);
  intentional.set([255, 255, 255, 254], runAt + signature.length - 4);
  const white = await patched.parse(intentional), body = bodyFor(white, 'Hello, Canvas!');
  assert.ok(paragraph(body, 'Hello, Canvas!').runs.every(r => r.color === 'rgb(255,255,255)'), 'Intentionally white text must remain white');
  assert.ok(paragraph(body, '本地预览，不上传课件。').runs.every(r => r.color === 'rgb(23,44,72)'), 'Next dark paragraph must remain dark');
  white.dispose?.();
});
