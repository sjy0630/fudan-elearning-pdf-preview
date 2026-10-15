import mammoth from 'mammoth';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { Zip, ZipPassThrough } from 'fflate';
import { verifyDocxPackage } from './docx-package.mjs';
import { DOCX_LIMITS } from './docx-policy.mjs';

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const RS = 'http://purl.oclc.org/ooxml/officeDocument/relationships/';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WORD = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']);
const encoder = new TextEncoder();
const IMAGE_WARNING = '部分图片暂不支持预览，已显示占位说明。';
const CONVERSION_WARNING = '部分文档格式无法完整转换，预览可能有所省略。';
const fail = message => { throw new Error(`DOCX ${message}。`); };
const kind = type => type.startsWith(R) ? type.slice(R.length) : type.startsWith(RS) ? type.slice(RS.length) : '';
const decodeName = name => { for (let i = 0; i < 16 && /%[0-9a-f]{2}/i.test(name); i++) name = decodeURIComponent(name); return name; };
// A basic paragraph/run/text/text-node uses four source nodes. This headroom
// accepts the exact output-node boundary, while bounding the intermediate work
// of repeated notes, including empty formatting later simplified by Mammoth.
const NOTE_EXPANSION_WORK = DOCX_LIMITS.nodes * 4;
let sequence = 0;

function boundedUtf8Length(value, limit, escaped = false) {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (escaped && code === 38) bytes += 5;
    else if (escaped && (code === 60 || code === 62)) bytes += 4;
    else if (escaped && code === 34) bytes += 6;
    else if (escaped && code === 13) bytes += 5;
    else if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else bytes += 3;
    if (bytes > limit) return limit + 1;
  }
  return bytes;
}

const wordAttribute = (node, name) => {
  for (const namespace of WORD) if (node.hasAttributeNS(namespace, name)) return node.getAttributeNS(namespace, name);
  return '';
};
const drawingImage = node => (/\/drawingml\/(?:2006\/)?main$/.test(node.namespaceURI || '') && node.localName === 'blip') || (node.namespaceURI === 'urn:schemas-microsoft-com:vml' && node.localName === 'imagedata');

function checkNoteExpansion(verified, documents, relationsByOwner) {
  const references = new Map();
  const pending = [documents.get(verified.documentPath).documentElement];
  while (pending.length) {
    const node = pending.pop();
    if (node.nodeType === 1 && WORD.has(node.namespaceURI) && ['footnoteReference', 'endnoteReference'].includes(node.localName)) {
      const key = `${node.localName.slice(0, -9)}:${wordAttribute(node, 'id')}`;
      references.set(key, (references.get(key) || 0) + 1);
    }
    for (let child = node.lastChild; child; child = child.previousSibling) pending.push(child);
  }
  let work = 0, bytes = 0, images = 0;
  for (const type of ['footnote', 'endnote']) {
    const relation = [...(relationsByOwner.get(verified.documentPath)?.values() || [])].find(entry => !entry.external && kind(entry.type) === `${type}s`);
    // Match the public converter's conventional fallback when no related part exists.
    const document = documents.get(relation?.target || `word/${type}s.xml`);
    if (!document) continue;
    const notes = new Map();
    for (const node of document.documentElement.childNodes) if (node.nodeType === 1 && WORD.has(node.namespaceURI) && node.localName === type && !['separator', 'continuationSeparator'].includes(wordAttribute(node, 'type'))) notes.set(wordAttribute(node, 'id'), node);
    for (const [id, note] of notes) {
      const count = references.get(`${type}:${id}`) || 0;
      if (!count) continue;
      const nodes = [note];
      while (nodes.length) {
        const node = nodes.pop();
        work += count;
        if (work > NOTE_EXPANSION_WORK) fail('注释展开复杂度超过预览限制（转换 HTML 节点预算 50000）');
        if (node.nodeType === 3 || node.nodeType === 4) bytes += count * boundedUtf8Length(node.data, DOCX_LIMITS.htmlBytes, true);
        for (const attr of node.attributes || []) bytes += count * boundedUtf8Length(attr.value, DOCX_LIMITS.htmlBytes, true);
        if (bytes > DOCX_LIMITS.htmlBytes) fail('注释展开内容超过预览限制（转换 HTML 预算 4 MiB）');
        if (node.nodeType === 1 && drawingImage(node)) {
          images += count;
          if (images > DOCX_LIMITS.images) fail('图片引用数超过限制（200）');
        }
        for (let child = node.lastChild; child; child = child.previousSibling) nodes.push(child);
      }
    }
  }
  // Mammoth 1.13 snapshots main-document references before rendering note
  // bodies. Nested references emit markers, but do not recursively append notes.
  // Count all source nodes/attributes conservatively: final simplification may
  // produce less output. The exact final HTML budgets still apply separately.
}

