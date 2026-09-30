import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createDemoPdf } from './demo-pdf.mjs';
import { archiveDirectory } from './archive.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json')));
const vendor = path.join(root, 'node_modules/pdfjs-dist');
const dist = path.join(root, 'dist');
const catalogContext = {};
vm.runInNewContext(await readFile(path.join(root, 'extension/catalog.js'), 'utf8'), catalogContext);
const sites = Array.from(catalogContext.CanvasPreviewCatalog.platforms, (platform) => `${platform.origin}/*`);
await mkdir(dist, { recursive: true });
const checksums = [];

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function icon(size) {
  const data = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * (size * 4 + 1) + 1 + x * 4;
    const xx = x / size, yy = y / size;
    let rgb = [36, 86, 166];
    if (xx > .26 && xx < .74 && yy > .17 && yy < .83) rgb = [255, 255, 255];
    if (xx > .35 && xx < .65 && ((yy > .41 && yy < .47) || (yy > .55 && yy < .61) || (yy > .69 && yy < .75))) rgb = [36, 86, 166];
    const rounded = Math.hypot(Math.max(.15 - xx, 0, xx - .85), Math.max(.15 - yy, 0, yy - .85)) <= .15;
    data.set([...rgb, rounded ? 255 : 0], i);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(data)), chunk('IEND', Buffer.alloc(0))]);
}

for (const browser of ['chromium', 'firefox']) {
  const output = path.join(dist, browser);
  await rm(output, { recursive: true, force: true });
  await cp(path.join(root, 'extension'), output, { recursive: true });
  await writeFile(path.join(output, 'demo.pdf'), createDemoPdf());
  await mkdir(path.join(output, 'vendor'), { recursive: true });
  for (const file of ['pdf.mjs', 'pdf.worker.mjs']) await cp(path.join(vendor, 'legacy/build', file), path.join(output, 'vendor', file));
  await cp(path.join(vendor, 'web/pdf_viewer.css'), path.join(output, 'vendor/pdf_viewer.css'));
  for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'web/images']) {
    await cp(path.join(vendor, dir), path.join(output, 'vendor', path.basename(dir)), {
      recursive: true, filter: (source) => !path.basename(source).startsWith('quickjs-eval'),
    });
  }
  await cp(path.join(vendor, 'LICENSE'), path.join(output, 'vendor/PDFJS-LICENSE.txt'));
  await cp(path.join(root, 'LICENSE'), path.join(output, 'LICENSE.txt'));
  await mkdir(path.join(output, 'icons'));
  const icons = {};
  for (const size of [16, 32, 48, 128]) {
    icons[size] = `icons/icon-${size}.png`;
    await writeFile(path.join(output, icons[size]), icon(size));
  }
  const manifest = {
    manifest_version: 3, name: '复旦 eLearning PDF 预览', version: pkg.version,
    description: '点击 eLearning 的 PDF 文件名即可阅读，免 Tampermonkey，自带阅读器，文件仅在浏览器中处理。',
    homepage_url: 'https://github.com/sjy0630/fudan-elearning-pdf-preview',
    permissions: ['webRequest'],
    host_permissions: sites,
    optional_host_permissions: ['https://*/*'],
    content_scripts: [{ matches: sites, js: ['catalog.js', 'core.js', 'content.js'], run_at: 'document_idle' }],
    action: { default_popup: 'popup.html', default_title: 'eLearning PDF 预览', default_icon: icons },
    options_ui: { page: 'help.html', open_in_tab: true }, icons,
    content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'none'" },
    background: browser === 'firefox' ? { scripts: ['catalog.js', 'core.js', 'background.js'] } : { service_worker: 'background.js' },
  };
  if (browser === 'firefox') {
    manifest.browser_specific_settings = { gecko: {
      id: 'fudan-elearning-pdf-preview@sjy0630', strict_min_version: '142.0',
      data_collection_permissions: { required: ['none'] },
    } };
  } else manifest.minimum_chrome_version = '120';
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const archive = path.join(dist, `fudan-elearning-pdf-preview-${browser}-${pkg.version}.zip`);
  await writeFile(archive, await archiveDirectory(output));
  checksums.push(`${createHash('sha256').update(await readFile(archive)).digest('hex')}  ${path.basename(archive)}`);
  console.log(`${browser}: ${archive}`);
}
await writeFile(path.join(dist, 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
