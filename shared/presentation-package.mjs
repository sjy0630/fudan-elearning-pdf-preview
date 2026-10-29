import { DOMParser } from '@xmldom/xmldom';
import { expandBoundedZip, scanBoundedZip } from './docx-zip.mjs';
import { checkPresentationTransfer, PRESENTATION_LIMITS as L, PRESENTATION_WARNINGS as W, validatePresentationDimensions } from './presentation-policy.mjs';

const fail = message => { throw new Error(`幻灯片 ${message}。`); };
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const children = root => Array.from(root.childNodes || []).filter(n => n.nodeType === 1);
const is = (n, ns, local) => n?.namespaceURI === ns && n.localName === local;
const macro = value => /macroenabled|vbaproject|vbadata|vbaProjectSignature/i.test(value);

// A linear allocation gate precedes xmldom; it does not load entities or URLs.
export function parsePresentationXml(source, budget = { nodes: 0 }, limit = L.nodes) {
  if (typeof source !== 'string' || source.length > L.xmlBytes || /<!\s*(?:DOCTYPE|ENTITY)/i.test(source)) fail('XML 大小超过限制或包含不支持的实体');
  let tags = 0, depth = 0;
  for (let at = 0; at < source.length;) {
    const open = source.indexOf('<', at);
    if (open < 0) break;
    if (source.startsWith('<!--', open) || source.startsWith('<![CDATA[', open) || source.startsWith('<?', open)) {
      const ending = source.startsWith('<!--', open) ? '-->' : source.startsWith('<![CDATA[', open) ? ']]>' : '?>';
      const end = source.indexOf(ending, open + 2);
      if (end < 0) fail('XML 结构截断');
      at = end + ending.length; continue;
    }
    let quote = '', end = open + 1;
    for (; end < source.length; end++) {
      const char = source[end];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end === source.length) fail('XML 结构截断');
    if (source[open + 1] === '/') depth--;
    else { if (++tags > limit || ++depth > 128) fail('XML 节点数量或嵌套超过限制'); if (source[end - 1] === '/') depth--; }
    if (depth < 0) fail('XML 嵌套无效');
    at = end + 1;
  }
  if (depth) fail('XML 嵌套无效');
  let doc;
  try { doc = new DOMParser({ onError: () => { throw new Error('XML'); } }).parseFromString(source, 'application/xml'); }
  catch { fail('XML 解析无效'); }
  if (children(doc).length !== 1) fail('XML 根元素无效');
  const pending = [doc.documentElement];
  while (pending.length) {
    const node = pending.pop();
    budget.nodes += 1 + (node.attributes?.length || 0);
    if (budget.nodes > limit) fail('XML 节点和属性数量超过限制');
    if (node.nodeType === 1 && node.prefix && !node.namespaceURI) fail('XML 命名空间无效');
    for (const child of Array.from(node.childNodes || [])) pending.push(child);
  }
  return doc;
}
function decode(bytes) {
  let encoding = 'utf-8';
  if (bytes[0] === 255 && bytes[1] === 254 || bytes[0] === 60 && bytes[1] === 0) encoding = 'utf-16le';
  else if (bytes[0] === 254 && bytes[1] === 255 || bytes[0] === 0 && bytes[1] === 60) encoding = 'utf-16be';
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes); } catch { fail('XML 编码无效'); }
}
function targetPath(target, base) {
  if (!target || /[\\?#:%\x00-\x20]/.test(target)) fail('内部关系路径无效');
  const parts = target.startsWith('/') ? [] : base.split('/').filter(Boolean);
  for (const part of target.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) fail('内部关系路径越界'); parts.pop(); }
    else parts.push(part);
  }
  return parts.join('/');
}
function verifyPptx(bytes) {
  const names = new Set(scanBoundedZip(bytes, L).map(entry => entry.name));
  const documents = new Map(), budget = { nodes: 0 }, warnings = new Set([W.static, W.fonts]);
  for (const name of names) {
    if (macro(name) || /(?:^|\/)(?:EncryptionInfo|EncryptedPackage)$/i.test(name)) fail('宏或加密文件不支持');
    if (/\.(?:wmf|emf|pict|svg)$/i.test(name)) warnings.add(W.vector);
  }
  // First expand only the manifest and relationship records. They establish
  // XML types/roles before any nonstandard-suffix part can allocate output.
  const manifest = expandBoundedZip(bytes, L, { select: name => name === '[Content_Types].xml' || /\.rels$/i.test(name) });
  for (const [name, data] of manifest) documents.set(name, parsePresentationXml(decode(data), budget));
  const ct = documents.get('[Content_Types].xml')?.documentElement;
  if (!is(ct, CT, 'Types')) fail('缺少有效的内容类型部件');
  const defaults = new Map(), overrides = new Map();
  for (const item of children(ct)) {
    const type = item.getAttribute('ContentType') || '';
    if (!type || macro(type)) fail('宏或无效的内容类型不支持');
    if (is(item, CT, 'Default')) {
      const ext = item.getAttribute('Extension')?.toLowerCase();
      if (!/^[a-z0-9]+$/.test(ext || '') || defaults.has(ext)) fail('内容类型扩展名无效或重复');
      defaults.set(ext, type);
    } else if (is(item, CT, 'Override')) {
      const target = item.getAttribute('PartName') || '';
      if (!target.startsWith('/')) fail('内容类型路径无效');
      const name = targetPath(target, '');
      if (!names.has(name) || overrides.has(name)) fail('内容类型路径缺失或重复');
      overrides.set(name, type);
    } else fail('内容类型条目无效');
  }
  const typeOf = name => overrides.get(name) || defaults.get(name.split('.').pop().toLowerCase());
  const relationships = new Map();
  for (const name of names) {
    if (name.endsWith('/') || name === '[Content_Types].xml') continue;
    if (!typeOf(name)) fail('包部件缺少内容类型');
    if (!name.endsWith('.rels')) continue;
    const root = documents.get(name)?.documentElement;
    if (!is(root, REL, 'Relationships') || typeOf(name) !== 'application/vnd.openxmlformats-package.relationships+xml') fail('关系部件无效');
    const owner = name === '_rels/.rels' ? '' : name.replace(/(^|\/)\_rels\/([^/]+)\.rels$/, '$1$2');
    if (owner && (!names.has(owner) || owner === name)) fail('关系源部件缺失');
    const base = owner.includes('/') ? owner.slice(0, owner.lastIndexOf('/')) : '';
    const rels = new Map();
    for (const item of children(root)) {
      const id = item.getAttribute('Id'), type = item.getAttribute('Type'), target = item.getAttribute('Target'), mode = item.getAttribute('TargetMode') || '';
      if (!is(item, REL, 'Relationship') || !id || rels.has(id) || !type || !target || !['', 'Internal', 'External'].includes(mode) || macro(type)) fail('关系属性无效或宏关系不支持');
      if (mode === 'External') {
        // The engine stores an external target literally and may look it up
        // in its local ZIP map. Reject that alias before skipping XML roles.
        if (names.has(target)) fail('外部关系不能引用同名包内部件');
        warnings.add(W.external); rels.set(id, { type, external: true }); continue;
      }
      // Internal slide hyperlinks may carry a fragment, but never load a URL.
      const resolved = targetPath(target.split('#')[0], base);
      if (!names.has(resolved)) fail('关系目标部件缺失');
      rels.set(id, { type, target: resolved, external: false });
    }
    relationships.set(owner, rels);
  }
  const xmlNames = new Set([...names].filter(name => /\.(?:xml|rels)$/i.test(name) || /(?:\+xml$|^(?:application|text)\/xml$)/i.test(typeOf(name) || '')));
  const binaryRoles = new Set(['image', 'audio', 'video', 'media', 'oleObject', 'package', 'font', 'fontData', 'printerSettings']);
  for (const rels of relationships.values()) for (const rel of rels.values()) {
    if (!rel.external && !binaryRoles.has(rel.type.slice(rel.type.lastIndexOf('/') + 1))) xmlNames.add(rel.target);
  }
  // Both declared sizes and actual Inflate output now use the XML budget,
  // including e.g. a theme stored as .bin with an opaque declared MIME.
  const parts = expandBoundedZip(bytes, L, { isXmlPart: name => xmlNames.has(name) });
  for (const [name, data] of parts) if (xmlNames.has(name) && !documents.has(name)) documents.set(name, parsePresentationXml(decode(data), budget));
  const office = [...(relationships.get('')?.values() || [])].filter(r => r.type === `${R}/officeDocument`);
  if (office.length !== 1 || office[0].external || office[0].target !== 'ppt/presentation.xml') fail('缺少唯一的 PowerPoint 主部件关系');
  if (typeOf('ppt/presentation.xml') !== 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml') fail('PowerPoint 主部件类型不符');
  const root = documents.get('ppt/presentation.xml')?.documentElement;
  if (!is(root, P, 'presentation')) fail('PowerPoint 主部件根元素无效');
  const list = children(root).filter(n => is(n, P, 'sldIdLst'));
  const size = children(root).filter(n => is(n, P, 'sldSz'));
  if (list.length !== 1 || size.length !== 1) fail('幻灯片列表或画布缺失');
  validatePresentationDimensions(Number(size[0].getAttribute('cx')) / 9525, Number(size[0].getAttribute('cy')) / 9525);
  const slides = children(list[0]), used = new Set();
  if (!slides.length || slides.length > L.slides) fail('幻灯片页数无效或超过限制（500 页）');
  for (const slide of slides) {
    const id = slide.getAttributeNS(R, 'id'), rel = relationships.get('ppt/presentation.xml')?.get(id);
    if (!is(slide, P, 'sldId') || !rel || rel.external || rel.type !== `${R}/slide` || used.has(rel.target)) fail('幻灯片关系无效或重复');
    used.add(rel.target);
    if (typeOf(rel.target) !== 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml' || !is(documents.get(rel.target)?.documentElement, P, 'sld')) fail('幻灯片正文部件无效');
  }
  return { parseBytes: bytes, slideCount: slides.length, warnings: [...warnings] };
}

// The upstream reader allocates whole FAT chains before clipping to stream size.
// Validate unique finite chains and their physical backing before it runs.
function verifyPpt(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), END = 0xfffffffe, FREE = 0xffffffff;
  if (bytes.length < 512) fail('PPT CFB 头部截断');
  const u16 = at => dv.getUint16(at, true), u32 = at => dv.getUint32(at, true);
  const version = u16(26), shift = u16(30);
  if (u16(28) !== 0xfffe || !((version === 3 && shift === 9) || (version === 4 && shift === 12)) || u16(32) !== 6 || u32(56) !== 4096) fail('PPT CFB 版本或扇区参数无效');
  const sector = 2 ** shift, count = bytes.length / sector - 1, per = sector / 4;
  if (!Number.isInteger(count) || count < 1) fail('PPT CFB 扇区范围无效');
  const at = id => { if (!Number.isInteger(id) || id < 0 || id >= count) fail('PPT CFB 扇区越界'); return (id + 1) * sector; };
  const occupied = new Set(), claim = id => { at(id); if (occupied.has(id)) fail('PPT CFB 扇区重叠或循环'); occupied.add(id); };
  const fatIds = [];
  for (let i = 0; i < 109; i++) if (u32(76 + i * 4) !== FREE) fatIds.push(u32(76 + i * 4));
  let dif = u32(68), difCount = 0;
  while (dif !== END && dif !== FREE) {
    claim(dif); difCount++;
    if (difCount > u32(72) || difCount > count) fail('PPT CFB DIFAT 数量无效');
    const pos = at(dif);
    for (let i = 0; i < per - 1; i++) if (u32(pos + i * 4) !== FREE) fatIds.push(u32(pos + i * 4));
    dif = u32(pos + sector - 4);
  }
  if (difCount !== u32(72) || fatIds.length !== u32(44) || fatIds.length > Math.ceil(count / per) + 1 || fatIds.length * per < count) fail('PPT CFB FAT 数量无效');
  const fat = [];
  for (const id of fatIds) { claim(id); for (let p = at(id); p < at(id) + sector; p += 4) fat.push(u32(p)); }
  const chain = (start, table, max, seen) => {
    const ids = [];
    for (let id = start; id !== END && id !== FREE; id = table[id]) {
      if (!Number.isInteger(id) || id < 0 || id >= max || id >= table.length || seen.has(id)) fail('PPT CFB 链越界、重叠或循环');
      seen.add(id); ids.push(id);
      if (ids.length * 64 > L.expandedBytes) fail('PPT CFB 链超过限制');
    }
    return ids;
  };
  const physical = start => chain(start, fat, count, occupied);
  const read = (ids, size, unit = sector, source = bytes, offsets = ids.map(id => at(id))) => {
    if (!Number.isSafeInteger(size) || size < 0 || size > L.entryBytes || Math.ceil(size / unit) !== ids.length) fail('PPT CFB 声明流大小与分配不符');
    const out = new Uint8Array(size);
    for (let i = 0; i < ids.length; i++) out.set(source.subarray(offsets[i], offsets[i] + Math.min(unit, size - i * unit)), i * unit);
    return out;
  };
  const dirIds = physical(u32(48));
  if (dirIds.length * sector / 128 > L.entries) fail('PPT CFB 目录条目超过限制');
  const dir = read(dirIds, dirIds.length * sector), dd = new DataView(dir.buffer), entries = [];
  for (let p = 0; p < dir.length; p += 128) {
    const type = dir[p + 66];
    if (!type) continue;
    const len = dd.getUint16(p + 64, true);
    if (![1, 2, 5].includes(type) || len < 2 || len > 64 || len % 2 || dd.getUint16(p + len - 2, true)) fail('PPT CFB 目录条目无效');
    const name = new TextDecoder('utf-16le', { fatal: true }).decode(dir.subarray(p, p + len - 2));
    if (dd.getUint32(p + 124, true)) fail('PPT CFB 声明流大小超过限制');
    if (/^(?:VBA|_VBA_PROJECT|PROJECT|EncryptionInfo|EncryptedPackage)$/i.test(name)) fail('PPT 宏或加密流不支持');
    entries.push({ name, type, start: dd.getUint32(p + 116, true), size: dd.getUint32(p + 120, true) });
  }
  const roots = entries.filter(e => e.type === 5);
  if (roots.length !== 1) fail('PPT CFB 根目录无效');
  const miniIds = physical(u32(60));
  if (miniIds.length !== u32(64)) fail('PPT CFB MiniFAT 数量无效');
  const miniBytes = read(miniIds, miniIds.length * sector), md = new DataView(miniBytes.buffer), miniFat = [];
  for (let i = 0; i < miniBytes.length; i += 4) miniFat.push(md.getUint32(i, true));
  const rootIds = physical(roots[0].start), miniStream = read(rootIds, roots[0].size), miniUsed = new Set(), streams = new Map();
  let total = 0;
  for (const entry of entries.filter(e => e.type === 2)) {
    if (/(?:^|\b)(?:VBA|_VBA_PROJECT|PROJECT|EncryptionInfo|EncryptedPackage)(?:$|\b)/i.test(entry.name)) fail('PPT 宏或加密流不支持');
    total += entry.size;
    if (entry.size > L.entryBytes || total > L.expandedBytes) fail('PPT CFB 流大小超过限制');
    const small = entry.size < 4096;
    const ids = small ? chain(entry.start, miniFat, Math.ceil(miniStream.length / 64), miniUsed) : physical(entry.start);
    const data = read(ids, entry.size, small ? 64 : sector, small ? miniStream : bytes, small ? ids.map(i => i * 64) : undefined);
    const key = entry.name.toLowerCase();
    if (['powerpoint document', 'current user', 'pictures'].includes(key)) {
      if (streams.has(key)) fail('PPT 关键流重复');
      streams.set(key, { data, offsets: small ? ids.map(i => at(rootIds[Math.floor(i * 64 / sector)]) + i * 64 % sector) : ids.map(i => at(i)), unit: small ? 64 : sector });
    }
  }
  const main = streams.get('powerpoint document')?.data, current = streams.get('current user')?.data;
  if (!main || !current || current.length < 16) fail('缺少真实 PPT PowerPoint Document 或 Current User 流');
  if (new DataView(current.buffer).getUint32(12, true) === 4090610911) fail('加密 PPT 不支持');
  const mv = new DataView(main.buffer), pending = [[0, main.length, 0]];
  let records = 0, documentSeen = false, slideRecords = 0;
  while (pending.length) {
    const [start, end, depth] = pending.pop();
    for (let p = start; p < end;) {
      if (p + 8 > end || ++records > L.nodes || depth > 64) fail('PPT 记录数量、嵌套或范围无效');
      const type = mv.getUint16(p + 2, true), len = mv.getUint32(p + 4, true), stop = p + 8 + len;
      if (stop > end) fail('PPT 记录截断');
      if (type === 1000) documentSeen = true;
      if (type === 1006 && ++slideRecords > L.slides) fail('PPT 幻灯片超过限制（500 页）');
      if (type === 12052) fail('加密 PPT 不支持');
      if ((mv.getUint16(p, true) & 15) === 15 && len) pending.push([p + 8, stop, depth + 1]);
      p = stop;
    }
  }
  if (!documentSeen || !slideRecords) fail('缺少真实 PPT 演示文稿或幻灯片记录');
  const warnings = [W.static, W.fonts], pictures = streams.get('pictures');
  let parseBytes = bytes;
  if (pictures) {
    const pv = new DataView(pictures.data.buffer);
    for (let p = 0; p < pictures.data.length;) {
      // PowerPoint pads the Pictures stream with zero bytes.
      if (pictures.data[p] === 0 && pictures.data.subarray(p).every(byte => byte === 0)) break;
      if (p + 8 > pictures.data.length) fail('PPT 图片记录截断');
      const len = pv.getUint32(p + 4, true), end = p + 8 + len, type = pv.getUint16(p + 2, true);
      if (end > pictures.data.length) fail('PPT 图片记录截断');
      if ([61466, 61467, 61468].includes(type)) {
        const offset = p + 8 + ((pv.getUint16(p, true) >> 4 & 1) ? 32 : 16) + 32;
        if (offset + 2 > end) fail('PPT 矢量图片头部截断');
        // Keep the blip index while bypassing upstream metafile decompression.
        // Its declared expansion can otherwise allocate gigabytes before hooks.
        if (parseBytes === bytes) parseBytes = Uint8Array.from(bytes);
        parseBytes[pictures.offsets[Math.floor(offset / pictures.unit)] + offset % pictures.unit] = 254;
        if (!warnings.includes(W.vector)) warnings.push(W.vector);
      }
      p = end;
    }
  }
  return { parseBytes, warnings, slideCount: null };
}
export function verifyPresentationPackage(input, format, mime = '') {
  const bytes = checkPresentationTransfer(input, format, mime);
  return format === 'pptx' ? verifyPptx(bytes) : verifyPpt(bytes);
}
