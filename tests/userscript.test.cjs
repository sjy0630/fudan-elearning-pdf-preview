const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '..', 'elearning-pdf-preview.user.js');
const source = fs.readFileSync(scriptPath, 'utf8');
const instrumented = source.replace(
  /\}\)\(\);\s*$/,
  'globalThis.__testExports = { pdfLinkFromClick, retrievePdf };})();',
);
assert.notEqual(instrumented, source, 'the userscript wrapper must be instrumented');

function loadScript(overrides = {}) {
  const context = {
    URL,
    Blob,
    AbortController,
    DOMException,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    setTimeout,
    clearTimeout,
    location: {
      origin: 'https://elearning.fudan.edu.cn',
      href: 'https://elearning.fudan.edu.cn/courses/12345/assignments/24680',
    },
    document: { addEventListener() {} },
    window: { addEventListener() {} },
    ...overrides,
  };
  vm.runInNewContext(instrumented, context, { filename: scriptPath });
  return context.__testExports;
}

function clickFor(href, textContent, options = {}) {
  const link = {
    nodeType: 1,
    href,
    textContent,
    title: '',
    dataset: {},
    hasAttribute: () => Boolean(options.download),
    matches: () => Boolean(options.downloadControl),
    closest: () => link,
  };
  return {
    button: 0,
    defaultPrevented: false,
    target: link,
    ...options.event,
  };
}

test('recognizes the assignment PDF and derives its download endpoint', () => {
  const { pdfLinkFromClick } = loadScript();
  const result = pdfLinkFromClick(clickFor(
    'https://elearning.fudan.edu.cn/courses/12345/files/67890?wrap=1',
    '示例讲义.pdf',
  ));
  assert.equal(result.name, '示例讲义.pdf');
  assert.equal(result.downloadUrl.href,
    'https://elearning.fudan.edu.cn/courses/12345/files/67890/download?download_frd=1');
});

test('same final-suffix whitelist, exact Canvas routes and verifier preservation', () => {
  const { pdfLinkFromClick: identify } = loadScript();
  for (const suffix of ['png','jpg','jpeg','webp','txt','csv','log','json','xml','yaml','yml','c','h','cpp','hpp','py','js','ts','java','css','sql','sh','pdf']) {
    const file = identify(clickFor('https://elearning.fudan.edu.cn/files/12/preview?verifier=a%2Bb', 'example.' + suffix));
    assert.ok(file, suffix);
    assert.equal(file.downloadUrl.searchParams.get('verifier'), 'a+b');
  }
  for (const href of ['https://user:pass@elearning.fudan.edu.cn/files/12', 'https://elearning.fudan.edu.cn/files/12/nonsense', 'https://evil.test/files/12']) assert.equal(identify(clickFor(href,'x.pdf')),null);
  for (const name of ['x.pdf.exe','x.svg','x.html','x.pdf extra']) assert.equal(identify(clickFor('https://elearning.fudan.edu.cn/files/12',name)),null);
  assert.equal(identify(clickFor('https://elearning.fudan.edu.cn/static/name.txt','View file')).name,'name.txt');
});

const fileFor = format => ({ format, downloadUrl: new URL('https://elearning.fudan.edu.cn/files/12/download') });
test('fetch checks declared and streamed per-format limits without GM fallback', async () => {
  let gm = 0, cancelled = false;
  const response = () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(2*1024*1024+1)); }, cancel() { cancelled = true; } }));
  const api = loadScript({ fetch: async () => response(), GM_xmlhttpRequest: () => gm++ });
  await assert.rejects(api.retrievePdf(fileFor('text'), new AbortController().signal), /超过/);
  assert.ok(cancelled); assert.equal(gm,0);
  const declared = loadScript({ fetch: async () => new Response('ok',{headers:{'content-length':String(20*1024*1024+1)}}), GM_xmlhttpRequest: () => gm++ });
  await assert.rejects(declared.retrievePdf(fileFor('png'),new AbortController().signal), /超过/);
  assert.equal(gm,0);
});

test('body read failures and HTTP errors never trigger privileged retries', async () => {
  let gm = 0;
  const api = loadScript({ fetch: async () => new Response(new ReadableStream({ start(c) { c.error(new TypeError('broken body')); } })), GM_xmlhttpRequest: () => gm++ });
  await assert.rejects(api.retrievePdf(fileFor('text'),new AbortController().signal),/broken body/);
  const forbidden = loadScript({ fetch: async () => new Response('',{status:403}), GM_xmlhttpRequest: () => gm++ });
  await assert.rejects(forbidden.retrievePdf(fileFor('text'),new AbortController().signal),/权限/);
  assert.equal(gm,0);
});