function prepareWordAttributesAndFields(document) {
  let instructions = [];
  const clearNavigation = () => {
    if (/^\s*HYPERLINK(?:\s|$)/.test(instructions.map(node => node.textContent).join(''))) for (const node of instructions) node.textContent = '';
    instructions = [];
  };
  const pending = [document.documentElement];
  while (pending.length) {
    const node = pending.pop();
    if (node.nodeType === 1 && WORD.has(node.namespaceURI)) {
      // Mammoth folds both Word namespaces together. Reject distinct values,
      // including empty shadows, so preflight and conversion cannot disagree.
      const values = new Map();
      for (const attr of node.attributes) if (WORD.has(attr.namespaceURI)) {
        if (values.has(attr.localName) && values.get(attr.localName) !== attr.value) fail('转换副本 Word 属性存在歧义');
        values.set(attr.localName, attr.value);
      }
      if (node.localName === 'instrText') instructions.push(node);
      if (node.localName === 'fldChar') {
        const type = wordAttribute(node, 'fldCharType');
        if (type === 'begin') clearNavigation();
        if (type === 'separate' || type === 'end') clearNavigation();
      }
    }
    for (let child = node.lastChild; child; child = child.previousSibling) pending.push(child);
  }
  clearNavigation();
}

function parseCopy(source) {
  // The verifier has already performed XML 1.0 normalization. Any CR now in
  // its serialized text is a semantic character reference, not a line ending.
  return new DOMParser({ normalizeLineEndings: value => value, onError() { fail('转换副本 XML 无效'); } }).parseFromString(source, 'application/xml');
}

function contentTypeLookup(document) {
  const defaults = new Map(), overrides = new Map();
  for (const node of document.documentElement.childNodes) {
    if (node.nodeType !== 1) continue;
    if (node.localName === 'Default') defaults.set(node.getAttribute('Extension'), node.getAttribute('ContentType'));
    if (node.localName === 'Override') overrides.set(node.getAttribute('PartName').slice(1), node.getAttribute('ContentType'));
  }
  return {
    verified: name => overrides.get(name) || defaults.get(decodeName(name).split('.').pop().toLowerCase()),
    literal: name => overrides.get(name) || defaults.get(name.split('.').pop()),
  };
}

function conversionNames(verified) {
  if (verified.parts.size > DOCX_LIMITS.entries) fail('转换副本部件数超过限制（1000）');
  const aliases = new Map([...verified.parts.keys()].map(name => [decodeName(name), name]));
  const names = new Map([...verified.parts.keys()].map(name => [name, name]));
  const owners = new Map();
  for (const name of verified.relationships.keys()) {
    const canonical = decodeName(name);
    if (canonical === '_rels/.rels') { names.set(name, '_rels/.rels'); owners.set(name, ''); continue; }
    const match = /^(?:(.*)\/)?_rels\/([^/]+)\.rels$/.exec(canonical);
    const owner = aliases.get(`${match[1] ? match[1] + '/' : ''}${match[2]}`);
    if (!owner) fail('转换副本关系源无效');
    const slash = owner.lastIndexOf('/');
    names.set(name, `${slash < 0 ? '' : owner.slice(0, slash + 1)}_rels/${owner.slice(slash + 1)}.rels`);
    owners.set(name, owner);
  }
  const destinations = new Set();
  for (const destination of names.values()) {
    if (destinations.has(destination)) fail('转换副本部件名称冲突');
    destinations.add(destination);
  }
  return { names, owners };
}

function checkOutputNodes(html) {
  // Mammoth escapes literal '<' in text/attributes. Count opening tags first
  // to reject excessive element output before allocating a parsed tree.
  let elements = 0;
  for (const ignored of html.matchAll(/<[A-Za-z]/g)) {
    if (++elements > DOCX_LIMITS.nodes) fail('转换 HTML 节点数超过限制（50000）');
  }
  const document = new DOMParser({
    normalizeLineEndings: value => value.replace(/\r\n?/g, '\n'),
    onError() { fail('转换 HTML 无效'); },
  }).parseFromString(`<div>${html}</div>`, 'text/html');
  const wrapper = document.documentElement, pending = [wrapper];
  let nodes = 0;
  while (pending.length) {
    const node = pending.pop();
    // As at the package gate, the budget includes attributes and all DOM nodes.
    // Only the synthetic counting wrapper and Document are excluded.
    if (node !== wrapper) nodes += 1 + (node.attributes?.length || 0);
    if (nodes > DOCX_LIMITS.nodes) fail('转换 HTML 节点数超过限制（50000）');
    for (let child = node.lastChild; child; child = child.previousSibling) pending.push(child);
  }
}

