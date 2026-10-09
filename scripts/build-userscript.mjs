import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { bundlePdfjs } from './bundle-pdfjs.mjs';

const root = new URL('../', import.meta.url);
export async function generateUserscript() {
  const [template, registry, pdfjs, runtime] = await Promise.all([
    readFile(new URL('userscript/preview.template.js', root), 'utf8'),
    readFile(new URL('shared/formats.js', root), 'utf8'),
    bundlePdfjs(),
    readFile(new URL('userscript/pdfjs-runtime.js', root), 'utf8'),
  ]);
  const marker = '/* EMBED_SHARED_FORMATS */';
  if (template.split(marker).length !== 2 || !registry.includes('globalThis.CanvasFileFormats =')) {
    throw new Error('Invalid userscript template or registry');
  }
  let output = template.replace(marker, () => registry.replace('globalThis.CanvasFileFormats =', 'const CanvasFileFormats =').trimEnd());
  for (const [embedMarker, source] of [['/* EMBED_PDFJS_BUNDLE */', pdfjs], ['/* EMBED_PDFJS_RUNTIME */', runtime]]) {
    if (output.split(embedMarker).length !== 2) throw new Error(`Expected exactly one ${embedMarker} marker`);
    output = output.replace(embedMarker, () => source.trimEnd());
  }
  return output;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = await generateUserscript();
  const destination = new URL('elearning-pdf-preview.user.js', root);
  if (process.argv.includes('--check')) {
    if (output !== await readFile(destination, 'utf8')) throw new Error('Generated userscript is stale; run npm run build:userscript');
  } else await writeFile(destination, output);
}
