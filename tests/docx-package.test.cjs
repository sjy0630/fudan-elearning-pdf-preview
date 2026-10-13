const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const file = path.join(__dirname, '../shared/docx-package.mjs');
const api = async () => fs.existsSync(file) ? import(pathToFileURL(file).href) : {};
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const RS = 'http://purl.oclc.org/ooxml/officeDocument/relationships/';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WS = 'http://purl.oclc.org/ooxml/wordprocessingml/main';
const MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const RELTYPE = 'application/vnd.openxmlformats-package.relationships+xml';
const types = (extra = '', mainPath = 'word/document.xml', mainType = MAIN) => `<Types xmlns="${CT}"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="${RELTYPE}"/><Override PartName="/${mainPath}" ContentType="${mainType}"/>${extra}</Types>`;
const rels = content => `<Relationships xmlns="${REL}">${content}</Relationships>`;
const relation = (id, type, target, mode = '') => `<Relationship Id="${id}" Type="${type}" Target="${target}"${mode ? ` TargetMode="${mode}"` : ''}/>`;
const doc = (body = '<w:p><w:r><w:t>中文正文</w:t></w:r></w:p>', ns = W) => `<w:document xmlns:w="${ns}"><w:body>${body}</w:body></w:document>`;
const minimal = ({ mainPath = 'word/document.xml', mainType = MAIN, strict = false, contentTypes, rootRels, document, extra = {} } = {}) => new Map([
  ['[Content_Types].xml', Buffer.from(contentTypes ?? types('', mainPath, mainType))],
  ['_rels/.rels', Buffer.from(rootRels ?? rels(relation('rId1', `${strict ? RS : R}officeDocument`, mainPath)))],
  [mainPath, Buffer.from(document ?? doc(undefined, strict ? WS : W))],
  ...Object.entries(extra).map(([name, data]) => [name, typeof data === 'string' ? Buffer.from(data) : data]),
]);
const zip = async files => {
  const { Zip, ZipPassThrough } = await import('fflate');
  const chunks = [];
  const archive = new Zip((error, chunk) => { if (error) throw error; chunks.push(chunk); });
  for (const [name, data] of files) {
    const part = new ZipPassThrough(name);
    archive.add(part);
    part.push(data, true);
  }
  archive.end();
  return new Uint8Array(Buffer.concat(chunks));
};
const verify = async options => (await api()).verifyDocxPackage(await zip(minimal(options)));
const utf16 = (text, big = false, bom = true) => {
  const bytes = Buffer.from(text, 'utf16le');
  if (big) bytes.swap16();
  return Buffer.concat([bom ? Buffer.from(big ? [0xfe, 0xff] : [0xff, 0xfe]) : Buffer.alloc(0), bytes]);
};

test('bounded OOXML package verifier is exported', async () => {
  const m = await api();
  assert.equal(typeof m.verifyDocxPackage, 'function', 'verifyDocxPackage export must exist');
});

test('ordinary, relocated and Strict Word packages return verified parts and normalized XML', async () => {
  for (const options of [{}, { mainPath: 'documents/chapter.xml' }, { strict: true }]) {
    const files = minimal(options);
    const bytes = await zip(files);
    const before = bytes.slice();
    const result = (await api()).verifyDocxPackage(new DataView(bytes.buffer));
    assert.equal(result.documentPath, options.mainPath ?? 'word/document.xml');
    assert.ok(result.parts instanceof Map);
    assert.ok(result.xmlParts instanceof Map);
    assert.ok(result.relationships instanceof Map);
    assert.deepEqual([...result.parts.keys()], [...files.keys()]);
    for (const [name, data] of files) assert.deepEqual(result.parts.get(name), new Uint8Array(data));
    assert.match(result.xmlParts.get(result.documentPath), /中文正文/);
    assert.deepEqual(result.relationships.get('_rels/.rels'), [{ id: 'rId1', type: `${options.strict ? RS : R}officeDocument`, target: result.documentPath, external: false }]);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(bytes, before);
  }
});

