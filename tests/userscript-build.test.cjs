const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
test('userscript is reproducibly generated with a private embedded registry', async () => {
  const root = path.join(__dirname,'..');
  assert.ok(fs.existsSync(path.join(root,'scripts/build-userscript.mjs')), 'userscript generator exists');
  const { generateUserscript } = await import('../scripts/build-userscript.mjs');
  const generated = await generateUserscript();
  assert.equal(generated,fs.readFileSync(path.join(root,'elearning-pdf-preview.user.js'),'utf8'));
  assert.match(generated,/@version\s+1\.2\.0/);
  assert.match(generated,/const CanvasFileFormats =/);
  assert.doesNotMatch(generated,/globalThis.CanvasFileFormats\s*=|@require/);
  assert.match(generated,/@connect\s+\*/);
  assert.deepEqual([...generated.matchAll(/^\/\/ @grant\s+(\S+)/gm)].map(match => match[1]).sort(), ['GM_getValue','GM_setValue','GM_xmlhttpRequest']);
  assert.deepEqual([...generated.matchAll(/^\/\/ @match\s+(\S+)/gm)].map(match => match[1]), ['https://elearning.fudan.edu.cn/*']);
  for (const name of ['createPdfPreference','createPdfjsReader']) {
    assert.equal(generated.split(`function ${name}(`).length, 2, `${name} embedded exactly once`);
    assert.doesNotMatch(generated, new RegExp(`(?:window|globalThis)\\.${name}\\s*=`));
  }
  assert.doesNotMatch(generated,/EMBED_(?:PDF_PREFERENCE|PDFJS_READER|PDFJS_CSS)/);
});
