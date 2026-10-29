// Optional fixture-authoring tool. The generated demo is distributed under MIT.
// Set PPTXGENJS_PATH to a local pptxgenjs module; it is not a runtime dependency.
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { fileURLToPath } from 'node:url';
import { createDemoImage } from './demo-files.mjs';
const require = createRequire(import.meta.url);
const PptxGenJS = require(process.env.PPTXGENJS_PATH || 'pptxgenjs');
const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'Fudan eLearning Preview contributors';
pptx.subject = 'Original offline preview fixture, MIT licensed';
pptx.title = '演示文稿预览 / Presentation preview';
pptx.lang = 'zh-CN';
pptx.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial', lang: 'zh-CN' };
function slide(title, page) {
  const s = pptx.addSlide(); s.background = { color: 'F3F6FA' };
  s.addShape(pptx.ShapeType.rect, { x:0,y:0,w:13.333,h:0.18,fill:{color:'2456A6'},line:{color:'2456A6'} });
  s.addText(title,{x:0.65,y:0.55,w:12,h:0.8,fontSize:28,bold:true,color:'17325C',margin:0});
  s.addText(`Local preview demo · ${page} / 3`,{x:0.65,y:7,w:12,h:0.22,fontSize:11,color:'586A80',margin:0});
  return s;
}
let s = slide('文字与形状 / Text and shapes',1);
s.addText('第一张幻灯片\nHello, Canvas!\n本地预览，不上传课件。',{x:0.8,y:1.8,w:7,h:2.4,fontSize:24,breakLine:false,color:'172C48'});
s.addShape(pptx.ShapeType.rect,{x:9,y:2,w:2.5,h:1.6,fill:{color:'2456A6'},line:{color:'2456A6'}});
s.addShape(pptx.ShapeType.ellipse,{x:9.3,y:4.2,w:1.8,h:1.8,fill:{color:'F1B744'},line:{color:'D49921'}});
s = slide('图片与图注 / Image and caption',2);
s.addImage({data:`image/png;base64,${Buffer.from(createDemoImage()).toString('base64')}`,x:0.9,y:1.7,w:6,h:3.6});
s.addText('第二张幻灯片\n原创 PNG 样例\nOriginal raster image',{x:8,y:2.2,w:4.5,h:2.5,fontSize:24,color:'172C48'});
s = slide('基本表格 / Basic table',3);
s.addTable([['Format','Mode','Page'],['PPTX','Local','3'],['PPT (97–2003)','Local','3']],{x:0.8,y:1.9,w:11.7,h:3,fontSize:20,border:{type:'solid',color:'B0C4DF',pt:1},fill:'FFFFFF',color:'17325C',margin:0.15,rowH:0.9,autoPage:false});
s.addText('第三张幻灯片 · End of demo',{x:0.8,y:5.7,w:11.7,h:0.5,fontSize:20,color:'586A80'});
const output = new URL('../tests/fixtures/presentation/',import.meta.url);
await mkdir(output,{recursive:true});
await pptx.writeFile({fileName:fileURLToPath(new URL('normal.pptx',output)),compression:true});
// PptxGenJS may declare extra masters without creating those parts. Remove only
// dangling content-type overrides so the committed OPC sample is consistent.
const file = new URL('normal.pptx',output);
const parts = unzipSync(await readFile(file));
parts['[Content_Types].xml'] = strToU8(strFromU8(parts['[Content_Types].xml']).replace(/<Override\b[^>]*\/>/g, tag => {
  const name = /PartName="\/([^"]+)"/.exec(tag)?.[1];
  return name && !parts[name] ? '' : tag;
}));
await writeFile(file,zipSync(parts));
