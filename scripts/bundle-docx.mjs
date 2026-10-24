import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
// Include dependencies hidden inside JSZip's browser distribution as well as
// both xmldom versions. Version checks keep these notices tied to fixed inputs.
const distributions = [
  ['mammoth', 'mammoth', '1.13.0', 'LICENSE'],
  ['dompurify', 'dompurify', '3.4.17', 'LICENSE'],
  ['@xmldom/xmldom', '@xmldom/xmldom', '0.9.12', 'LICENSE'],
  ['mammoth/node_modules/@xmldom/xmldom', '@xmldom/xmldom', '0.8.15', 'LICENSE'],
  ['pako', 'pako', '3.0.2', 'LICENSE'],
  ['fflate', 'fflate', '0.8.3', 'LICENSE'],
  ['underscore', 'underscore', '1.13.8', 'LICENSE'],
  ['base64-js', 'base64-js', '1.5.1', 'LICENSE'],
  ['jszip', 'jszip', '3.10.2', 'LICENSE.markdown'],
  ['jszip/node_modules/pako', 'pako', '1.0.11', 'LICENSE'],
  ['xmlbuilder', 'xmlbuilder', '10.1.1', 'LICENSE'],
  ['dingbat-to-unicode', 'dingbat-to-unicode', '1.0.2', 'LICENSE'],
  ['lop', 'lop', '0.4.2', 'LICENSE'],
  ['option', 'option', '0.2.4', 'LICENSE'],
  ['lie', 'lie', '3.3.0', 'license.md'],
  ['immediate', 'immediate', '3.0.6', 'LICENSE.txt'],
  ['setimmediate', 'setimmediate', '1.0.5', 'LICENSE.txt'],
];
const dependency = relative => path.join(root, 'node_modules', relative);

function zlibNotice(source, label) {
  const notice = source.match(/\/\/ \(C\) 1995-2013 Jean-loup Gailly and Mark Adler\r?\n(?:\/\/[^\n]*\r?\n)+/)?.[0];
  if (!notice?.includes('3. This notice may not be removed or altered from any source distribution.')) throw new Error(`Missing complete Zlib notice: ${label}`);
  return `${label}\n${notice.replace(/^\/\/ ?/gm, '').trimEnd()}`;
}

async function collectNotices() {
  const entries = await Promise.all(distributions.map(async ([directory, name, version, license]) => {
    const metadata = JSON.parse(await readFile(dependency(`${directory}/package.json`), 'utf8'));
    if (metadata.name !== name || metadata.version !== version) throw new Error(`Expected ${name} ${version} at ${directory}, found ${metadata.name} ${metadata.version}`);
    return `${name} ${version} (${directory})\n${await readFile(dependency(`${directory}/${license}`), 'utf8')}`;
  }));
  const [mapText, pako1, purifier] = await Promise.all([
    readFile(dependency('pako/dist/pako.mjs.map'), 'utf8'),
    readFile(dependency('jszip/node_modules/pako/lib/zlib/inflate.js'), 'utf8'),
    readFile(dependency('dompurify/dist/purify.es.mjs'), 'utf8'),
  ]);
  const map = JSON.parse(mapText);
  const pako3 = map.sourcesContent?.[map.sources.indexOf('../src/zlib/inflate.mjs')];
  if (typeof pako3 !== 'string') throw new Error('Missing pako 3.0.2 Zlib source notice');
  entries.push(zlibNotice(pako3, 'pako 3.0.2: Zlib portions'), zlibNotice(pako1, 'pako 1.0.11 inside JSZip: Zlib portions'));
  // DOMPurify ships a generated regenerator helper inside its ESM file. Its
  // attribution is not represented by a separate package in the bundle graph.
  if (!purifier.includes('regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT)')) throw new Error('Missing DOMPurify regenerator-runtime attribution');
  entries.push(`DOMPurify 3.4.17 attribution: (c) Cure53 and other contributors.
DOMPurify is used under its Apache-2.0 option; JSZip under its MIT option.
Their complete distributed license files are included above.

regenerator-runtime helper included in DOMPurify (MIT)
Copyright (c) 2014-present, Facebook, Inc.
Source attribution: https://github.com/babel/babel/blob/main/packages/babel-helpers/LICENSE

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.`);
  return ['DOCX local preview third-party notices\nDistribution changes: bundled and minified for offline use; upstream source files are not edited.\nLicense text line endings and trailing whitespace normalized.', ...entries]
    .join('\n\n').replace(/\r\n?/g, '\n').split('\n').map(line => line.trimEnd()).join('\n') + '\n';
}

/**
 * Return {userscriptSource, coreSource, workerSource, notices}, all strings.
 * userscriptSource defines the private createEmbeddedDocx() factory; its result
 * exports runDocxTask, sanitizeDocxOutput, DOCX_MIME, DOCX_LIMITS and makeWorker.
 * coreSource is browser ESM exporting the same APIs except makeWorker, for an
 * extension's own packaged Worker factory. workerSource is a standalone classic
 * Worker IIFE. Both code files carry full notices; notices is also plain text
 * for a separately distributed license file. No input or output files are written.
 */
export async function bundleDocx() {
  const notices = await collectNotices();
  const banner = `/* ${notices.replaceAll('*/', '* /')}*/\n`;
  const coreEntry = {
    contents: `export { runDocxTask } from './shared/docx-runtime.mjs';
export { sanitizeDocxOutput } from './shared/docx-sanitize.mjs';
export { DOCX_MIME, DOCX_LIMITS } from './shared/docx-policy.mjs';`,
    resolveDir: root,
    sourcefile: 'docx-browser-entry.mjs',
    loader: 'js',
  };
  const common = {
    absWorkingDir: root, bundle: true, write: false, platform: 'browser',
    target: 'es2022', minify: true, sourcemap: false, legalComments: 'inline',
    logLevel: 'silent',
  };
  const [core, iife, worker] = await Promise.all([
    build({ ...common, stdin: coreEntry, format: 'esm' }),
    build({ ...common, stdin: coreEntry, format: 'iife', globalName: 'privateDocxLibrary' }),
    build({ ...common, entryPoints: ['shared/docx-worker.mjs'], format: 'iife' }),
  ]);
  const workerSource = banner + worker.outputFiles[0].text;
  return {
    coreSource: banner + core.outputFiles[0].text,
    workerSource,
    notices,
    userscriptSource: `${banner}
function createEmbeddedDocx() {
  ${iife.outputFiles[0].text}
  const workerSource = ${JSON.stringify(workerSource)};
  return Object.freeze({
    ...privateDocxLibrary,
    makeWorker() {
      let url;
      try {
        url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
        const worker = new Worker(url);
        let disposed = false;
        return { worker, dispose() {
          if (!disposed) { disposed = true; URL.revokeObjectURL(url); }
        } };
      } catch {
        if (url !== undefined) URL.revokeObjectURL(url);
        throw new Error('DOCX 本地转换进程无法启动，可能被页面安全策略拦截。请重试或打开原文件。');
      }
    },
  });
}
`,
  };
}
