import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const distribution = path.dirname(require.resolve('pdfjs-dist/package.json'));
const expectedVersion = '6.3.289';

// esbuild handles module syntax; the upstream compatibility registries are
// redirected into lexical bindings inside our factory / dedicated worker.
export async function bundlePdfjs() {
  const metadata = JSON.parse(await readFile(path.join(distribution, 'package.json'), 'utf8'));
  if (metadata.version !== expectedVersion) throw new Error(`Expected PDF.js ${expectedVersion}, found ${metadata.version}`);
  const common = {
    absWorkingDir: distribution, bundle: true, write: false, platform: 'browser',
    target: 'es2022', minify: true, sourcemap: false, legalComments: 'inline',
    define: { 'globalThis.pdfjsLib': 'privatePdfjsRegistry', 'globalThis.pdfjsWorker': 'privateWorkerRegistry' },
    banner: { js: 'let privatePdfjsRegistry, privateWorkerRegistry;' },
    logLevel: 'silent',
  };
  const [core, worker] = await Promise.all([
    build({ ...common, entryPoints: ['legacy/build/pdf.mjs'], format: 'iife', globalName: 'privatePdfjsLibrary' }),
    build({ ...common, entryPoints: ['legacy/build/pdf.worker.mjs'], format: 'esm' }),
  ]);
  const resources = {};
  const notices = [`pdfjs-dist ${metadata.version}\n${await readFile(path.join(distribution, 'LICENSE'), 'utf8')}`];
  for (const [kind, folder, accepts] of [
    ['cMapUrl', 'cmaps', name => name.endsWith('.bcmap')],
    ['standardFontDataUrl', 'standard_fonts', name => /\.(pfb|ttf)$/.test(name)],
    ['wasmUrl', 'wasm', name => name.endsWith('.wasm') && !name.startsWith('quickjs-eval')],
  ]) {
    resources[kind] = {};
    const entries = await Promise.all((await readdir(path.join(distribution, folder))).sort()
      .filter(filename => filename.startsWith('LICENSE') || accepts(filename))
      .map(async filename => [filename, await readFile(path.join(distribution, folder, filename))]));
    for (const [filename, data] of entries) {
      if (filename.startsWith('LICENSE')) notices.push(`${folder}/${filename}\n${data.toString('utf8')}`);
      else resources[kind][filename] = data.toString('base64');
    }
  }
  const noticeText = notices.join('\n\n').split('\n').map(line => line.trimEnd()).join('\n').replaceAll('*/', '* /');
  return `/* PDF.js third-party notices
Distribution changes: bundled for offline use; upstream compatibility registries
are lexical bindings instead of page globals. License text whitespace normalized.
${noticeText}\n*/
function createEmbeddedPdfjs() {
  let library;
  const resources = ${JSON.stringify(resources)};
  class BinaryDataFactory {
    async fetch({ kind, filename }) {
      if (!Object.hasOwn(resources, kind) || typeof filename !== 'string' ||
          !/^[A-Za-z0-9_.-]+$/.test(filename) || filename.includes('..') ||
          !Object.hasOwn(resources[kind], filename)) {
        throw new Error('Unknown embedded PDF.js resource');
      }
      const binary = atob(resources[kind][filename]);
      return Uint8Array.from(binary, character => character.charCodeAt(0));
    }
  }
  return {
    version: ${JSON.stringify(expectedVersion)},
    workerSource: ${JSON.stringify(worker.outputFiles[0].text)},
    BinaryDataFactory,
    getLibrary() {
      if (!library) library = (() => {
        ${core.outputFiles[0].text}
        return privatePdfjsLibrary;
      })();
      return library;
    }
  };
}
`;
}