test('content types are mandatory, namespace checked, unambiguous and cover each file', async () => {
  const m = await api();
  const missing = minimal(); missing.delete('[Content_Types].xml');
  const missingBytes = await zip(missing);
  assert.throws(() => m.verifyDocxPackage(missingBytes), /内容类型/);
  for (const contentTypes of [
    types().replace(CT, 'urn:fake'),
    types('<Default Extension="XML" ContentType="application/xml"/>'),
    types('<Override PartName="/word/document.xml" ContentType="application/xml"/>'),
    types('<Override PartName="/missing.xml" ContentType="application/xml"/>'),
    types('<Default Extension="png" ContentType="not-a-mime"/>'),
    types().replace('Extension="xml"', 'Extension=".xml"'),
    types().replace('/word/document.xml', 'word/document.xml'),
  ]) {
    const bytes = await zip(minimal({ contentTypes }));
    assert.throws(() => m.verifyDocxPackage(bytes), /内容类型|路径/);
  }
  const uncovered = await zip(minimal({ extra: { 'random.bin': Uint8Array.of(1) } }));
  assert.throws(() => m.verifyDocxPackage(uncovered), /内容类型/);
  const result = await verify({ contentTypes: types().replace('Extension="xml"', 'Extension="XML"').replaceAll('application/xml', 'Application/XML').replace('/word/document.xml', '/word/%64ocument.xml'), extra: { 'word/': new Uint8Array() } });
  assert.match(result.xmlParts.get('[Content_Types].xml'), /Extension="xml"/);
  assert.match(result.xmlParts.get('[Content_Types].xml'), /ContentType="application\/xml"/);
  assert.match(result.xmlParts.get('[Content_Types].xml'), /PartName="\/word\/document.xml"/);
});

