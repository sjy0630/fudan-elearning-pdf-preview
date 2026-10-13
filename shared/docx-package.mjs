import { DOMParser, XMLSerializer, normalizeLineEndings } from '@xmldom/xmldom';
import { expandDocxZip } from './docx-zip.mjs';
import { DOCX_LIMITS } from './docx-policy.mjs';

const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const RS = 'http://purl.oclc.org/ooxml/officeDocument/relationships/';
const WORD = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']);
const MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const RELTYPE = 'application/vnd.openxmlformats-package.relationships+xml';
const XML = 'http://www.w3.org/XML/1998/namespace';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const XML_ENTITIES = new Map([['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"]]);
// XML 1.0 (Fifth Edition) NameStartChar/NameChar with ':' excluded for NCName.
const XML_NAME_START = 'A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}';
const XML_NCNAME = new RegExp('^[' + XML_NAME_START + '][' + XML_NAME_START + '0-9.\\-\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$', 'u');
const fail = reason => { throw new Error(`OOXML ${reason}。`); };
const children = element => {
  const result = [];
  for (let node = element.firstChild; node; node = node.nextSibling) if (node.nodeType === 1) result.push(node);
  return result;
};
const is = (node, namespace, localName) => node.namespaceURI === namespace && node.localName === localName;
const mime = value => {
  const type = value.trim().toLowerCase();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type)) fail('内容类型无效');
  return type;
};

function resolveTarget(target, base, aliases) {
  if (!target || target.startsWith('//') || /[\\:\p{Cc}?#]/u.test(target) || /%(?:2f|5c|3a|3f|23|25|0[0-9a-f]|1[0-9a-f]|7f)/i.test(target)) fail('关系或部件路径不安全');
  let decoded;
  try { decoded = decodeURIComponent(target); } catch { fail('关系或部件路径编码无效'); }
  if (/[\\:\p{Cc}?#]/u.test(decoded)) fail('关系或部件路径编码转义不安全');
  const stack = target.startsWith('/') ? [] : base.split('/').filter(Boolean);
  const raw = target.replace(/^\//, '').split('/');
  for (const [index, segment] of decoded.replace(/^\//, '').split('/').entries()) {
    if (!segment) fail('关系或部件路径不规范');
    if ((segment === '.' || segment === '..') && raw[index] !== segment) fail('关系路径含编码父目录转义');
    if (segment === '.') continue;
    if (segment === '..') { if (!stack.length) fail('关系路径逃逸包范围'); stack.pop(); }
    else stack.push(segment);
  }
  const result = aliases.get(stack.join('/'));
  if (!result || result.endsWith('/')) fail('关系或内容类型目标部件不存在');
  return result;
}

function packageAlias(name) {
  let key = name;
  for (let depth = 0; /%[0-9a-f]{2}/i.test(key); depth++) {
    if (depth >= 16) fail('部件路径编码嵌套过深');
    try { key = decodeURIComponent(key); } catch { fail('部件路径编码无效'); }
  }
  return key;
}

function schemaAttributes(element, allowed, context) {
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes.item(i);
    if (attr.namespaceURI !== XMLNS && (attr.namespaceURI || !allowed.includes(attr.name))) fail(`${context}属性无效`);
  }
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if ((child.nodeType === 3 || child.nodeType === 4) && /\S/.test(child.data)) fail(`${context}内容无效`);
  }
}

const macro = value => /macroenabled|vbaproject|vbadata/i.test(value);
const relationshipKind = type => type.startsWith(R) ? type.slice(R.length) : type.startsWith(RS) ? type.slice(RS.length) : '';
const WARNINGS = new Map([
  ['equations', '文档含公式，预览可能无法完整显示。'],
  ['smartart', '文档含 SmartArt，预览可能无法完整显示。'],
  ['charts', '文档含图表，预览可能无法完整显示。'],
  ['revisions', '文档含修订，预览可能无法完整呈现修改记录。'],
  ['objects', '文档含嵌入对象，预览不提供对象的运行或编辑。'],
  ['activex', '文档含 ActiveX 控件，预览不会运行这些控件。'],
  ['altchunk', '文档含 altChunk 内容，预览可能无法完整显示。'],
  ['headers', '文档含页眉页脚，预览不还原这些版面内容。'],
  ['floating', '文档含浮动布局，预览可能改变图文位置。'],
  ['comments', '文档含批注，预览可能无法完整显示。'],
  ['images', '文档含不支持的图片格式，预览可能显示占位说明。'],
  ['links', '外部超链接仅保留文字，预览不提供跳转。'],
  ['externalObjects', '文档含外部图片或对象，预览不会读取这些资源。'],
  ['externalResources', '文档含外部关联资源，预览不会读取这些资源。'],
]);

function elementFeatures(node, flags) {
  if (node.nodeType !== 1) return;
  const ns = node.namespaceURI || '';
  const local = node.localName;
  if (WORD.has(ns)) {
    if (/^(?:ins|del|moveFrom|moveTo|.*PrChange|moveFromRangeStart|moveToRangeStart)$/.test(local)) flags.add('revisions');
    if (local === 'object') flags.add('objects');
    if (local === 'altChunk') flags.add('altchunk');
    if (local === 'hdr' || local === 'ftr') flags.add('headers');
    if (/^comment(?:RangeStart|RangeEnd|Reference)?$/.test(local)) flags.add('comments');
    if (local === 'control') flags.add('activex');
  }
  if (/^(?:http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/math|http:\/\/purl\.oclc\.org\/ooxml\/officeDocument\/math)$/.test(ns) && /^oMath(?:Para)?$/.test(local)) flags.add('equations');
  if (/\/drawingml\/(?:2006\/)?wordprocessingDrawing$/.test(ns) && local === 'anchor') flags.add('floating');
  if (ns === 'urn:schemas-microsoft-com:office:office' && local === 'OLEObject') flags.add('objects');
  if (/\/drawingml\/(?:2006\/)?diagram$/.test(ns)) flags.add('smartart');
  if (/\/drawingml\/(?:2006\/)?chart$/.test(ns)) flags.add('charts');
}

function partFeatures(name, type, flags) {
  const key = packageAlias(name).toLowerCase();
  if (key.includes('/diagrams/') || /diagram(?:data|layout|style|colors)/.test(type)) flags.add('smartart');
  if (key.includes('/charts/') || /drawingml\.chart/.test(type)) flags.add('charts');
  if (key.includes('/embeddings/') || /oleobject/.test(type)) flags.add('objects');
  if (key.includes('/activex/') || /activex/.test(type)) flags.add('activex');
  if (/\/(?:header|footer)[^/]*\.xml$/.test(key) || /wordprocessingml\.(?:header|footer)/.test(type)) flags.add('headers');
  if (/\/comments[^/]*\.xml$/.test(key) || /wordprocessingml\.comments/.test(type)) flags.add('comments');
  if (type.startsWith('image/') && !['image/png', 'image/jpeg', 'image/webp'].includes(type) || /\.(?:svg|gif|wmf|emf)$/.test(key)) flags.add('images');
}

function relationshipFeatures(item, flags) {
  const kind = relationshipKind(item.type);
  if (kind.startsWith('diagram')) flags.add('smartart');
  if (kind === 'chart') flags.add('charts');
  if (kind === 'oleObject' || kind === 'package') flags.add('objects');
  if (kind === 'control') flags.add('activex');
  if (kind === 'aFChunk') flags.add('altchunk');
  if (kind === 'header' || kind === 'footer') flags.add('headers');
  if (kind === 'comments') flags.add('comments');
  if (item.external) flags.add(kind === 'hyperlink' ? 'links' : ['image', 'oleObject', 'package', 'control', 'aFChunk'].includes(kind) ? 'externalObjects' : 'externalResources');
}

const xmlCharacter = value => value === 9 || value === 10 || value === 13 || value >= 0x20 && value <= 0xd7ff || value >= 0xe000 && value <= 0xfffd || value >= 0x10000 && value <= 0x10ffff;

function decodeXml(bytes) {
  if (bytes.length > DOCX_LIMITS.xmlBytes) fail('XML 大小超过限制（4 MiB）');
  let encoding = 'utf-8';
  let bom = false;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = 'utf-16le'; bom = true; }
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = 'utf-16be'; bom = true; }
  else if (bytes[0] === 0x3c && bytes[1] === 0 && bytes[2] === 0x3f && bytes[3] === 0) encoding = 'utf-16le';
  else if (bytes[0] === 0 && bytes[1] === 0x3c && bytes[2] === 0 && bytes[3] === 0x3f) encoding = 'utf-16be';
  let source;
  try { source = new TextDecoder(encoding, { fatal: true }).decode(bytes); } catch { fail('XML 编码无效'); }
  const declaration = /^<\?xml\s[^?]*\?>/.exec(source)?.[0];
  const version = declaration && /\bversion\s*=\s*(['"])(.*?)\1/.exec(declaration)?.[2];
  if (version && version !== '1.0') fail('XML 版本不支持（仅支持 1.0）');
  const declared = declaration && /\bencoding\s*=\s*(['"])(.*?)\1/.exec(declaration)?.[2].toLowerCase();
  if (declared && declared !== encoding && !(declared === 'utf-16' && bom && encoding.startsWith('utf-16'))) fail('XML 声明编码不匹配或不支持');
  if (encoding.startsWith('utf-16') && !bom && !declared) fail('XML UTF16 缺少编码声明');
  for (const character of source) if (!xmlCharacter(character.codePointAt(0))) fail('XML 字符无效');
  return source;
}

function xmlReferences(source) {
  const reference = /&(amp|lt|gt|quot|apos|#x[0-9a-fA-F]+|#[0-9]+);/y;
  for (let cursor = 0;;) {
    const amp = source.indexOf('&', cursor);
    if (amp < 0) break;
    reference.lastIndex = amp;
    const match = reference.exec(source);
    if (!match) fail('XML 实体引用无效或未知');
    if (match[1][0] === '#') {
      const value = match[1][1] === 'x' ? Number.parseInt(match[1].slice(2), 16) : Number(match[1].slice(1));
      if (!xmlCharacter(value)) fail('XML 数字实体字符无效');
    }
    cursor = reference.lastIndex;
  }
}

function inspectText(text) {
  if (text.includes(']]>')) fail('XML 文本含非法 CDATA 结束标记');
  xmlReferences(text);
}

function attributeValue(value) {
  return value.replace(/[\t\r\n]/g, ' ').replace(/&(amp|lt|gt|quot|apos|#x[0-9a-f]+|#[0-9]+);/gi, (match, entity) => {
    if (entity[0] !== '#') return XML_ENTITIES.get(entity) ?? match;
    return String.fromCodePoint(entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
  });
}

// xmldom replaces duplicate expanded attributes with different raw prefixes.
// Check them before construction, using namespace changes rather than copying
// all inherited namespaces for every element.
function inspectAttributes(tag, namespaces) {
  const attributes = [];
  const rawNames = new Set();
  let cursor = 1;
  while (cursor < tag.length && !/[\s/>]/.test(tag[cursor])) cursor++;
  while (cursor < tag.length) {
    while (/\s/.test(tag[cursor])) cursor++;
    if (tag[cursor] === '/' || tag[cursor] === '>') break;
    const start = cursor;
    while (cursor < tag.length && !/[\s=/>]/.test(tag[cursor])) cursor++;
    const name = tag.slice(start, cursor);
    while (/\s/.test(tag[cursor])) cursor++;
    if (!name || tag[cursor++] !== '=') fail('XML 属性格式无效');
    while (/\s/.test(tag[cursor])) cursor++;
    const quote = tag[cursor++];
    if (quote !== '"' && quote !== "'") fail('XML 属性缺少引号');
    const end = tag.indexOf(quote, cursor);
    if (end < 0) fail('XML 属性引号截断');
    if (rawNames.has(name)) fail('XML 属性名称重复');
    rawNames.add(name);
    attributes.push({ name, value: attributeValue(tag.slice(cursor, end)) });
    cursor = end + 1;
  }
  const changes = [];
  for (const { name, value } of attributes) {
    if (name !== 'xmlns' && !name.startsWith('xmlns:')) continue;
    const prefix = name === 'xmlns' ? '' : name.slice(6);
    if (prefix === 'xmlns' || value === XMLNS || prefix === 'xml' && value !== XML || value === XML && prefix !== 'xml' || prefix && !value) fail('XML 保留命名空间绑定或前缀声明无效');
    changes.push({ prefix, present: namespaces.has(prefix), value: namespaces.get(prefix) });
    namespaces.set(prefix, value);
  }
  const expandedNames = new Set();
  for (const { name } of attributes) {
    const split = name.indexOf(':');
    const prefix = split < 0 ? '' : name.slice(0, split);
    const local = split < 0 ? name : name.slice(split + 1);
    const namespace = name === 'xmlns' || prefix === 'xmlns' ? XMLNS : prefix ? namespaces.get(prefix) || prefix : '';
    const key = `${namespace}\u0000${local}`;
    if (expandedNames.has(key)) fail('XML 扩展属性名称重复');
    expandedNames.add(key);
  }
  return changes;
}

function restoreNamespaces(changes, namespaces) {
  for (const { prefix, present, value } of changes) {
    if (present) namespaces.set(prefix, value);
    else namespaces.delete(prefix);
  }
}

// This linear gate runs before the parser can build any attacker-controlled tree.
function inspectXml(source, budget) {
  let depth = 0;
  const namespaces = new Map([['xml', XML]]);
  const scopes = [];
  for (let cursor = 0; cursor < source.length;) {
    const start = source.indexOf('<', cursor);
    if (start < 0) { inspectText(source.slice(cursor)); break; }
    inspectText(source.slice(cursor, start));
    let end;
    if (source.startsWith('<!--', start)) {
      end = source.indexOf('-->', start + 4);
      if (end < 0) fail('XML 注释截断');
      cursor = end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', start)) {
      end = source.indexOf(']]>', start + 9);
      if (end < 0) fail('XML CDATA 截断');
      cursor = end + 3;
      continue;
    }
    if (source.startsWith('<?', start)) {
      end = source.indexOf('?>', start + 2);
      if (end < 0) fail('XML 处理指令截断');
      cursor = end + 2;
      continue;
    }
    if (source.startsWith('<!', start)) fail('XML DTD 或 ENTITY 不支持');
    let quote = '';
    for (end = start + 1; end < source.length; end++) {
      const char = source[end];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end === source.length) fail('XML 标签截断');
    const tag = source.slice(start, end + 1);
    xmlReferences(tag);
    if (source[start + 1] === '/') {
      if (--depth < 0) fail('XML 标签嵌套无效');
      restoreNamespaces(scopes.pop(), namespaces);
    } else {
      if (++budget.tags > DOCX_LIMITS.nodes) fail('XML 标签数超过限制（50000）');
      if (depth + 1 > 256) fail('XML 嵌套超过限制（256）');
      const changes = inspectAttributes(tag, namespaces);
      if (!/\/\s*>$/.test(tag)) { depth++; scopes.push(changes); }
      else restoreNamespaces(changes, namespaces);
    }
    cursor = end + 1;
  }
  if (depth) fail('XML 标签嵌套无效');
}

function parseXml(bytes, budget) {
  // Use the parser's public normalization before lexical namespace comparison,
  // so CRLF and other normalized line endings cannot hide duplicate attributes.
  const source = normalizeLineEndings(decodeXml(bytes));
  inspectXml(source, budget);
  let document;
  try {
    document = new DOMParser({ onError: (level, message) => { throw new Error(`${level}: ${message}`); } }).parseFromString(source, 'application/xml');
  } catch { fail('XML 解析无效'); }
  const pending = [document];
  while (pending.length) {
    const node = pending.pop();
    budget.nodes += 1 + (node.attributes?.length || 0);
    if (budget.nodes > DOCX_LIMITS.nodes) fail('XML 节点数超过限制（50000）');
    if (node.attributes) {
      const names = new Set();
      for (let i = 0; i < node.attributes.length; i++) {
        const attr = node.attributes.item(i);
        const key = `${attr.namespaceURI || ''}\u0000${attr.localName}`;
        if (names.has(key)) fail('XML 扩展属性名称重复');
        names.add(key);
      }
    }
    elementFeatures(node, budget.features);
    for (let child = node.lastChild; child; child = child.previousSibling) pending.push(child);
  }
  return document;
}

function contentTypes(root, aliases) {
  if (!is(root, CT, 'Types')) fail('内容类型根命名空间无效');
  schemaAttributes(root, [], '内容类型');
  const defaults = new Map();
  const overrides = new Map();
  for (const item of children(root)) {
    const type = mime(item.getAttribute('ContentType') || '');
    if (macro(type)) fail('宏内容类型不支持');
    item.setAttribute('ContentType', type);
    if (is(item, CT, 'Default')) {
      schemaAttributes(item, ['Extension', 'ContentType'], '内容类型');
      const extension = (item.getAttribute('Extension') || '').toLowerCase();
      if (!/^[a-z0-9_-]+$/.test(extension) || defaults.has(extension)) fail('内容类型扩展名无效或重复');
      defaults.set(extension, type);
      item.setAttribute('Extension', extension);
    } else if (is(item, CT, 'Override')) {
      schemaAttributes(item, ['PartName', 'ContentType'], '内容类型');
      const name = item.getAttribute('PartName') || '';
      if (!name.startsWith('/') || name.split('/').some(segment => segment === '.' || segment === '..')) fail('内容类型覆盖路径必须是包根部件名称');
      const resolved = resolveTarget(name, '', aliases);
      if (overrides.has(resolved)) fail('内容类型覆盖部件重复');
      overrides.set(resolved, type);
      item.setAttribute('PartName', `/${resolved}`);
    } else fail('内容类型条目无效');
    if (children(item).length) fail('内容类型条目不能嵌套');
  }
  return name => {
    const key = packageAlias(name);
    const last = key.slice(key.lastIndexOf('/') + 1);
    return overrides.get(name) || (last.includes('.') ? defaults.get(last.slice(last.lastIndexOf('.') + 1).toLowerCase()) : undefined);
  };
}

function readRelationships(root, path, parts, aliases) {
  if (!is(root, REL, 'Relationships')) fail('关系根命名空间无效');
  schemaAttributes(root, [], '关系');
  const canonicalPath = packageAlias(path);
  let owner = '';
  if (canonicalPath !== '_rels/.rels') {
    const match = /^(?:(.*)\/)?_rels\/([^/]+)\.rels$/.exec(canonicalPath);
    if (!match) fail('关系部件路径无效');
    owner = aliases.get(`${match[1] ? `${match[1]}/` : ''}${match[2]}`);
    if (!owner || !parts.has(owner) || owner.endsWith('/')) fail('关系源部件不存在');
  }
  const base = owner.includes('/') ? owner.slice(0, owner.lastIndexOf('/')) : '';
  const ids = new Set();
  return children(root).map(item => {
    if (!is(item, REL, 'Relationship')) fail('关系条目命名空间无效');
    schemaAttributes(item, ['Id', 'Type', 'Target', 'TargetMode'], '关系');
    const id = item.getAttribute('Id') || '';
    const type = item.getAttribute('Type') || '';
    const target = item.getAttribute('Target') || '';
    const mode = item.getAttribute('TargetMode') || '';
    if (!XML_NCNAME.test(id) || ids.has(id) || !/^[a-z][a-z0-9+.-]*:[^\s\\]+$/i.test(type) || !target || !['', 'Internal', 'External'].includes(mode) || children(item).length) fail('关系属性或 ID 无效');
    if (macro(type)) fail('宏关系不支持');
    ids.add(id);
    if (mode === 'External') return { id, type, target, external: true };
    const hash = target.indexOf('#');
    let fragment;
    let part = target;
    if (hash >= 0) {
      if (type !== `${R}hyperlink` && type !== `${RS}hyperlink`) fail('关系目标片段类型不支持');
      try { fragment = decodeURIComponent(target.slice(hash + 1)); } catch { fail('关系目标片段编码无效'); }
      if (!fragment || fragment.length > 256 || !/^[\p{L}\p{N}_.:-]+$/u.test(fragment)) fail('关系目标片段不安全');
      part = target.slice(0, hash);
    }
    const resolved = part ? resolveTarget(part, packageAlias(base), aliases) : owner;
    if (!resolved || !parts.has(resolved)) fail('关系目标部件不存在');
    return { id, type, target: resolved, external: false, ...(fragment === undefined ? {} : { fragment }) };
  });
}

export function verifyDocxPackage(input) {
  const parts = expandDocxZip(input);
  const aliases = new Map();
  for (const name of parts.keys()) {
    aliases.set(packageAlias(name), name);
    if (/\/(?:vbaproject|vbadata)(?:\.|$)/i.test(`/${packageAlias(name)}`)) fail('宏 VBA 部件不支持');
    if (/^(?:EncryptionInfo|EncryptedPackage)$/i.test(name)) fail('加密 Office 部件不支持');
  }
  if (!parts.has('[Content_Types].xml')) fail('缺少内容类型部件');
  const documents = new Map();
  const budget = { tags: 0, nodes: 0, features: new Set() };
  const typeDocument = parseXml(parts.get('[Content_Types].xml'), budget);
  documents.set('[Content_Types].xml', typeDocument);
  const lookup = contentTypes(typeDocument.documentElement, aliases);
  for (const [name, bytes] of parts) {
    if (name.endsWith('/') || name === '[Content_Types].xml') continue;
    const type = lookup(name);
    if (!type) fail('包部件缺少内容类型');
    partFeatures(name, type, budget.features);
    const key = packageAlias(name);
    if (/\.rels$/i.test(key) && type !== RELTYPE) fail('关系部件内容类型无效');
    if (/\.(?:xml|rels)$/i.test(key) || type === 'application/xml' || type === 'text/xml' || type.endsWith('+xml')) documents.set(name, parseXml(bytes, budget));
  }
  const relationships = new Map();
  for (const [name, document] of documents) if (/\.rels$/i.test(packageAlias(name))) {
    const entries = readRelationships(document.documentElement, name, parts, aliases);
    for (const entry of entries) relationshipFeatures(entry, budget.features);
    relationships.set(name, entries);
  }
  const office = (relationships.get(aliases.get('_rels/.rels')) || []).filter(item => item.type === `${R}officeDocument` || item.type === `${RS}officeDocument`);
  if (office.length !== 1 || office[0].external) fail('必须有唯一内部 officeDocument 正文关系');
  const documentPath = office[0].target;
  if (lookup(documentPath) !== MAIN) fail('不支持的 Word 正文内容类型');
  const root = documents.get(documentPath)?.documentElement;
  const bodies = root ? children(root).filter(node => WORD.has(node.namespaceURI) && node.localName === 'body') : [];
  if (!root || !WORD.has(root.namespaceURI) || root.localName !== 'document' || bodies.length !== 1 || bodies[0].namespaceURI !== root.namespaceURI) fail('Word 正文根或 body 无效');
  const xmlParts = new Map();
  const serializer = new XMLSerializer();
  for (const [name, document] of documents) xmlParts.set(name, serializer.serializeToString(document.documentElement));
  return { parts, xmlParts, documentPath, relationships, warnings: [...WARNINGS].filter(([key]) => budget.features.has(key)).map(([, message]) => message) };
}
