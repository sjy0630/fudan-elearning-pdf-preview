import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { archiveDirectory } from './archive.mjs';
import { createDemoPdf } from './demo-pdf.mjs';
import { createDemoImage, createDemoText } from './demo-files.mjs';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', root)));
const sums = (await readFile(new URL('dist/SHA256SUMS.txt', root), 'utf8')).trim().split('\n');
assert.equal(sums.length, 2);
for (const browser of ['chromium', 'firefox']) {
  const name = `fudan-elearning-pdf-preview-${browser}-${pkg.version}.zip`;
  const bytes = await readFile(new URL(`dist/${name}`, root));
  assert.ok(sums.includes(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`), 'Checksum mismatch');
  // Independently repackage to catch missing files, changed bytes and unstable metadata.
  assert.ok(bytes.equals(Buffer.from(await archiveDirectory(fileURLToPath(new URL(`dist/${browser}/`, root))))), `${browser}: live build directory differs from archive (check for conflict copies)`);
  const files = unzipSync(bytes);
  const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString());
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.default_locale, 'zh_CN');
  assert.equal(manifest.name, '__MSG_extensionName__');
  assert.equal(manifest.description, '__MSG_extensionDescription__');
  assert.equal(manifest.action.default_title, '__MSG_actionTitle__');
  const references = [...JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)].map((match) => match[1]);
  for (const locale of ['zh_CN', 'en']) {
    const resource = `_locales/${locale}/messages.json`;
    assert.ok(files[resource]?.length, `Missing ${resource}`);
    const bytes = Buffer.from(files[resource]);
    assert.deepEqual(bytes, await readFile(new URL(`extension/${resource}`, root)), `${resource}: source bytes differ`);
    const messages = JSON.parse(bytes);
    for (const key of references) {
      assert.equal(typeof messages[key]?.message, 'string', `${locale}: missing ${key}`);
      assert.ok(messages[key].message.trim(), `${locale}: empty ${key}`);
    }
  }
  assert.deepEqual(manifest.permissions, ['webRequest']);
  assert.deepEqual(manifest.host_permissions, ['https://elearning.fudan.edu.cn/*']);
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*']);
  assert.ok(!manifest.content_security_policy.extension_pages.includes("'unsafe-eval'"));
  const resources = ['viewer.html', 'viewer.mjs', 'viewer.css', 'reader.mjs', 'help.html', 'help.css',
    'file-viewer.html', 'file-viewer.mjs', 'file-viewer.css', 'demo.png', 'demo.txt',
    'popup.html', 'demo.pdf', 'LICENSE.txt', 'vendor/PDFJS-LICENSE.txt', 'vendor/pdf.mjs',
    'vendor/pdf.worker.mjs', 'vendor/pdf_viewer.css', ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap((script) => script.js),
    ...(manifest.background.scripts || [manifest.background.service_worker])];
  for (const resource of resources) assert.ok(files[resource]?.length, `Missing ${resource}`);
  for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'images']) {
    assert.ok(Object.keys(files).some((name) => name.startsWith(`vendor/${directory}/`)));
  }
  assert.deepEqual(Buffer.from(files['demo.pdf']), createDemoPdf());
  assert.deepEqual(Buffer.from(files['demo.png']), createDemoImage());
  assert.deepEqual(Buffer.from(files['demo.txt']), createDemoText());
  for (const resource of ['file-viewer.html','file-viewer.mjs','file-viewer.css','reader.mjs','help.html','core.js','catalog.js','content.js','background.js']) assert.deepEqual(Buffer.from(files[resource]), await readFile(new URL(`extension/${resource}`, root)), `${resource}: source bytes differ`);
  assert.deepEqual(Buffer.from(files['formats.js']), await readFile(new URL('shared/formats.js', root)));
  for (const name of Object.keys(files)) {
    assert.ok(!name.includes('\\') && !name.startsWith('/') && !name.split('/').includes('..'), name);
    assert.ok(!/quickjs-eval|node_modules|\.DS_Store/.test(name), name);
    // Finder/iCloud conflict copies use a space and numeric suffix, including on directories.
    assert.ok(!name.split('/').some((part) => / \d+(?=\.|$)/.test(part)), `Duplicate copy: ${name}`);
  }
  if (browser === 'firefox') assert.equal(manifest.browser_specific_settings.gecko.id, 'fudan-elearning-pdf-preview@sjy0630');
  else assert.equal(manifest.background.service_worker, 'background.js');
  console.log(`${browser}: checksum, reproducibility, manifest and ${Object.keys(files).length} resources verified`);
}
