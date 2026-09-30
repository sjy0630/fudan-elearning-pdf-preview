import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { archiveDirectory } from './archive.mjs';
import { createDemoPdf } from './demo-pdf.mjs';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', root)));
const sums = (await readFile(new URL('dist/SHA256SUMS.txt', root), 'utf8')).trim().split('\n');
assert.equal(sums.length, 2);
for (const browser of ['chromium', 'firefox']) {
  const name = `fudan-elearning-pdf-preview-${browser}-${pkg.version}.zip`;
  const bytes = await readFile(new URL(`dist/${name}`, root));
  assert.ok(sums.includes(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`), 'Checksum mismatch');
  // Independently repackage to catch missing files, changed bytes and unstable metadata.
  assert.deepEqual(bytes, Buffer.from(await archiveDirectory(fileURLToPath(new URL(`dist/${browser}/`, root)))));
  const files = unzipSync(bytes);
  const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString());
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, pkg.version);
  assert.deepEqual(manifest.permissions, ['webRequest']);
  assert.deepEqual(manifest.host_permissions, ['https://elearning.fudan.edu.cn/*']);
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*']);
  assert.ok(!manifest.content_security_policy.extension_pages.includes("'unsafe-eval'"));
  const resources = ['viewer.html', 'viewer.mjs', 'viewer.css', 'reader.mjs', 'help.html', 'help.css',
    'popup.html', 'demo.pdf', 'LICENSE.txt', 'vendor/PDFJS-LICENSE.txt', 'vendor/pdf.mjs',
    'vendor/pdf.worker.mjs', 'vendor/pdf_viewer.css', ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap((script) => script.js),
    ...(manifest.background.scripts || [manifest.background.service_worker])];
  for (const resource of resources) assert.ok(files[resource]?.length, `Missing ${resource}`);
  for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'images']) {
    assert.ok(Object.keys(files).some((name) => name.startsWith(`vendor/${directory}/`)));
  }
  assert.deepEqual(Buffer.from(files['demo.pdf']), createDemoPdf());
  for (const name of Object.keys(files)) {
    assert.ok(!name.includes('\\') && !name.startsWith('/') && !name.split('/').includes('..'), name);
    assert.ok(!/quickjs-eval|node_modules|\.DS_Store/.test(name), name);
  }
  if (browser === 'firefox') assert.equal(manifest.browser_specific_settings.gecko.id, 'fudan-elearning-pdf-preview@sjy0630');
  else assert.equal(manifest.background.service_worker, 'background.js');
  console.log(`${browser}: checksum, reproducibility, manifest and ${Object.keys(files).length} resources verified`);
}