test('oversize errors tell the user the selected format limit', async () => {
  for (const [format,limit] of [['text',2],['png',20],['pdf',100]]) {
    const api=loadScript({fetch:async()=>new Response('',{headers:{'content-length':String(limit*1024*1024+1)}})});
    await assert.rejects(api.retrievePdf(fileFor(format),new AbortController().signal),new RegExp(`${limit} MiB`));
  }
});

test('GM headers, progress and timeout reject once and abort the request', async () => {
  for (const trigger of [o => o.onreadystatechange({responseHeaders:'Content-Length: 2097153\r\n'}),o => o.onprogress({loaded:2097153}),o => o.ontimeout()]) {
    let options, aborted=0;
    const api = loadScript({fetch:async()=>{throw new TypeError('blocked');},GM_xmlhttpRequest:o=>{options=o;return{abort(){aborted++;options.onabort();}};}});
    const pending=api.retrievePdf(fileFor('text'),new AbortController().signal);
    await new Promise(setImmediate);trigger(options);options.onload({status:200,response:new Blob(['late'])});
    await assert.rejects(pending,/超过|超时/);assert.equal(aborted,1);
  }
});

test('rejects suffix-bearing fake Canvas subroutes', () => {
  const {pdfLinkFromClick}=loadScript();
  assert.equal(pdfLinkFromClick(clickFor('https://elearning.fudan.edu.cn/files/12/nonsense.txt','x.txt')),null);
});
test('GM preserves MIME, rejects final size and ignores late callbacks after abort', async () => {
  let callbacks, aborted = 0;
  const api = loadScript({ fetch: async () => { throw new TypeError('CORS'); }, GM_xmlhttpRequest: options => { callbacks=options; return {abort(){aborted++;}}; } });
  const control = new AbortController(); const pending = api.retrievePdf(fileFor('text'),control.signal);
  await new Promise(setImmediate); control.abort(); callbacks.onload({status:200,response:new Blob(['late'])});
  await assert.rejects(pending,{name:'AbortError'}); assert.equal(aborted,1);
  const success = api.retrievePdf(fileFor('text'),new AbortController().signal); await new Promise(setImmediate);
  callbacks.onload({status:200,response:new Blob(['hello'],{type:'text/plain'})});
  assert.equal((await success).type,'text/plain');
  const large = api.retrievePdf(fileFor('text'),new AbortController().signal); await new Promise(setImmediate);
  callbacks.onload({status:200,response:new Blob([new Uint8Array(2*1024*1024+1)])});
  await assert.rejects(large,/超过/); assert.equal(aborted,2);
});

test('leaves download controls, non-PDF files and modified clicks alone', () => {
  const { pdfLinkFromClick } = loadScript();
  const href = 'https://elearning.fudan.edu.cn/courses/12345/files/67890?wrap=1';
  assert.equal(pdfLinkFromClick(clickFor(href, '示例讲义.pdf', { downloadControl: true })), null);
  assert.equal(pdfLinkFromClick(clickFor(href, '作业说明.docx')), null);
  assert.equal(pdfLinkFromClick(clickFor(href, '示例讲义.pdf', { event: { ctrlKey: true } })), null);
  assert.equal(pdfLinkFromClick(clickFor('https://example.com/file.pdf', 'file.pdf')), null);
});

test('recognizes a direct same-origin PDF URL', () => {
  const { pdfLinkFromClick } = loadScript();
  const result = pdfLinkFromClick(clickFor(
    'https://elearning.fudan.edu.cn/resources/handout.pdf', 'handout.pdf'));
  assert.equal(result.downloadUrl.href, 'https://elearning.fudan.edu.cn/resources/handout.pdf');
});

test('uses Tampermonkey only when browser fetch is blocked by a redirect', async () => {
  const pdf = new Blob(['%PDF-1.7\nexample'], { type: 'application/pdf' });
  let requestedUrl = '';
  const { retrievePdf } = loadScript({
    fetch: async () => { throw new TypeError('CORS blocked'); },
    GM_xmlhttpRequest: ({ url, onload }) => {
      requestedUrl = url;
      queueMicrotask(() => onload({ status: 200, response: pdf }));
      return { abort() {} };
    },
  });
  const file = {
    downloadUrl: new URL('https://elearning.fudan.edu.cn/courses/12345/files/67890/download?download_frd=1'),
  };
  const result = await retrievePdf(file, new AbortController().signal);
  assert.equal(requestedUrl, file.downloadUrl.href);
  assert.equal((await result.text()).startsWith('%PDF-'), true);
});
