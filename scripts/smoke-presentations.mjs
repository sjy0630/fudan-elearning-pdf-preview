import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium, firefox } from 'playwright';
const root = new URL('../',import.meta.url);
const engine = process.env.PRESENTATION_BROWSER === 'firefox' ? 'firefox' : 'chromium';
const output = new URL(`output/playwright/presentations-${engine}/`,root);
await mkdir(output,{recursive:true});
const report = {engine,checks:[],passed:false}, unexpected = [], errors = [];
const fixtures = Object.fromEntries(await Promise.all(['ppt','pptx'].map(async id=>[id,await readFile(new URL(`tests/fixtures/presentation/normal.${id}`,root))])));
const mime = {ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'};
const server = createServer(async (req,res)=>{
  try {
    const url = new URL(req.url,'http://localhost');
    if (!/^\/[a-zA-Z0-9_./-]+$/.test(url.pathname) || url.pathname.includes('..')) throw Error('path');
    const bytes = await readFile(new URL('dist/chromium'+url.pathname,root));
    const type = url.pathname.endsWith('.html')?'text/html':url.pathname.endsWith('.css')?'text/css':/\.m?js$/.test(url.pathname)?'text/javascript':'application/octet-stream';
    res.writeHead(200,{'Content-Type':type,'Content-Security-Policy':"script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'none'"});res.end(bytes);
  } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await ({chromium,firefox}[engine]).launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined});
report.browserVersion=browser.version();
const context = await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:900}});
let activeFormat = 'pptx', bodyOverride = null;
await context.addInitScript(({origin})=>{
  window.chrome={runtime:{getURL:name=>`${origin}/${name}`},permissions:{contains:async()=>true},webRequest:{onBeforeRedirect:{addListener(){},removeListener(){}}}};
  window.workerStats={created:0,terminated:0};
  const OriginalWorker = window.Worker;
  window.Worker=class extends OriginalWorker {
    constructor(...args){super(...args);window.workerStats.created++;}
    terminate(){window.workerStats.terminated++;return super.terminate();}
  };
},{origin});
await context.route('**/*',async route=>{
  const url = new URL(route.request().url());
  if (url.origin===origin) return route.continue();
  if(url.origin==='https://elearning.fudan.edu.cn') {
    if(url.pathname==='/courses/123')return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="utf-8"></head><body><a id="fixture" href="/files/42?wrap=1">normal.${activeFormat}</a></body></html>`});
    if(url.pathname==='/files/42/download')return route.fulfill({body:bodyOverride||fixtures[activeFormat],contentType:mime[activeFormat]});
  }
  unexpected.push(url.href);return route.abort();
});
const page = await context.newPage();
page.on('pageerror',error=>errors.push(error.message));
const check=async(name,fn)=>{await fn();report.checks.push(name);console.log(`PASS ${engine}: ${name}`);};
const waitPage = n=>page.getByRole('status').filter({hasText:new RegExp(`^第 ${n} / 3 页$`)}).waitFor();
const slide = ()=>page.frameLocator('.presentation-reader iframe');
async function inspectReader(prefix,format) {
  await waitPage(1);
  assert.match(await slide().locator('svg').textContent(),/Hello, Canvas!/);
  assert.ok(await slide().locator('svg path, svg rect, svg ellipse').count());
  await page.screenshot({path:new URL(`${prefix}-${format}-1.png`,output).pathname});
  await page.getByRole('button',{name:'下一页',exact:true}).click();await waitPage(2);
  assert.equal(await slide().locator('svg image').count(),1);
  assert.match(await slide().locator('svg').textContent(),/Original raster image/);
  await page.screenshot({path:new URL(`${prefix}-${format}-2.png`,output).pathname});
  const input = page.getByRole('spinbutton',{name:'跳转到幻灯片页码'});
  await input.fill('3');await page.getByRole('button',{name:'跳转',exact:true}).click();await waitPage(3);
  assert.match(await slide().locator('svg').textContent(),/Format/);
  await page.screenshot({path:new URL(`${prefix}-${format}-3.png`,output).pathname});
  const before = await page.locator('.presentation-reader iframe').boundingBox();
  await page.getByRole('button',{name:'放大',exact:true}).click();
  const after = await page.locator('.presentation-reader iframe').boundingBox();assert.ok(after.width>before.width);
  await page.getByRole('button',{name:'适合窗口',exact:true}).click();
  await page.getByRole('button',{name:'上一页',exact:true}).click();await waitPage(2);
  assert.equal(await page.locator('.presentation-reader iframe').getAttribute('sandbox'),'');
}
try {
  for (const format of ['pptx','ppt']) await check(`extension ${format}: three pages, image, table, navigation, zoom, original bytes, cleanup`,async()=>{
    await page.goto(`${origin}/presentation-viewer.html?demo=${format}`);
    await inspectReader('extension',format);
    const pending=page.waitForEvent('download');await page.locator('#download').click();const download=await pending;
    const chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks),fixtures[format]);
    await page.locator('#cancel').click();assert.equal(await page.locator('.presentation-reader').count(),0);
    assert.equal(await page.locator('#retry').isVisible(),true);
    assert.deepEqual(await page.evaluate(()=>window.workerStats),{created:1,terminated:1});
  });
  await check('extension invalid/mismatched query and unreadable container show retry without download',async()=>{
    await page.goto(`${origin}/presentation-viewer.html?demo=ppt&format=pptx`);
    await page.getByText('暂时无法预览',{exact:true}).waitFor();assert.equal(await page.locator('#download').isVisible(),false);
    activeFormat='ppt';bodyOverride=Buffer.from('d0cf11e0a1b11ae1','hex');
    const source='https://elearning.fudan.edu.cn/files/42/download';
    await page.goto(`${origin}/presentation-viewer.html?format=ppt&name=normal.ppt&source=${encodeURIComponent(source)}&original=${encodeURIComponent(source)}`);
    await page.getByText('暂时无法预览',{exact:true}).waitFor();assert.equal(await page.locator('#download').isVisible(),false);assert.equal(await page.locator('#original').isVisible(),true);
    bodyOverride=null;
  });
  const script=await readFile(new URL('elearning-pdf-preview.user.js',root),'utf8');
  for(const format of ['pptx','ppt'])await check(`userscript ${format}: actual modal, pages, controls, close and reopen`,async()=>{
    activeFormat=format;await page.goto('https://elearning.fudan.edu.cn/courses/123');
    await page.addScriptTag({content:script});await page.locator('#fixture').click();
    await inspectReader('userscript',format);
    assert.equal(await page.locator('.fdpdf-download').isVisible(),true);
    assert.equal(await page.evaluate(()=>window.CanvasFileFormats),undefined);
    await page.getByRole('button',{name:'关闭',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.workerStats),{created:1,terminated:1});
    assert.equal(await page.locator('.presentation-reader').count(),0);
    await page.locator('#fixture').click();await waitPage(1);
    await page.locator('[data-action="presentation-cancel"]').click();
    assert.equal(await page.locator('[data-action="presentation-retry"]').isVisible(),true);
    await page.locator('[data-action="presentation-retry"]').click();await waitPage(1);
    await page.getByRole('button',{name:'关闭',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.workerStats),{created:3,terminated:3});
  });
  assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);report.passed=true;
}catch(error){report.error=error.stack;report.pageErrors=errors;process.exitCode=1;console.error(error);await page.screenshot({path:new URL('failure.png',output).pathname}).catch(()=>{});}
finally{await writeFile(new URL('result.json',output),JSON.stringify(report,null,2));await browser.close();await new Promise(resolve=>server.close(resolve));}
