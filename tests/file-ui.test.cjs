const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
test('image and text demos are generated and verified in both packages', () => {
  const build = fs.readFileSync(path.join(root,'scripts/build.mjs'),'utf8');
  const verify = fs.readFileSync(path.join(root,'scripts/verify-packages.mjs'),'utf8');
  for (const name of ['demo.png','demo.txt']) { assert.ok(build.includes(name), `${name} must be packaged`); assert.ok(verify.includes(name), `${name} must be verified`); }
  for (const name of ['file-viewer.html','file-viewer.mjs','file-viewer.css']) assert.ok(verify.includes(name));
});
test('help exposes fixed offline image and text demos', () => {
  const help = fs.readFileSync(path.join(root,'extension/help.html'),'utf8');
  assert.ok(help.includes('file-viewer.html?demo=image')); assert.ok(help.includes('file-viewer.html?demo=text'));
});