// Mammoth's public converter expects UTF-8, transitional relationship types and
// absolute image targets. Normalize a separate STORE archive of verified parts.
// Neither a second expansion nor a second package verification is performed.
function conversionCopy(verified, warn) {
  const { names, owners } = conversionNames(verified);
  const documents = new Map([...verified.xmlParts].map(([name, source]) => [name, parseCopy(source)]));
  const lookup = contentTypeLookup(documents.get('[Content_Types].xml'));
  const typesRoot = documents.get('[Content_Types].xml').documentElement;
  const overrides = new Map();
  for (const node of typesRoot.childNodes) if (node.nodeType === 1 && node.localName === 'Override') {
    const destination = names.get(node.getAttribute('PartName').slice(1));
    node.setAttribute('PartName', '/' + destination); overrides.set(destination, node);
  }
  // Mammoth's extension lookup is literal and case-sensitive. Preserve the
  // verifier's URI-aware image MIME with an explicit override when needed.
  for (const name of verified.parts.keys()) {
    const type = lookup.verified(name);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(type) || lookup.literal(name) === type) continue;
    const destination = names.get(name);
    let node = overrides.get(destination);
    if (!node) {
      node = typesRoot.ownerDocument.createElementNS(typesRoot.namespaceURI, 'Override');
      node.setAttribute('PartName', '/' + destination); typesRoot.appendChild(node); overrides.set(destination, node);
    }
    node.setAttribute('ContentType', type);
  }
  const relationsByOwner = new Map();
  for (const [name, entries] of verified.relationships) {
    relationsByOwner.set(owners.get(name), new Map(entries.map(entry => [entry.id, entry])));
    const nodes = documents.get(name).getElementsByTagNameNS(REL, 'Relationship');
    for (const node of nodes) {
      const entry = entries.find(entry => entry.id === node.getAttribute('Id'));
      if (entry.type.startsWith(RS)) node.setAttribute('Type', R + entry.type.slice(RS.length));
      if (!entry.external) node.setAttribute('Target', `/${names.get(entry.target)}${entry.fragment ? '#' + entry.fragment : ''}`);
    }
  }
  let imageReferences = 0;
  for (const [name, doc] of documents) {
    prepareWordAttributesAndFields(doc);
    const relationships = relationsByOwner.get(name) || new Map();
    const pending = [doc.documentElement];
    while (pending.length) {
      const node = pending.pop();
      // Mammoth discards CDATA nodes; converting them to text preserves semantics.
      if (node.nodeType === 4) { node.parentNode.replaceChild(doc.createTextNode(node.data), node); continue; }
      if (node.nodeType !== 1) continue;
      // Queue children before unwrapping/replacing containers so every image
      // reference is counted, including those inside external hyperlinks.
      for (let child = node.lastChild; child; child = child.previousSibling) pending.push(child);
      // Only fixed short style names have a semantic mapping in our options or
      // Mammoth's default map. Longer names affect diagnostic text alone, which
      // Mammoth otherwise copies once per styled paragraph/run before deduping.
      // Preserve IDs and definitions; the public result uses fixed warnings.
      if (WORD.has(node.namespaceURI) && node.localName === 'name' && WORD.has(node.parentNode?.namespaceURI) && node.parentNode.localName === 'style' && wordAttribute(node, 'val').length > 64) {
        for (const namespace of WORD) if (node.hasAttributeNS(namespace, 'val')) node.setAttributeNS(namespace, node.getAttributeNodeNS(namespace, 'val').name, 'DOCX unsupported style');
        warn(CONVERSION_WARNING);
      }
      // Navigation is removed by the preview; discard it before Mammoth can
      // repeat long relationship targets once per image or field display run.
      if (/\/drawingml\/(?:2006\/)?main$/.test(node.namespaceURI || '') && ['hlinkClick', 'hlinkHover'].includes(node.localName)) { node.parentNode.removeChild(node); continue; }
      if (drawingImage(node)) {
        if (++imageReferences > DOCX_LIMITS.images) fail('图片引用数超过限制（200）');
        // Link-only images take Mammoth's external-file path even when their
        // relationship target is internal. Only embedded references are used.
        const attribute = node.localName === 'blip' ? 'embed' : 'id';
        const transitional = node.getAttributeNS(R.slice(0, -1), attribute);
        const strict = node.getAttributeNS(RS.slice(0, -1), attribute);
        // Mammoth folds both namespaces into 'r'. Distinct values (including
        // an explicit empty shadow) must not depend on source attribute order.
        const ambiguous = node.hasAttributeNS(R.slice(0, -1), attribute) && node.hasAttributeNS(RS.slice(0, -1), attribute) && transitional !== strict;
        const id = transitional || strict;
        const entry = relationships.get(id);
        if (ambiguous || !entry || entry.external || kind(entry.type) !== 'image' || !['image/png', 'image/jpeg', 'image/webp'].includes(lookup.verified(entry.target))) {
          warn(IMAGE_WARNING);
          let container = node;
          while (container.parentNode && !(WORD.has(container.namespaceURI) && ['drawing', 'pict', 'object'].includes(container.localName))) container = container.parentNode;
          if (container !== doc && container.parentNode && WORD.has(container.namespaceURI)) {
            const text = doc.createElementNS(container.namespaceURI, 'w:t'); text.textContent = '[图片暂不支持预览]'; container.parentNode.replaceChild(text, container);
          }
        }
      }
      if (WORD.has(node.namespaceURI) && node.localName === 'hyperlink') {
        while (node.firstChild) node.parentNode.insertBefore(node.firstChild, node);
        node.parentNode.removeChild(node);
      }
    }
  }
  checkNoteExpansion(verified, documents, relationsByOwner);
  const parts = new Map(); let total = 0;
  const serializer = new XMLSerializer();
  for (const [name, original] of verified.parts) {
    let bytes = original;
    if (documents.has(name)) {
      // Protect semantic CR and legal NEL/LS/PS from downstream line-ending
      // normalization using references in the separate conversion archive.
      bytes = encoder.encode(serializer.serializeToString(documents.get(name).documentElement).replace(/[\r\u0085\u2028\u2029]/g, char => `&#${char.codePointAt(0)};`));
      if (bytes.byteLength > DOCX_LIMITS.xmlBytes) fail('转换副本 XML 大小超过限制（4 MiB）');
    }
    total += bytes.byteLength;
    if (total > DOCX_LIMITS.expandedBytes) fail('转换副本内容大小超过限制（60 MiB）');
    parts.set(names.get(name), bytes);
  }
  const chunks = []; let size = 0;
  const archive = new Zip((error, chunk) => { if (error) throw error; size += chunk.byteLength; chunks.push(chunk); });
  for (const [name, bytes] of parts) {
    const entry = new ZipPassThrough(name); archive.add(entry); entry.push(bytes, true);
  }
  archive.end();
  const copy = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { copy.set(chunk, offset); offset += chunk.byteLength; }
  return copy;
}

