import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { presentationEnginePatchPlugin } from './presentation-engine-patch.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const distributions = [['@web-ppt/core','0.4.5'],['@xmldom/xmldom','0.9.12'],['pako','3.0.2'],['fflate','0.8.3']];
async function notices() {
  const entries = await Promise.all(distributions.map(async ([name, version]) => {
    const directory = path.join(root,'node_modules',name);
    const pkg = JSON.parse(await readFile(path.join(directory,'package.json'),'utf8'));
    if (pkg.name !== name || pkg.version !== version) throw new Error(`Expected ${name} ${version}`);
    return `${name} ${version}\n${await readFile(path.join(directory,'LICENSE'),'utf8')}`;
  }));
  const map = JSON.parse(await readFile(path.join(root,'node_modules/pako/dist/pako.mjs.map'),'utf8'));
  const source = map.sourcesContent?.[map.sources.indexOf('../src/zlib/inflate.mjs')];
  const notice = source?.match(/\/\/ \(C\) 1995-2013 Jean-loup Gailly and Mark Adler\r?\n(?:\/\/[^\n]*\r?\n)+/)?.[0];
  if (!notice?.includes('3. This notice may not be removed or altered from any source distribution.')) throw new Error('Missing Zlib source notice');
  entries.push(`pako Zlib portions\n${notice.replace(/^\/\/ ?/gm,'')}`);
  return ['PPT / PPTX local preview third-party notices\nBundled and minified for offline use. @web-ppt/core 0.4.5 receives a build-time character-style cursor accounting correction for PPT paragraph separators; installed upstream files are unchanged.',...entries].join('\n\n').replace(/\r\n?/g,'\n').split('\n').map(line=>line.trimEnd()).join('\n')+'\n';
}
export async function bundlePresentation() {
  const license = await notices(), banner = `/* ${license.replaceAll('*/','* /')}*/\n`;
  const common = {absWorkingDir:root,bundle:true,write:false,platform:'browser',target:'es2022',minify:true,sourcemap:false,legalComments:'inline',logLevel:'silent'};
  const entry = {contents:`export { createPresentationReader } from './shared/presentation-reader.mjs';\nexport { PRESENTATION_MIMES, PRESENTATION_LIMITS } from './shared/presentation-policy.mjs';`,resolveDir:root,sourcefile:'presentation-browser-entry.mjs',loader:'js'};
  const [esm,iife,worker] = await Promise.all([
    build({...common,stdin:entry,format:'esm'}),
    build({...common,stdin:entry,format:'iife',globalName:'privatePresentationLibrary'}),
    build({...common,entryPoints:['shared/presentation-worker.mjs'],format:'iife',plugins:[presentationEnginePatchPlugin()]}),
  ]);
  const workerSource = banner + worker.outputFiles[0].text;
  return {
    coreSource:banner+esm.outputFiles[0].text,workerSource,notices:license,
    userscriptSource:`${banner}
function createEmbeddedPresentation() {
  ${iife.outputFiles[0].text}
  const workerSource = ${JSON.stringify(workerSource)};
  return Object.freeze({ ...privatePresentationLibrary, makeWorker() {
    let url;
    try {
      url = URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
      const worker = new Worker(url);
      let disposed = false;
      return {worker,dispose(){if(!disposed){disposed=true;URL.revokeObjectURL(url);}}};
    } catch {
      if (url !== undefined) URL.revokeObjectURL(url);
      throw new Error('幻灯片本地处理进程无法启动，可能被页面安全策略拦截。请重试或打开原文件。');
    }
  }});
}
`,
  };
}
