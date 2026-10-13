const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const file = path.join(__dirname, '../shared/docx-convert.mjs');
const api = async () => fs.existsSync(file) ? import(pathToFileURL(file).href) : {};
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures/docx', name));
const helpers = () => import('../scripts/docx-fixtures.mjs');
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const convertVariant = async edit => {
  const h = await helpers();
  const parts = await h.readFixtureParts();
  await edit(parts, h);
  return (await api()).convertDocx(h.zipFixtureParts(parts));
};

async function relocateFixtureParts(parts, mapping, h) {
  const { verifyDocxPackage } = await import('../shared/docx-package.mjs');
  const verified = verifyDocxPackage(h.zipFixtureParts(parts));
  h.editFixtureXml(parts, '[Content_Types].xml', doc => {
    for (const node of doc.getElementsByTagName('Override')) {
      const old = node.getAttribute('PartName').slice(1);
      if (mapping.has(old)) node.setAttribute('PartName', '/' + mapping.get(old));
    }
  });
  for (const [name, entries] of verified.relationships) h.editFixtureXml(parts, name, doc => {
    for (const node of doc.getElementsByTagName('Relationship')) {
      const entry = entries.find(entry => entry.id === node.getAttribute('Id'));
      if (!entry.external) node.setAttribute('Target', '/' + (mapping.get(entry.target) || entry.target) + (entry.fragment ? '#' + entry.fragment : ''));
    }
  });
  for (const [old, next] of mapping) { parts.set(next, parts.get(old)); parts.delete(old); }
}

async function htmlNodeCount(html) {
  const { DOMParser } = await import('@xmldom/xmldom');
  const root = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').documentElement;
  let count = 0;
  const pending = [...root.childNodes];
  while (pending.length) {
    const node = pending.pop();
    count += 1 + (node.attributes?.length || 0);
    pending.push(...node.childNodes);
  }
  return count;
}

test('bounded local DOCX converter is exported', async () => {
  const m = await api();
  assert.equal(typeof m.convertDocx, 'function', 'convertDocx export must exist');
});