test('only a unique internal Word officeDocument with one direct body qualifies', async () => {
  const m = await api();
  for (const options of [
    { mainType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml' },
    { mainType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml' },
    { rootRels: rels('') },
    { rootRels: rels(relation('r1', `${R}officeDocument`, 'word/document.xml') + relation('r2', `${RS}officeDocument`, 'word/document.xml')) },
    { rootRels: rels(relation('r1', `${R}officeDocument`, 'https://example.test/file', 'External')) },
    { document: '<document><body/></document>' },
    { document: doc().replace('<w:body>', '<w:body/><w:body>') },
    { document: `<w:document xmlns:w="${W}"><w:p><w:body/></w:p></w:document>` },
  ]) {
    const bytes = await zip(minimal(options));
    assert.throws(() => m.verifyDocxPackage(bytes), /Word|正文|officeDocument/);
  }
});

test('strict UTF8 and UTF16 Chinese XML normalize without obsolete encoding declarations', async () => {
  const m = await api();
  for (const big of [false, true]) for (const bom of [false, true]) {
    const files = minimal();
    for (const name of ['word/document.xml', '_rels/.rels']) {
      files.set(name, utf16(`<?xml version="1.0" encoding="UTF-16${bom ? '' : big ? 'BE' : 'LE'}"?>${Buffer.from(files.get(name)).toString()}`, big, bom));
    }
    const bytes = await zip(files);
    const original = bytes.slice();
    const result = m.verifyDocxPackage(bytes);
    assert.match(result.xmlParts.get('word/document.xml'), /中文正文/);
    for (const xml of result.xmlParts.values()) assert.doesNotMatch(xml, /<\?xml/);
    assert.deepEqual(bytes, original);
  }
  const utf8Bom = minimal();
  utf8Bom.set('word/document.xml', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>${doc()}`)]));
  assert.match(m.verifyDocxPackage(await zip(utf8Bom)).xmlParts.get('word/document.xml'), /中文正文/);
});

test('unsupported, mismatched and malformed XML encodings or characters are rejected', async () => {
  const m = await api();
  const invalid = [
    Buffer.from(`<?xml version="1.0" encoding="UTF-16"?>${doc()}`),
    Buffer.from(`<?xml version="1.0" encoding="ISO-8859-1"?>${doc()}`),
    utf16(`<?xml version="1.0" encoding="UTF-8"?>${doc()}`),
    utf16(`<?xml version="1.0" encoding="UTF-16LE"?>${doc()}`, true),
    Buffer.concat([Buffer.from(doc('<w:t>')), Buffer.from([0xc0, 0xaf])]),
    utf16(doc('\ud800')),
    Buffer.from(doc('\u0000')),
    Buffer.from(doc('&#0;')),
    Buffer.from(doc('&#xD800;')),
    Buffer.from(doc('&#x110000;')),
    Buffer.from(doc('\uffff')),
  ];
  for (const bytes of invalid) {
    const files = minimal(); files.set('word/document.xml', bytes);
    const archive = await zip(files);
    assert.throws(() => m.verifyDocxPackage(archive), /XML/);
  }
});

test('DTD, ENTITY, parser warnings, duplicate attributes and malformed XML are fatal in every XML part', async () => {
  const m = await api();
  const invalid = [
    `<!DOCTYPE w:document [<!ENTITY x "unsafe">]>${doc('&x;')}`,
    `<!DOCTYPE w:document SYSTEM "https://example.test/external.dtd">${doc()}`,
    doc('&unknown;'),
    doc('&'), doc('&#;'), doc('&#-1;'), doc('text ]]> outside CDATA'),
    doc().replace('<w:body>', '<w:body a="1" a="2">'),
    doc().replace('<w:body>', '<w:body a=one>'),
    doc().replace('</w:body>', '</w:p>'),
    doc().replace('</w:document>', ''),
    `${doc()}<extra/>`,
    doc('<x:p/>'),
  ];
  for (const source of invalid) {
    const archive = await zip(minimal({ extra: { 'custom.data': source }, contentTypes: types('<Default Extension="data" ContentType="application/example+xml"/>') }));
    assert.throws(() => m.verifyDocxPackage(archive), /XML/);
  }
  const good = await verify({ document: doc('<!-- <!DOCTYPE x> <tag/> ]]> & --><?note <fake/> ]]> &?><![CDATA[<not-a-tag>&unknown;]]><w:p note="]]> &lt;tag> > / &quot;"><w:r><w:t>&amp;&lt;&gt;&quot;&apos;&#x4E2D;&amp;#0; ]]&gt;</w:t></w:r></w:p>') });
  assert.match(good.xmlParts.get('word/document.xml'), /not-a-tag/);
});

test('XML byte limits cover custom suffixes and exact boundaries', async () => {
  const m = await api();
  const maximum = 4 * 1024 * 1024;
  for (const type of ['application/xml', 'text/xml', 'application/example+xml']) {
    const source = `<custom>${' '.repeat(maximum - 17)}</custom>`;
    assert.equal(Buffer.byteLength(source), maximum);
    assert.ok((await verify({ extra: { 'part.data': source }, contentTypes: types(`<Default Extension="data" ContentType="${type}"/>`) })).xmlParts.has('part.data'));
    const bytes = await zip(minimal({ extra: { 'part.data': `${source} ` }, contentTypes: types(`<Default Extension="data" ContentType="${type}"/>`) }));
    assert.throws(() => m.verifyDocxPackage(bytes), /XML.*4 MiB/);
  }
});

test('lexical depth is checked before parsing and global actual XML nodes are bounded', async () => {
  const m = await api();
  const nested = count => doc(`${'<w:p>'.repeat(count)}${'</w:p>'.repeat(count)}`);
  assert.ok((await verify({ document: nested(254) })).xmlParts.has('word/document.xml'));
  const overDepth = await zip(minimal({ document: nested(255) }));
  assert.throws(() => m.verifyDocxPackage(overDepth), /XML.*256/);
  const baselineNodes = 23; // Document, element and attribute nodes across the three minimal parts.
  assert.ok((await verify({ document: doc('<!--x-->'.repeat(50000 - baselineNodes)) })).xmlParts.has('word/document.xml'));
  const overNodes = await zip(minimal({ document: doc('<!--x-->'.repeat(50001 - baselineNodes)) }));
  assert.throws(() => m.verifyDocxPackage(overNodes), /XML.*50000/);
  const overTags = await zip(minimal({ document: doc('<w:p/>'.repeat(50001)) }));
  assert.throws(() => m.verifyDocxPackage(overTags), /XML.*50000/);
});

test('internal relative, root, percent-encoded Unicode and literal encoded ZIP paths resolve to actual map keys', async () => {
  for (const [mainPath, target] of [['word/中文 文档.xml', 'word/%E4%B8%AD%E6%96%87%20%E6%96%87%E6%A1%A3.xml'], ['word/a%20b.xml', 'word/a%20b.xml']]) {
    const result = await verify({ mainPath, rootRels: rels(relation('r1', `${R}officeDocument`, target)), extra: { 'word/_rels/a.rels': rels(''), 'word/a': '<x/>' }, contentTypes: types('<Override PartName="/word/a" ContentType="application/xml"/>', target) });
    assert.equal(result.documentPath, mainPath);
    assert.match(result.xmlParts.get('[Content_Types].xml'), new RegExp(mainPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const result = await verify({ mainPath: 'documents/book.xml', extra: {
    'documents/_rels/book.xml.rels': rels(relation('styles', `${R}styles`, '../shared/styles.xml') + relation('notes', `${RS}footnotes`, '/shared/notes.xml')),
    'shared/styles.xml': '<styles/>', 'shared/notes.xml': '<notes/>',
  } });
  assert.deepEqual(result.relationships.get('documents/_rels/book.xml.rels').map(item => item.target), ['shared/styles.xml', 'shared/notes.xml']);
});

test('safe hyperlink fragments refer to the verified owner or target and remain inert metadata', async () => {
  for (const prefix of [R, RS]) {
    const result = await verify({ extra: { 'word/_rels/document.xml.rels': rels(relation('r1', `${prefix}hyperlink`, '#书签_1') + relation('r2', `${prefix}hyperlink`, '/word/document.xml#bookmark.%E4%B8%AD')) } });
    assert.deepEqual(result.relationships.get('word/_rels/document.xml.rels'), [
      { id: 'r1', type: `${prefix}hyperlink`, target: 'word/document.xml', external: false, fragment: '书签_1' },
      { id: 'r2', type: `${prefix}hyperlink`, target: 'word/document.xml', external: false, fragment: 'bookmark.中' },
    ]);
  }
});

test('relationships require valid roots, attributes, unique IDs and an existing owner', async () => {
  const m = await api();
  const good = relation('r1', `${R}styles`, 'document.xml');
  for (const content of [
    rels(good).replace(REL, 'urn:fake'), rels(good + good), rels(good.replace('Id="r1"', 'Id=""')),
    rels(good.replace('Type="', 'Extra="x" Type="')), rels(good.replace(`${R}styles`, 'not-a-uri')),
    rels(good.replace('Target="', 'TargetMode="invalid" Target="')), rels(good.replace('Id="r1"', 'Id="has spaces"')),
    rels(good.replace('/>', '><nested/></Relationship>')), rels(good).replace('<Relationships ', '<Relationships extra="x" '),
  ]) {
    const bytes = await zip(minimal({ extra: { 'word/_rels/document.xml.rels': content } }));
    assert.throws(() => m.verifyDocxPackage(bytes), /关系/);
  }
  for (const name of ['word/_rels/missing.xml.rels', 'bad.rels']) {
    const bytes = await zip(minimal({ extra: { [name]: rels('') } }));
    assert.throws(() => m.verifyDocxPackage(bytes), /关系/);
  }
});

test('unsafe, escaped, missing and inappropriate fragmented targets are rejected', async () => {
  const m = await api();
  const bad = ['../../escape.xml', '//server/share', 'https://example.test/x', 'C:/file', '../document.xml?query', 'document.xml#bookmark', 'document.xml\\x', 'document.xml%00', '%2e%2e/document.xml', '%252e%252e/document.xml', '%2Fword/document.xml', 'missing.xml', 'document.xml/', 'document.xml%3Fquery', 'document.xml%ZZ'];
  for (const target of bad) {
    const bytes = await zip(minimal({ extra: { 'word/_rels/document.xml.rels': rels(relation('r1', `${R}styles`, target)) } }));
    assert.throws(() => m.verifyDocxPackage(bytes), /路径|目标|片段/);
  }
  for (const target of ['#', '#a/b', '#a\\b', '#a?b', '#a#b', '#%00', '#%2Fa', `#${'a'.repeat(257)}`]) {
    const bytes = await zip(minimal({ extra: { 'word/_rels/document.xml.rels': rels(relation('r1', `${R}hyperlink`, target)) } }));
    assert.throws(() => m.verifyDocxPackage(bytes), /片段|路径/);
  }
});

test('macro content types, VBA parts and macro relationships are rejected anywhere in the package', async () => {
  const m = await api();
  for (const options of [
    { mainType: 'application/vnd.ms-word.document.macroEnabled.main+xml' },
    { extra: { 'word/code.bin': Uint8Array.of(1) }, contentTypes: types('<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>') },
    { extra: { 'word/vbaProject.bin': Uint8Array.of(1) }, contentTypes: types('<Default Extension="bin" ContentType="application/octet-stream"/>') },
    { extra: { 'word/code.xml': '<x/>', 'word/_rels/document.xml.rels': rels(relation('r1', `${R}vbaProject`, 'code.xml')) } },
    { extra: { 'EncryptedPackage': Uint8Array.of(1) }, contentTypes: types('<Override PartName="/EncryptedPackage" ContentType="application/octet-stream"/>') },
  ]) {
    const bytes = await zip(minimal(options));
    assert.throws(() => m.verifyDocxPackage(bytes), /宏|加密/);
  }
});

test('content type schema rejects unknown attributes, child content and ambiguous semantic keys', async () => {
  const m = await api();
  for (const contentTypes of [
    types().replace('<Types ', '<Types extra="x" '),
    types().replace('Extension="xml"', 'Extension="xml" extra="x"'),
    types().replace('/>', '><child/></Default>'),
    types().replace('</Types>', 'not whitespace</Types>'),
    types('<Override PartName="/word/%64ocument.xml" ContentType="application/xml"/>'),
    types().replace('<Default Extension="xml"', '<Default xmlns:bad="urn:bad" bad:Extension="xml"'),
  ]) {
    const bytes = await zip(minimal({ contentTypes }));
    assert.throws(() => m.verifyDocxPackage(bytes), /内容类型/);
  }
});

test('external URLs are never read and yield bounded fixed warnings without copying user markup', async () => {
  const m = await api();
  const targets = ['https://example.test/secret?q=1', 'file:///private/secrets', 'javascript:alert(1)', 'data:text/html,secret', '&lt;script&gt;user markup&lt;/script&gt;'];
  const extra = { 'word/_rels/document.xml.rels': rels(targets.map((target, i) => relation(`r${i}`, `${i % 2 ? RS : R}${i ? 'image' : 'hyperlink'}`, target, 'External')).join('')) };
  const bytes = await zip(minimal({ extra }));
  const result = m.verifyDocxPackage(bytes);
  assert.equal(result.relationships.get('word/_rels/document.xml.rels')[0].target, targets[0]);
  assert.equal(result.relationships.get('word/_rels/document.xml.rels').length, targets.length);
  assert.ok(result.relationships.get('word/_rels/document.xml.rels').every(item => item.external));
  assert.ok(result.warnings.some(message => /超链接/.test(message)));
  assert.ok(result.warnings.some(message => /外部图片或对象/.test(message)));
  assert.equal(new Set(result.warnings).size, result.warnings.length);
  assert.ok(result.warnings.length <= 16);
  assert.ok(result.warnings.every(message => message.length <= 256 && !/example|secret|script|markup/.test(message)));
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    Object.defineProperty(globalThis, 'window', {get() {throw Error('window accessed');}});
    Object.defineProperty(globalThis, 'document', {get() {throw Error('document accessed');}});
    globalThis.fetch = () => {throw Error('network accessed');};
    globalThis.XMLHttpRequest = class {constructor() {throw Error('network accessed');}};
    const {verifyDocxPackage} = await import(${JSON.stringify(pathToFileURL(file).href)});
    const bytes = Uint8Array.from(Buffer.from(${JSON.stringify(Buffer.from(bytes).toString('base64'))}, 'base64'));
    if (verifyDocxPackage(bytes).warnings.length < 2) throw Error('missing warning');
  `], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
});

test('complex Word features produce deterministic deduplicated limitations', async () => {
  const math = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
  const draw = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  const office = 'urn:schemas-microsoft-com:office:office';
  const document = `<w:document xmlns:w="${W}" xmlns:m="${math}" xmlns:wp="${draw}" xmlns:o="${office}"><w:body><m:oMath/><m:oMath/><w:ins/><w:del/><w:object><o:OLEObject/></w:object><w:altChunk/><wp:anchor/><w:commentRangeStart/></w:body></w:document>`;
  const extra = {
    'word/diagrams/data.xml': '<diagram/>', 'word/charts/chart.xml': '<chart/>', 'word/header1.xml': '<header/>',
    'word/activeX/activeX.xml': '<activeX/>', 'word/comments.xml': '<comments/>', 'word/media/image.svg': '<svg/>',
    'word/_rels/document.xml.rels': rels(relation('header', `${RS}header`, 'header1.xml') + relation('chart', `${R}chart`, 'charts/chart.xml')),
  };
  const result = await verify({ document, extra, contentTypes: types('<Default Extension="svg" ContentType="image/svg+xml"/>') });
  for (const feature of [/公式/, /SmartArt/, /图表/, /修订/, /嵌入对象/, /ActiveX/, /altChunk/, /页眉页脚/, /浮动/, /批注/, /图片格式/]) {
    assert.ok(result.warnings.some(message => feature.test(message)), String(feature));
  }
  assert.equal(new Set(result.warnings).size, result.warnings.length);
  assert.deepEqual(result.warnings, (await verify({ document, extra: Object.fromEntries(Object.entries(extra).reverse()), contentTypes: types('<Default Extension="svg" ContentType="image/svg+xml"/>') })).warnings);
});

test('unsupported image warnings cover GIF, SVG, WMF and EMF; supported bitmap types stay quiet', async () => {
  for (const [extension, type] of [['gif', 'image/gif'], ['svg', 'image/svg+xml'], ['wmf', 'image/x-wmf'], ['emf', 'image/x-emf'], ['png', 'image/png'], ['jpg', 'image/jpeg'], ['webp', 'image/webp']]) {
    const data = extension === 'svg' ? '<svg/>' : Uint8Array.of(1);
    const result = await verify({ extra: { [`word/media/image.${extension}`]: data }, contentTypes: types(`<Default Extension="${extension}" ContentType="${type}"/>`) });
    assert.equal(result.warnings.some(message => /图片格式/.test(message)), !['png', 'jpg', 'webp'].includes(extension));
  }
});

test('Map keys with prototype names and harmless encoded filename punctuation remain safe', async () => {
  const files = minimal();
  files.set('__proto__', Buffer.from('<part/>'));
  files.set('constructor', Buffer.from('<part/>'));
  files.set('[Content_Types].xml', Buffer.from(types('<Override PartName="/__proto__" ContentType="application/xml"/><Override PartName="/constructor" ContentType="application/xml"/>')));
  const result = (await api()).verifyDocxPackage(await zip(files));
  assert.ok(result.parts.has('__proto__'));
  assert.ok(result.xmlParts.has('constructor'));
  assert.equal(Object.prototype.polluted, undefined);
  const encoded = await verify({ mainPath: 'word/a%2Exml', contentTypes: types('', 'word/a%2Exml'), rootRels: rels(relation('root', `${R}officeDocument`, 'word/a%2Exml')) });
  assert.equal(encoded.documentPath, 'word/a%2Exml');
});

test('Override part names reject dot segments while parts without extensions need explicit overrides', async () => {
  const m = await api();
  for (const name of ['/word/../word/document.xml', '/word/./document.xml', '/word//document.xml', '/word/%2e/document.xml', '/word/document.xml#bookmark']) {
    const bytes = await zip(minimal({ contentTypes: types().replace('/word/document.xml', name) }));
    assert.throws(() => m.verifyDocxPackage(bytes), /内容类型|路径/);
  }
  const extensionless = await zip(minimal({ extra: { xml: '<part/>' } }));
  assert.throws(() => m.verifyDocxPackage(extensionless), /内容类型/);
});

test('encoded XML suffixes and encoded relationship owners cannot bypass validation', async () => {
  const m = await api();
  const wrongXml = await zip(minimal({ extra: { 'custom%2Exml': '<broken>' }, contentTypes: types('<Override PartName="/custom%2Exml" ContentType="application/octet-stream"/>') }));
  assert.throws(() => m.verifyDocxPackage(wrongXml), /XML/);
  const result = await verify({ mainPath: 'word/a b.xml', extra: { 'word/_rels/a%20b.xml.rels': rels(relation('style', `${R}styles`, '/word/a%20b.xml')) } });
  assert.equal(result.relationships.get('word/_rels/a%20b.xml.rels')[0].target, 'word/a b.xml');
  const disguisedRelationships = await zip(minimal({ contentTypes: types().replace(RELTYPE, 'application/xml') }));
  assert.throws(() => m.verifyDocxPackage(disguisedRelationships), /关系|内容类型/);
});

test('duplicate expanded attributes and mismatched body namespaces are rejected', async () => {
  const m = await api();
  for (const document of [
    doc('<w:p xmlns:a="urn:same" xmlns:b="urn:same" a:x="1" b:x="2"/>'),
    `<w:document xmlns:w="${W}"><s:body xmlns:s="${WS}"/></w:document>`,
  ]) {
    const bytes = await zip(minimal({ document }));
    assert.throws(() => m.verifyDocxPackage(bytes), /XML|正文/);
  }
});

test('package verification expands and checks CRC before accepting any OOXML contents', async () => {
  const m = await api();
  const bytes = await zip(minimal());
  const position = Buffer.from(bytes).indexOf(Buffer.from('中文正文'));
  assert.ok(position > 0);
  const corrupt = bytes.slice(); corrupt[position] ^= 1;
  assert.throws(() => m.verifyDocxPackage(corrupt), /CRC/);
  const ordinary = await zip(new Map([['notes.txt', Buffer.from('ordinary ZIP')]]));
  assert.throws(() => m.verifyDocxPackage(ordinary), /内容类型/);
});

test('expanded-attribute duplicate checks resolve namespace entities, inheritance and line endings', async () => {
  const m = await api();
  for (const body of [
    '<w:p xmlns:a="urn:&#x74;est" xmlns:b="urn:test" a:x="1" b:x="2"/>',
    '<w:p xmlns:a="urn:&amp;test" xmlns:b="urn:&#38;test"><w:r a:x="1" b:x="2"/></w:p>',
    '<w:p xmlns:a="urn:test\r\nscope" xmlns:b="urn:test scope" a:x="1" b:x="2"/>',
    '<w:p xmlns:a="urn:outer" xmlns:b="urn:outer"><w:r xmlns:a="urn:inner" a:x="1" b:x="2"/><w:r a:x="1" b:x="2"/></w:p>',
  ]) {
    const bytes = await zip(minimal({ document: doc(body) }));
    assert.throws(() => m.verifyDocxPackage(bytes), /XML.*重复/);
  }
  const accepted = await verify({ document: doc('<w:p xmlns="urn:default" xmlns:a="urn:one" xmlns:b="urn:two" x="1" a:x="2" b:x="3"><w:r xmlns:b="urn:one" a:x="1" b:y="2"/><w:r a:x="1" b:x="2"/></w:p>') });
  assert.ok(accepted.xmlParts.has('word/document.xml'));
});

test('reserved namespace prefixes and URIs cannot be rebound in any XML part', async () => {
  const m = await api();
  const xml = 'http://www.w3.org/XML/1998/namespace';
  const xmlns = 'http://www.w3.org/2000/xmlns/';
  for (const binding of [
    'xmlns:xmlns="urn:wrong"', `xmlns:xmlns="${xmlns}"`, `xmlns:x="${xmlns}"`, `xmlns:x="${xml}"`,
    'xmlns:xml="urn:wrong"', 'xmlns:xml=""', `xmlns="${xml}"`, `xmlns="${xmlns}"`,
    `xmlns:x="${xml.replace('namespace', 'namespac&#x65;')}"`,
    `xmlns:x="${xmlns.replace('xmlns', '&#120;mlns')}"`,
    `xmlns:xml="${xml}\r\n"`,
  ]) {
    const bytes = await zip(minimal({ extra: { 'custom.data': `<root><child ${binding}/></root>` }, contentTypes: types('<Default Extension="data" ContentType="application/example+xml"/>') }));
    assert.throws(() => m.verifyDocxPackage(bytes), /XML/, binding);
  }
});

test('standard xml bindings, defaults, inherited scopes and ordinary rebinding remain legal', async () => {
  const xml = 'http://www.w3.org/XML/1998/namespace';
  for (const strict of [false, true]) {
    const result = await verify({ strict, document: doc(`<w:p xmlns:xml="${xml}" xmlns:a="urn:outer" xml:space="preserve"><w:r xmlns:a="urn:inner" xmlns="urn:default"><中:节点 xmlns:中="urn:中文" xml:lang="zh-CN"/><child xmlns=""/></w:r><a:restored xml:lang="zh"/><w:r xmlns:xml="${xml.replace('namespace', 'namespac&#x65;')}"/></w:p>`, strict ? WS : W) });
    assert.ok(result.xmlParts.has('word/document.xml'));
    assert.match(result.xmlParts.get('word/document.xml'), /中文/);
  }
});

test('malformed qualified names stay fatal through the strict parser grammar', async () => {
  const m = await api();
  for (const body of ['<w:p xmlns:="urn:test"/>', '<w:p xmlns:a:b="urn:test"/>', '<w:p a:b:c="value"/>', '<w:a:b/>']) {
    const bytes = await zip(minimal({ document: doc(body) }));
    assert.throws(() => m.verifyDocxPackage(bytes), /XML/);
  }
});

test('XML 1.0 is explicit or implied and unsupported declarations are rejected before normalization', async () => {
  const m = await api();
  for (const version of ['1.1', '1.2', '2.0', '1.00']) {
    const bytes = await zip(minimal({ document: `<?xml version="${version}"?>${doc()}` }));
    assert.throws(() => m.verifyDocxPackage(bytes), /XML.*版本/, version);
  }
  for (const declaration of ['', '<?xml version="1.0"?>', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>']) {
    assert.match((await verify({ document: `${declaration}${doc()}` })).xmlParts.get('word/document.xml'), /中文正文/);
  }
});

test('XML 1.0 prefixed undeclaration is rejected while default undeclaration remains legal', async () => {
  const m = await api();
  for (const body of ['<w:p xmlns:p=""/>', '<w:p xmlns:p="urn:outer"><w:r xmlns:p=""/></w:p>']) {
    const bytes = await zip(minimal({ document: doc(body) }));
    assert.throws(() => m.verifyDocxPackage(bytes), /XML/);
  }
  assert.ok((await verify({ document: doc('<w:p xmlns="urn:outer"><w:r xmlns=""/><child xmlns="urn:inner"/><child/></w:p>') })).xmlParts.has('word/document.xml'));
});

test('relationship IDs are XML 1.0 NCNames with legal Unicode starts and continuations', async () => {
  const m = await api();
  for (const id of ['1', 'a:b', 'id#fragment', '-id', '.id', '\u0300id', '\u00d7id', '\u{f0000}id', 'id/path']) {
    const bytes = await zip(minimal({ rootRels: rels(relation(id, `${R}officeDocument`, 'word/document.xml')) }));
    assert.throws(() => m.verifyDocxPackage(bytes), /关系.*ID/, id);
  }
  for (const id of ['_id', '中文关系1', 'α.2', 'a\u00b7b', 'a\u0300', '\u200cid', '\u{1f600}id', 'a-b']) {
    const result = await verify({ rootRels: rels(relation(id, `${R}officeDocument`, 'word/document.xml')) });
    assert.equal(result.relationships.get('_rels/.rels')[0].id, id);
  }
});