/** Returned HTML remains untrusted until the preview sanitizer processes it. */
export async function convertDocx(input, { idPrefix, onVerified } = {}) {
  const verified = verifyDocxPackage(input);
  if (onVerified) await onVerified();
  const warnings = [];
  const warn = message => { if (!warnings.includes(message) && warnings.length < 32) warnings.push(message); };
  for (const message of verified.warnings) warn(message);
  const copy = conversionCopy(verified, warn);
  const images = []; let imageBytes = 0, imageError;
  // Prefixes are isolated per conversion; caller markup never enters identifiers.
  const prefix = `${typeof idPrefix === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(idPrefix) ? idPrefix : 'docx-'}${++sequence}-`;
  let result;
  try {
    result = await mammoth.convertToHtml({ buffer: copy, arrayBuffer: copy.buffer }, {
      includeEmbeddedStyleMap: false, externalFileAccess: false, idPrefix: prefix,
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Heading 1'] => h1:fresh", "p[style-name='Heading 2'] => h2:fresh", "p[style-name='Heading 3'] => h3:fresh", 'u => u'],
      convertImage: mammoth.images.imgElement(async image => {
        try {
          if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.contentType)) { warn(IMAGE_WARNING); return { alt: '[图片暂不支持预览]' }; }
          const source = await image.readAsArrayBuffer();
          const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
          if (images.length >= DOCX_LIMITS.images) fail('图片引用数超过限制（200）');
          if (bytes.byteLength > DOCX_LIMITS.entryBytes) fail('单张图片大小超过限制（20 MiB）');
          if (imageBytes + bytes.byteLength > DOCX_LIMITS.expandedBytes) fail('图片总大小超过限制（60 MiB）');
          const id = `docx-image-${images.length + 1}`;
          imageBytes += bytes.byteLength;
          images.push({ id, mime: image.contentType, bytes: Uint8Array.from(bytes) });
          return { src: id };
        } catch (error) { imageError ||= error; throw error; }
      }),
    });
  } catch { fail('文档转换失败'); }
  // Mammoth deliberately recovers image callback errors; limits must stay fatal.
  if (imageError) throw imageError;
  // HTML parsers also normalize literal CR. A reference keeps the semantic CR
  // through the later sanitizer's parse without interpreting any user markup.
  const html = result.value.replace(/\r/g, '&#13;');
  if (boundedUtf8Length(html, DOCX_LIMITS.htmlBytes) > DOCX_LIMITS.htmlBytes) fail('转换 HTML 大小超过限制（4 MiB）');
  checkOutputNodes(html);
  if (result.messages.length) warn(CONVERSION_WARNING);
  return { html, images, warnings };
}