test('real generated DOCX preserves semantic text, notes, tables and original image bytes', async () => {
  const bytes = fixture('normal.docx'); const original = Buffer.from(bytes);
  const events = [];
  const result = await (await api()).convertDocx(bytes, { idPrefix: 'course-', onVerified: () => events.push('verified') });
  assert.deepEqual(events, ['verified']); assert.deepEqual(bytes, original);
  for (const pattern of [/<h1>第一章 本地阅读<\/h1>/, /<h2>阅读步骤与材料<\/h2>/, /<strong>粗体重点<\/strong>/, /<em>斜体说明<\/em>/, /<u>下划线提示<\/u>/, /<sup>2<\/sup>/, /<sub>2<\/sub>/, /<ol>.*<ol>/, /<ul>.*<ul>/, /colspan="2"/, /rowspan="2"/, /脚注：课程材料/, /尾注：原创图片/]) assert.match(result.html, pattern);
  assert.equal(result.images.length, 2);
  for (const [i, name] of ['learning-chart.png', 'mountain-landscape.jpg'].entries()) {
    const image = result.images[i]; assert.equal(image.id, `docx-image-${i + 1}`);
    assert.deepEqual(image.bytes, new Uint8Array(fixture(name)));
    assert.equal(image.bytes.byteOffset, 0); assert.equal(image.bytes.buffer.byteLength, image.bytes.byteLength);
    assert.match(result.html, new RegExp(`src="${image.id}"`));
  }
  assert.notEqual(result.images[0].bytes.buffer, result.images[1].bytes.buffer);
  assert.doesNotMatch(result.html, /src="(?:data:|https?:|file:|blob:)/);
  assert.deepEqual(result.warnings, []);
});

test('conversion supports relocated main, notes and cross-directory images through normalized relationships', async () => {
  const result = await convertVariant(async (parts, h) => {
    const mapping = new Map([['word/document.xml', 'chapters/main.xml'], ['word/_rels/document.xml.rels', 'chapters/_rels/main.xml.rels'], ['word/footnotes.xml', 'notes/foot.xml'], ['word/_rels/footnotes.xml.rels', 'notes/_rels/foot.xml.rels'], ['word/endnotes.xml', 'notes/end.xml'], ['word/_rels/endnotes.xml.rels', 'notes/_rels/end.xml.rels']]);
    for (const name of [...parts.keys()]) if (name.startsWith('word/media/')) mapping.set(name, `assets/${name.split('/').pop()}`);
    const { verifyDocxPackage } = await import('../shared/docx-package.mjs');
    const checked=verifyDocxPackage(h.zipFixtureParts(parts));
    h.editFixtureXml(parts,'[Content_Types].xml',doc=>{for(const n of doc.getElementsByTagName('Override')) {const name=n.getAttribute('PartName').slice(1); if(mapping.has(name)) n.setAttribute('PartName','/'+mapping.get(name));}});
    for(const [name,entries] of checked.relationships) h.editFixtureXml(parts,name,doc=>{for(const n of doc.getElementsByTagName('Relationship')) {const rel=entries.find(r=>r.id===n.getAttribute('Id')); if(!rel.external) n.setAttribute('Target','/'+(mapping.get(rel.target)||rel.target));}});
    for(const [old,next] of mapping) {parts.set(next,parts.get(old));parts.delete(old);}
  });
  assert.match(result.html, /脚注：课程材料/); assert.equal(result.images.length, 2);
});

test('encoded root and owner relationship filenames normalize without changing original package keys or bytes', async () => {
  const h = await helpers();
  for (const basename of ['course notes.xml', 'a%20b.xml', '中文讲义.xml', '__proto__']) {
    const parts = await h.readFixtureParts();
    let drawings;
    h.editFixtureXml(parts, 'word/document.xml', doc => { drawings = [...doc.getElementsByTagName('w:drawing')].map(node => node.cloneNode(true)); });
    for (const [i, noteName] of ['footnotes', 'endnotes'].entries()) {
      const imagePath = [...parts.keys()].find(name => name.endsWith(i ? '.jpeg' : '.png') || i && name.endsWith('.jpg'));
      h.editFixtureXml(parts, `word/${noteName}.xml`, doc => {
        const note = [...doc.getElementsByTagName('w:' + noteName.slice(0, -1))].find(node => node.getAttribute('w:id') === '1');
        const drawing = doc.importNode(drawings[i], true); drawing.getElementsByTagName('a:blip')[0].setAttribute('r:embed', 'noteImage');
        const paragraph = doc.createElementNS(W, 'w:p'), run = doc.createElementNS(W, 'w:r'); run.appendChild(drawing); paragraph.appendChild(run); note.appendChild(paragraph);
      });
      h.editFixtureXml(parts, `word/_rels/${noteName}.xml.rels`, doc => {
        const node = doc.createElement('Relationship'); node.setAttribute('Id', 'noteImage'); node.setAttribute('Type', h.R + 'image'); node.setAttribute('Target', '/' + imagePath); doc.documentElement.appendChild(node);
      });
    }
    const encoded = encodeURIComponent(decodeURIComponent(basename));
    const mapping = new Map([
      ['word/document.xml', 'chapters/' + basename],
      ['word/_rels/document.xml.rels', 'chapters/_rels/' + encoded + '.rels'],
      ['_rels/.rels', '_rels/%2erels'],
      ['word/footnotes.xml', 'notes/脚注%20part.xml'],
      ['word/_rels/footnotes.xml.rels', 'notes/_rels/%E8%84%9A%E6%B3%A8%20part.xml.rels'],
      ['word/endnotes.xml', 'notes/尾注 part.xml'],
      ['word/_rels/endnotes.xml.rels', 'notes/_rels/%E5%B0%BE%E6%B3%A8%20part.xml.rels'],
    ]);
    // Relocation follows actual verified targets, not textual URI spellings.
    await relocateFixtureParts(parts, mapping, h);
    h.editFixtureXml(parts, '[Content_Types].xml', doc => {
      for (const name of [...mapping.values()].filter(name => name.includes('_rels/'))) {
        const node = doc.createElement('Override'); node.setAttribute('PartName', '/' + name);
        node.setAttribute('ContentType', 'application/vnd.openxmlformats-package.relationships+xml'); doc.documentElement.appendChild(node);
      }
    });
    const bytes = h.zipFixtureParts(parts), before = bytes.slice();
    const originalParts = [...parts].map(([name, value]) => [name, value.slice()]);
    const result = await (await api()).convertDocx(bytes);
    assert.match(result.html, /第一章 本地阅读/); assert.match(result.html, /脚注：课程材料/); assert.match(result.html, /尾注：原创图片/);
    assert.deepEqual(result.images.map(image => image.bytes), ['learning-chart.png', 'mountain-landscape.jpg', 'learning-chart.png', 'mountain-landscape.jpg'].map(name => new Uint8Array(fixture(name))));
    assert.deepEqual(bytes, before); assert.deepEqual([...parts], originalParts);
    assert.ok(parts.has('_rels/%2erels')); assert.ok(parts.has('chapters/_rels/' + encoded + '.rels'));
  }
});

test('validated image MIME survives encoded filename extensions without changing bytes', async () => {
  const h = await helpers(), parts = await h.readFixtureParts();
  const png = [...parts.keys()].find(name => name.endsWith('.png'));
  await relocateFixtureParts(parts, new Map([[png, 'assets/学习图.%70ng']]), h);
  const bytes = h.zipFixtureParts(parts), original = bytes.slice();
  const result = await (await api()).convertDocx(bytes);
  assert.equal(result.images.length, 2); assert.equal(result.images[0].mime, 'image/png');
  assert.deepEqual(result.images[0].bytes, new Uint8Array(fixture('learning-chart.png')));
  assert.deepEqual(bytes, original); assert.ok(parts.has('assets/学习图.%70ng'));
});

test('adding a conversion-only image MIME override cannot exceed the XML byte budget', async () => {
  const h = await helpers(), parts = await h.readFixtureParts(); let verified = 0;
  const png = [...parts.keys()].find(name => name.endsWith('.png'));
  await relocateFixtureParts(parts, new Map([[png, 'assets/diagram.%70ng']]), h);
  const { verifyDocxPackage } = await import('../shared/docx-package.mjs');
  const normalized = verifyDocxPackage(h.zipFixtureParts(parts)).xmlParts.get('[Content_Types].xml');
  const padded = normalized.replace('</Types>', ' '.repeat(4 * 1024 * 1024 - Buffer.byteLength(normalized)) + '</Types>');
  assert.equal(Buffer.byteLength(padded), 4 * 1024 * 1024); parts.set('[Content_Types].xml', Buffer.from(padded));
  await assert.rejects((await api()).convertDocx(h.zipFixtureParts(parts, 0), { onVerified() { verified++; } }), /转换副本 XML.*4 MiB/);
  assert.equal(verified, 1);
});

test('conversion rejects more than 50000 output nodes even below the HTML byte limit', async () => {
  const h = await helpers(), parts = await h.readFixtureParts(); let verified = 0;
  h.editFixtureXml(parts, 'word/footnotes.xml', doc => {
    const note = [...doc.getElementsByTagName('w:footnote')].find(node => node.getAttribute('w:id') === '1');
    const paragraph = note.getElementsByTagName('w:p')[0];
    for (let i = 0; i < 999; i++) note.appendChild(paragraph.cloneNode(true));
  });
  h.editFixtureXml(parts, 'word/document.xml', doc => {
    const paragraph = doc.getElementsByTagName('w:p')[0], reference = doc.getElementsByTagName('w:footnoteReference')[0];
    for (let i = 0; i < 30; i++) { const run = doc.createElementNS(W, 'w:r'); run.appendChild(reference.cloneNode(true)); paragraph.appendChild(run); }
  });
  await assert.rejects((await api()).convertDocx(h.zipFixtureParts(parts), { onVerified() { verified++; } }), /转换 HTML 节点.*50000/);
  assert.equal(verified, 1);
});

test('output budget includes text and attributes, accepts exactly 50000 and rejects one more', async () => {
  const h = await helpers(), parts = await h.readFixtureParts(), m = await api();
  h.editFixtureXml(parts, 'word/footnotes.xml', doc => {
    const note = [...doc.getElementsByTagName('w:footnote')].find(node => node.getAttribute('w:id') === '1');
    const paragraph = note.getElementsByTagName('w:p')[0];
    for (let i = 0; i < 999; i++) note.appendChild(paragraph.cloneNode(true));
  });
  h.editFixtureXml(parts, 'word/document.xml', doc => {
    const paragraph = doc.getElementsByTagName('w:p')[0], reference = doc.getElementsByTagName('w:footnoteReference')[0];
    for (let i = 0; i < 20; i++) { const run = doc.createElementNS(W, 'w:r'); run.appendChild(reference.cloneNode(true)); paragraph.appendChild(run); }
  });
  const base = await m.convertDocx(h.zipFixtureParts(parts));
  const delta = 50000 - await htmlNodeCount(base.html);
  assert.ok(delta > 3);
  h.editFixtureXml(parts, 'word/document.xml', doc => {
    const body = doc.getElementsByTagName('w:body')[0];
    const add = bold => {
      const p = doc.createElementNS(W, 'w:p'), r = doc.createElementNS(W, 'w:r'), t = doc.createElementNS(W, 'w:t'); t.textContent = '边界';
      if (bold) { const props = doc.createElementNS(W, 'w:rPr'); props.appendChild(doc.createElementNS(W, 'w:b')); r.appendChild(props); }
      r.appendChild(t); p.appendChild(r); body.insertBefore(p, body.lastChild);
    };
    if (delta % 2) add(true);
    for (let i = 0; i < (delta - (delta % 2 ? 3 : 0)) / 2; i++) add(false);
  });
  const exact = await m.convertDocx(h.zipFixtureParts(parts));
  assert.equal(await htmlNodeCount(exact.html), 50000); assert.ok(Buffer.byteLength(exact.html) < 4 * 1024 * 1024);
  h.editFixtureXml(parts, 'word/document.xml', doc => {
    const paragraphs = doc.getElementsByTagName('w:p'), run = paragraphs[paragraphs.length - 1].getElementsByTagName('w:r')[0];
    const props = doc.createElementNS(W, 'w:rPr'); props.appendChild(doc.createElementNS(W, 'w:b')); run.insertBefore(props, run.firstChild);
  });
  await assert.rejects(m.convertDocx(h.zipFixtureParts(parts)), /转换 HTML 节点.*50000/);
});

test('Strict relationship types and UTF16 source XML preserve genuine semantics', async () => {
  const result = await convertVariant((parts, h) => {
    for (const [name, bytes] of parts) if (/\.(xml|rels)$/.test(name)) {
      let source = Buffer.from(bytes).toString().replaceAll(h.R, h.RS).replaceAll('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main');
      if (['word/document.xml', '_rels/.rels', 'word/_rels/document.xml.rels'].includes(name)) parts.set(name, Buffer.concat([Buffer.from([255, 254]), Buffer.from(source.replace(/<\?xml[^?]*\?>/, ''), 'utf16le')]));
      else parts.set(name, Buffer.from(source));
    }
  });
  assert.match(result.html, /第一章 本地阅读/); assert.match(result.html, /尾注：原创图片/); assert.equal(result.images.length, 2);
});

test('XML 1.0 NEL, LS, PS and CDATA survive the actual converter including image attributes', async () => {
  const text = '甲\u0085乙\u2028丙\u2029丁';
  const result = await convertVariant((parts, h) => h.editFixtureXml(parts, 'word/document.xml', doc => {
    const t = doc.getElementsByTagName('w:t')[2]; t.textContent = text;
    const next = doc.getElementsByTagName('w:t')[3]; next.textContent = ''; next.appendChild(doc.createCDATASection(text));
    doc.getElementsByTagName('wp:docPr')[0].setAttribute('descr', text);
  }));
  assert.ok(result.html.includes(`<p>${text}</p>`)); assert.ok(result.html.includes(`<strong>${text}</strong>`)); assert.ok(result.html.includes(`alt="${text}"`));
});

test('external images and unsupported images are inert placeholders and warnings are fixed', async () => {
  const result = await convertVariant((parts, h) => h.editFixtureXml(parts, 'word/_rels/document.xml.rels', doc => {
    const images = [...doc.getElementsByTagName('Relationship')].filter(n => n.getAttribute('Type').endsWith('/image'));
    images[0].setAttribute('TargetMode', 'External'); images[0].setAttribute('Target', 'file:///secret/<script>');
  }));
  assert.equal(result.images.length, 1); assert.match(result.html, /图片暂不支持预览/);
  assert.ok(result.warnings.some(w => /外部图片/.test(w))); assert.ok(result.warnings.every(w => !/secret|script/.test(w)));
});

test('unsafe embedded style maps are ignored and external hyperlinks retain text with warnings', async () => {
  const result = await convertVariant((parts, h) => {
    parts.set('mammoth/style-map', Buffer.from("p => script:fresh"));
    h.editFixtureXml(parts, '[Content_Types].xml', doc => { const n = doc.createElement('Override'); n.setAttribute('PartName', '/mammoth/style-map'); n.setAttribute('ContentType', 'text/plain'); doc.documentElement.appendChild(n); });
    h.editFixtureXml(parts, 'word/_rels/document.xml.rels', doc => { const n = doc.createElement('Relationship'); for (const [k,v] of Object.entries({Id:'evilLink', Type:h.R+'hyperlink', Target:'javascript:alert(1)', TargetMode:'External'})) n.setAttribute(k,v); doc.documentElement.appendChild(n); });
    h.editFixtureXml(parts, 'word/document.xml', doc => { const p=doc.getElementsByTagName('w:p')[2], link=doc.createElementNS(W,'w:hyperlink'); link.setAttribute('r:id','evilLink'); while(p.lastChild) link.insertBefore(p.lastChild,link.firstChild); p.appendChild(link); });
  });
  assert.match(result.html, /真实的中文/); assert.doesNotMatch(result.html, /<script|javascript:/);
  assert.ok(result.warnings.some(w => /超链接/.test(w))); assert.ok(result.warnings.length <= 32);
});

test('invalid packages never emit verified, whereas later conversion limits preserve verified', async () => {
  const m = await api(); let verified = 0;
  await assert.rejects(m.convertDocx(Uint8Array.of(1,2,3), {onVerified(){verified++;}})); assert.equal(verified,0);
  const h=await helpers(), parts=await h.readFixtureParts();
  h.editFixtureXml(parts,'word/document.xml',doc=>{const p=doc.getElementsByTagName('w:p')[0], image=doc.getElementsByTagName('w:drawing')[0]; for(let i=0;i<199;i++) p.appendChild(image.cloneNode(true));});
  await assert.rejects(m.convertDocx(h.zipFixtureParts(parts),{onVerified(){verified++;}}), /图片.*200/); assert.equal(verified,1);
});

test('fixture generation is deterministic without rewriting the native baseline', async () => {
  const h=await helpers(); assert.deepEqual(await h.createNormalDocx(),new Uint8Array(fixture('normal.docx')));
});

test('Worker verifies transport, emits verified before result and transfers only independent images once', async () => {
  const workerFile=path.join(__dirname,'../shared/docx-worker.mjs');
  const worker=fs.existsSync(workerFile) ? await import(pathToFileURL(workerFile).href) : {};
  assert.equal(typeof worker.createDocxWorkerHandler,'function');
  const bytes=new Uint8Array(fixture('normal.docx')), before=bytes.slice(), events=[];
  const handler=worker.createDocxWorkerHandler((value,transfer=[])=>events.push(structuredClone({value,transfer},{transfer})));
  await handler({data:{id:4,bytes,mime:'application/octet-stream'}});
  await handler({data:{id:5,bytes}});
  assert.deepEqual(events.map(e=>e.value.type),['verified','result']); assert.deepEqual(events.map(e=>e.value.id),[4,4]);
  assert.deepEqual(bytes,before); assert.equal(events[1].transfer.length,2);
  assert.ok(events[1].value.images.every(image=>image.bytes.byteLength>0));
  const bad=[]; await worker.createDocxWorkerHandler(value=>bad.push(value))({data:{id:'bad',bytes,mime:'text/html'}});
  assert.deepEqual(bad.map(e=>e.type),['error']); assert.match(bad[0].message,/网页/);
});

test('all image references including unsupported ones are counted before conversion', async () => {
  const h=await helpers(), parts=await h.readFixtureParts(); let verified=0;
  h.editFixtureXml(parts,'word/document.xml',doc=>{const p=doc.getElementsByTagName('w:p')[0], image=doc.getElementsByTagName('w:drawing')[0];for(let i=0;i<199;i++)p.appendChild(image.cloneNode(true));});
  h.editFixtureXml(parts,'word/_rels/document.xml.rels',doc=>{for(const n of doc.getElementsByTagName('Relationship'))if(n.getAttribute('Type').endsWith('/image')){n.setAttribute('TargetMode','External');n.setAttribute('Target','https://invalid.example/image');}});
  await assert.rejects((await api()).convertDocx(h.zipFixtureParts(parts),{onVerified(){verified++;}}), /图片.*200/); assert.equal(verified,1);
});

test('image reference counting also covers images inside external hyperlinks', async () => {
  const h=await helpers(),parts=await h.readFixtureParts();
  h.editFixtureXml(parts,'word/_rels/document.xml.rels',doc=>{const n=doc.createElement('Relationship');for(const [k,v]of Object.entries({Id:'outer',Type:h.R+'hyperlink',Target:'javascript:alert(1)',TargetMode:'External'}))n.setAttribute(k,v);doc.documentElement.appendChild(n);for(const image of doc.getElementsByTagName('Relationship'))if(image.getAttribute('Type').endsWith('/image')){image.setAttribute('TargetMode','External');image.setAttribute('Target','file:///invalid');}});
  h.editFixtureXml(parts,'word/document.xml',doc=>{const p=doc.getElementsByTagName('w:p')[0],image=doc.getElementsByTagName('w:drawing')[0],link=doc.createElementNS(W,'w:hyperlink');link.setAttribute('r:id','outer');for(let i=0;i<201;i++){const r=doc.createElementNS(W,'w:r');r.appendChild(image.cloneNode(true));link.appendChild(r);}p.appendChild(link);});
  await assert.rejects((await api()).convertDocx(h.zipFixtureParts(parts)), /图片.*200/);
});

test('conversion HTML limit remains fatal after verified using genuine repeated note references', async () => {
  const h=await helpers(), parts=await h.readFixtureParts(); let verified=0;
  h.editFixtureXml(parts,'word/footnotes.xml',doc=>{const note=[...doc.getElementsByTagName('w:footnote')].find(n=>n.getAttribute('w:id')==='1');note.getElementsByTagName('w:t')[0].textContent='课程'.repeat(10000);});
  h.editFixtureXml(parts,'word/document.xml',doc=>{const p=doc.getElementsByTagName('w:p')[0],ref=doc.getElementsByTagName('w:footnoteReference')[0];for(let i=0;i<70;i++){const r=doc.createElementNS(W,'w:r');r.appendChild(ref.cloneNode(true));p.appendChild(r);}});
  await assert.rejects((await api()).convertDocx(h.zipFixtureParts(parts,0),{onVerified(){verified++;}}), /HTML.*4 MiB/);assert.equal(verified,1);
});

test('normalization growth is rechecked after verified before temporary ZIP conversion', async () => {
  const h=await helpers(), parts=await h.readFixtureParts();let verified=0;
  h.editFixtureXml(parts,'word/document.xml',doc=>{const t=doc.getElementsByTagName('w:t')[0];t.textContent='\u0085'.repeat(710000);});
  await assert.rejects((await api()).convertDocx(h.zipFixtureParts(parts,0),{onVerified(){verified++;}}), /转换副本 XML.*4 MiB/);assert.equal(verified,1);
});

test('normalized total content is bounded even when every XML part stays below its limit', async () => {
  const h=await helpers(),parts=await h.readFixtureParts();let verified=0, state=783;
  const characters=[]; for(let i=0;i<1500000;i++){state=(Math.imul(state,1664525)+1013904223)>>>0;characters.push(i%3===0?'\u0085':'ABCD'[(state>>>24)%4]);}
  const source=Buffer.from('<custom>'+characters.join('')+'</custom>');
  for(let i=0;i<22;i++)parts.set(`custom/part${i}.xml`,source);
  await assert.rejects((await api()).convertDocx(h.zipFixtureParts(parts),{onVerified(){verified++;}}), /转换副本内容.*60 MiB/);assert.equal(verified,1);
});

test('macro and expansion bomb packages fail before verified', async () => {
  const h=await helpers();let verified=0;
  for(const mutation of [parts=>h.editFixtureXml(parts,'[Content_Types].xml',doc=>{for(const n of doc.getElementsByTagName('Override'))if(n.getAttribute('PartName')==='/word/document.xml')n.setAttribute('ContentType','application/vnd.ms-word.document.macroEnabled.main+xml');}),parts=>parts.set('custom/bomb.xml',Buffer.from('<x>'+' '.repeat(5*1024*1024)+'</x>'))]) {
    const parts=await h.readFixtureParts();mutation(parts);
    await assert.rejects((await api()).convertDocx(h.zipFixtureParts(parts),{onVerified(){verified++;}}));
  }
  assert.equal(verified,0);
});

test('prototype-named package parts stay isolated throughout actual conversion', async () => {
  const result=await convertVariant((parts,h)=>{for(const name of ['__proto__','constructor'])parts.set(name,Buffer.from('<part/>'));h.editFixtureXml(parts,'[Content_Types].xml',doc=>{for(const name of ['__proto__','constructor']){const n=doc.createElement('Override');n.setAttribute('PartName','/'+name);n.setAttribute('ContentType','application/xml');doc.documentElement.appendChild(n);}});});
  assert.match(result.html,/第一章/);assert.equal(result.images.length,2);assert.equal(Object.prototype.polluted,undefined);
});

test('note identifiers use a unique safe prefix even when caller prefix ends in a newline', async () => {
  const m=await api();
  const first=await m.convertDocx(fixture('normal.docx'),{idPrefix:'caller-\n'});
  const second=await m.convertDocx(fixture('normal.docx'),{idPrefix:'caller-\n'});
  const ids=html=>[...html.matchAll(/\bid="([^"]*)"/g)].map(match=>match[1]);
  assert.ok(ids(first.html).length>0);assert.ok(ids(first.html).every(id=>/^[A-Za-z0-9_-]+$/.test(id)));
  assert.ok(ids(first.html).every(id=>!ids(second.html).includes(id)));
});

test('aggregate image bytes count repeated references and remain fatal after verified', async () => {
  const h=await helpers(),parts=await h.readFixtureParts();let verified=0;
  const png=[...parts.keys()].find(name=>name.endsWith('.png'));
  const bytes=new Uint8Array(400*1024);bytes.set(parts.get(png));parts.set(png,bytes);
  h.editFixtureXml(parts,'word/document.xml',doc=>{const p=doc.getElementsByTagName('w:p')[0],image=doc.getElementsByTagName('w:drawing')[0];for(let i=0;i<160;i++){const r=doc.createElementNS(W,'w:r');r.appendChild(image.cloneNode(true));p.appendChild(r);}});
  await assert.rejects((await api()).convertDocx(h.zipFixtureParts(parts,0),{onVerified(){verified++;}}), /图片总大小.*60 MiB/);assert.equal(verified,1);
});

test('unsupported image formats return placeholders, never markers or image bytes', async () => {
  const result=await convertVariant((parts,h)=>h.editFixtureXml(parts,'[Content_Types].xml',doc=>{for(const n of doc.getElementsByTagName('Default'))if(['png','jpg','jpeg'].includes(n.getAttribute('Extension')))n.setAttribute('ContentType','image/gif');}));
  assert.equal(result.images.length,0);assert.doesNotMatch(result.html,/<img/);assert.match(result.html,/图片暂不支持预览/);
  assert.ok(result.warnings.some(w=>/图片格式/.test(w)));
});

test('upstream messages are mapped to fixed, deduplicated and bounded warnings', async () => {
  const result=await convertVariant((parts,h)=>h.editFixtureXml(parts,'word/document.xml',doc=>{for(let i=0;i<100;i++){const n=doc.createElementNS(W,'w:untrusted'+i);n.setAttribute('secret','<script>unique-secret');doc.getElementsByTagName('w:body')[0].appendChild(n);}}));
  assert.ok(result.warnings.length>0&&result.warnings.length<=32);assert.equal(new Set(result.warnings).size,result.warnings.length);
  assert.ok(result.warnings.every(w=>w.length<=256&&!/secret|script|untrusted/.test(w)));
});

test('real browser Worker bundle uses browser adapters and excludes Node, CLI, HTTP and CDN paths', async () => {
  const esbuild=require('esbuild');
  const built=await esbuild.build({entryPoints:[path.join(__dirname,'../shared/docx-worker.mjs')],bundle:true,platform:'browser',format:'esm',write:false,metafile:true,logLevel:'silent'});
  const names=Object.keys(built.metafile.inputs).join('\n');
  assert.match(names,/mammoth\/browser\/unzip\.js/);assert.match(names,/mammoth\/browser\/docx\/files\.js/);
  assert.doesNotMatch(names, /mammoth\/lib\/(?:unzip|fs)\.js|mammoth\/lib\/docx\/files\.js|(?:argparse|sprintf-js|\/bin\/mammoth)/);
  assert.doesNotMatch(built.outputFiles[0].text,/\brequire\(["'](?:node:|fs["']|https?["'])|\b(?:fetch|XMLHttpRequest)\s*\(/);
  assert.equal(built.metafile.outputs[Object.keys(built.metafile.outputs)[0]].imports.length,0);
});
