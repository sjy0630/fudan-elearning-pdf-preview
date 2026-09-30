const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = path.join(__dirname, '../shared/formats.js');
const context = { TextDecoder, Uint8Array, ArrayBuffer };
vm.createContext(context);
if (fs.existsSync(source)) vm.runInContext(fs.readFileSync(source, 'utf8'), context);
const api = () => { assert.ok(context.CanvasFileFormats, 'shared format API exists'); return context.CanvasFileFormats; };
const bytes = s => Buffer.from(s);
const png = (w=1,h=1) => { const b=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489','hex'); b.writeUInt32BE(w,16); b.writeUInt32BE(h,20); return b; };
const jpeg = (w=1,h=1) => { const b=Buffer.from('ffd8ffc00011080001000103011100021100031100ffd9','hex'); b.writeUInt16BE(h,7); b.writeUInt16BE(w,9); return b; };
function chunk(tag,b) { const n=Buffer.alloc(8); n.write(tag); n.writeUInt32LE(b.length,4); return Buffer.concat([n,b,Buffer.alloc(b.length%2)]); }
function webpChunks(...cs) { const b=Buffer.concat([bytes('WEBP'),...cs]); const r=Buffer.alloc(8); r.write('RIFF');r.writeUInt32LE(b.length,4); return Buffer.concat([r,b]); }
function webp(kind='VP8X',w=1,h=1) { let b;
 if(kind==='VP8X') { b=Buffer.alloc(10);b.writeUIntLE(w-1,4,3);b.writeUIntLE(h-1,7,3); }
 if(kind==='VP8L') { b=Buffer.alloc(5);b[0]=0x2f;b.writeUInt32LE(((w-1)|((h-1)<<14))>>>0,1); }
 if(kind==='VP8 ') { b=Buffer.from('1000009d012a01000100','hex');b.writeUInt16LE(w,6);b.writeUInt16LE(h,8); }
 return webpChunks(chunk(kind,b)); }

test('identifies only final supported suffixes and freezes descriptors', () => {
 const f=api();
 for(const [id,exts] of Object.entries({pdf:['pdf'],png:['png'],jpeg:['jpg','jpeg'],webp:['webp'],text:['txt','csv','log','json','xml','yaml','yml','c','h','cpp','hpp','py','js','ts','java','css','sql','sh']})) {
  for(const ext of exts) assert.equal(f.identify('notes.'+ext.toUpperCase()).id,id);
  const d=f.get(id);assert.ok(Object.isFrozen(d));assert.ok(Object.isFrozen(d.extensions));assert.equal(d.id,id);
 }
 for(const n of ['a.txt.exe','pdf','a.pdf/other','a.docx','x.png?download']) assert.equal(f.identify(n),null);
 assert.equal(f.get('unknown'),null);assert.equal(f.get('toString'),null);
 assert.equal(f.get('pdf').limit,100*1024*1024);assert.equal(f.get('text').limit,2*1024*1024);assert.equal(f.get('png').limit,20*1024*1024);
});
test('safe filenames sanitize unsafe characters without inventing PDF extensions',()=>{
 const f=api();assert.equal(f.safeName('a/b\\c\u0000.png','png'),'a_b_c_.png');
 assert.equal(f.safeName('report.TXT','text'),'report.TXT');assert.equal(f.safeName('notes','text'),'notes.txt');
 assert.equal(f.safeName('image.exe','png'),'image.exe.png');assert.throws(()=>f.safeName('x','unknown'),/不支持/);
});
test('validates PDF content, type, MIME, and size',()=>{
 const f=api();assert.equal(f.validate(bytes('%PDF-1.7\n'),'pdf').mime,'application/pdf');
 assert.equal(f.validate(bytes('%PDF-1.7'),'pdf','application/octet-stream').mime,'application/pdf');
 for(const [b,m] of [[bytes('<html>login</html>'),''],[bytes('%PDF-1.7'),'text/html'],[png(),'image/png']])assert.throws(()=>f.validate(b,'pdf',m));
 assert.throws(()=>f.validate(bytes('a'),'unknown'),/不支持/);
 const b=Buffer.alloc(100*1024*1024+1); b.write('%PDF-');assert.throws(()=>f.validate(b,'pdf'),/大小|超过/);
});
test('parses PNG, JPEG, and all WebP dimension headers',()=>{
 const f=api();for(const [id,b] of [['png',png(23,42)],['jpeg',jpeg(23,42)],...['VP8X','VP8L','VP8 '].map(k=>['webp',webp(k,23,42)])]){
  const r=f.validate(b,id);assert.equal(r.width,23);assert.equal(r.height,42);assert.equal(r.mime,f.get(id).mime);
  assert.throws(()=>f.validate(b,id,'text/html'));assert.throws(()=>f.validate(b.subarray(0,b.length-5),id));
 }
 assert.throws(()=>f.validate(png(),'jpeg'));assert.throws(()=>f.validate(png(),'png','image/jpeg'));
 const bad=png();bad.write('IDAT',12);assert.throws(()=>f.validate(bad,'png'));
 const short=jpeg();short.writeUInt16BE(2,4);assert.throws(()=>f.validate(short,'jpeg'));
});
test('rejects excess image dimensions, accepts exact boundaries',()=>{
 const f=api();for(const [id,make] of [['png',png],['jpeg',jpeg],['webp',(w,h)=>webp('VP8X',w,h)]]){
  for(const [w,h] of [[0,1],[1,0],[16385,1],[8000,5001]]) { if(id==='webp' && !w*h)continue;assert.throws(()=>f.validate(make(w,h),id)); }
  for(const [w,h] of [[16384,1],[8000,5000]])assert.equal(f.validate(make(w,h),id).width,w);
 }
 const b=Buffer.alloc(20*1024*1024+1);png().copy(b);assert.throws(()=>f.validate(b,'png'),/大小|超过/);
});
test('checks every WebP chunk and rejects animated or malformed containers',()=>{
 const f=api();const base=webp().subarray(12);
 for(const c of [chunk('ANIM',Buffer.alloc(6)),chunk('ANMF',Buffer.alloc(16))]) assert.throws(()=>f.validate(webpChunks(base,c),'webp'),/动画/);
 const animated=webp();animated[20]=2;assert.throws(()=>f.validate(animated,'webp'),/动画/);
 const truncated=webpChunks(base,chunk('JUNK',bytes('xx')));truncated.writeUInt32LE(100,truncated.length-6);assert.throws(()=>f.validate(truncated,'webp'));
 const malformed=webp();malformed.writeUInt32LE(1,4);assert.throws(()=>f.validate(malformed,'webp'));
});
test('rejects reserved or invisible VP8 frame headers',()=>{
 const f=api();for(const flag of [0, 0x18, 0x11]) { const b=webp('VP8 ');b[20]=flag;assert.throws(()=>f.validate(b,'webp')); }
});
test('text validation allows empty and defers decoding, but checks MIME and size',()=>{
 const f=api();for(const m of ['', 'text/plain; charset=utf-8','application/json','application/xml','text/csv','application/octet-stream'])assert.equal(f.validate(Buffer.alloc(0),'text',m).mime,'text/plain');
 assert.equal(f.validate(Buffer.from([0xff]),'text').mime,'text/plain');
 for(const m of ['text/html','application/xhtml+xml','image/png','application/pdf'])assert.throws(()=>f.validate(bytes('hello'),'text',m));
 assert.throws(()=>f.validate(Buffer.alloc(2*1024*1024+1),'text'),/大小|超过/);
});
test('decodes strict UTF8, BOM UTF16, and explicit GB18030 Chinese',()=>{
 const f=api();assert.equal(f.decodeText(bytes('中文\nhello')),'中文\nhello');
 assert.equal(f.decodeText(Buffer.concat([Buffer.from([239,187,191]),bytes('中文')])),'中文');
 assert.equal(f.decodeText(Buffer.from('fffe2d4e8765','hex')),'中文');assert.equal(f.decodeText(Buffer.from('feff4e2d6587','hex')),'中文');
 assert.equal(f.decodeText(Buffer.from('d6d0cec4','hex'),'gb18030'),'中文');assert.equal(f.decodeText(Buffer.alloc(0)),'');
 for(const b of [Buffer.from([0xff]),Buffer.from([0xc0,0xaf]),Buffer.from([0xe4,0xb8])])assert.throws(()=>f.decodeText(b),/编码/);
 assert.throws(()=>f.decodeText(Buffer.from([0x81]),'gb18030'),/编码/);assert.throws(()=>f.decodeText(bytes('x'),'latin1'),/编码/);
 assert.throws(()=>f.decodeText(Buffer.from('fffe00d8','hex')),/编码/);assert.throws(()=>f.decodeText(Buffer.from('feff00','hex')),/编码/);
});
test('rejects binary controls and likely login HTML but preserves literal script text',()=>{
 const f=api();for(const s of ['a\u0000b','a\u0001b','a\u007fb','a\u0085b','<!DOCTYPE html><html>login','  <html><body>login','<form action="login">','<head><title>login','<body>login'])assert.throws(()=>f.decodeText(bytes(s)));
 for(const s of ['<script>alert(1)</script>','a\tline\r\n','<root>XML</root>'])assert.equal(f.decodeText(bytes(s)),s);
});
