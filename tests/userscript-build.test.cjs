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
  assert.match(generated,/@version\s+1\.1\.0/);
  assert.match(generated,/const CanvasFileFormats =/);
  assert.doesNotMatch(generated,/globalThis.CanvasFileFormats\s*=|@require/);
  assert.match(generated,/@connect\s+\*/);
});
