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
let sequence = 0;

function parseCopy(source) {
  return new DOMParser({ normalizeLineEndings: value => value.replace(/\r\n?/g, '\n'), onError() { fail('转换副本 XML 无效'); } }).parseFromString(source, 'application/xml');
}

function contentTypeLookup(document) {
  const defaults = new Map(), overrides = new Map();
  for (const node of document.documentElement.childNodes) {
    if (node.nodeType !== 1) continue;
    if (node.localName === 'Default') defaults.set(node.getAttribute('Extension'), node.getAttribute('ContentType'));
    if (node.localName === 'Override') overrides.set(node.getAttribute('PartName').slice(1), node.getAttribute('ContentType'));
  }
  return name => overrides.get(name) || defaults.get(decodeName(name).split('.').pop().toLowerCase());
}

// Mammoth's public converter expects UTF-8, transitional relationship types and
// absolute image targets. Normalize a separate STORE archive of verified parts.
// Neither a second expansion nor a second package verification is performed.
function conversionCopy(verified, warn) {
  const documents = new Map([...verified.xmlParts].map(([name, source]) => [name, parseCopy(source)]));
  const lookup = contentTypeLookup(documents.get('[Content_Types].xml'));
  const relationsByOwner = new Map();
  for (const [name, entries] of verified.relationships) {
    const canonical = decodeName(name);
    const match = /^(?:(.*)\/)?_rels\/([^/]+)\.rels$/.exec(canonical);
    const owner = canonical === '_rels/.rels' ? '' : `${match[1] ? match[1] + '/' : ''}${match[2]}`;
    relationsByOwner.set(owner, new Map(entries.map(entry => [entry.id, entry])));
    const nodes = documents.get(name).getElementsByTagNameNS(REL, 'Relationship');
    for (const node of nodes) {
      const entry = entries.find(entry => entry.id === node.getAttribute('Id'));
      if (entry.type.startsWith(RS)) node.setAttribute('Type', R + entry.type.slice(RS.length));
      if (!entry.external) node.setAttribute('Target', `/${entry.target}${entry.fragment ? '#' + entry.fragment : ''}`);
    }
  }
  let imageReferences = 0;
  for (const [name, doc] of documents) {
    const relationships = relationsByOwner.get(decodeName(name)) || new Map();
    const pending = [doc.documentElement];
    while (pending.length) {
      const node = pending.pop();
      // Mammoth discards CDATA nodes; converting them to text preserves semantics.
      if (node.nodeType === 4) { node.parentNode.replaceChild(doc.createTextNode(node.data), node); continue; }
      if (node.nodeType !== 1) continue;
      // Queue children before unwrapping/replacing containers so every image
      // reference is counted, including those inside external hyperlinks.
      for (let child = node.lastChild; child; child = child.previousSibling) pending.push(child);
      const image = (/\/drawingml\/(?:2006\/)?main$/.test(node.namespaceURI || '') && node.localName === 'blip') || (node.namespaceURI === 'urn:schemas-microsoft-com:vml' && node.localName === 'imagedata');
      if (image) {
        if (++imageReferences > DOCX_LIMITS.images) fail('图片引用数超过限制（200）');
        const id = node.getAttributeNS(R.slice(0, -1), 'embed') || node.getAttributeNS(RS.slice(0, -1), 'embed') || node.getAttributeNS(R.slice(0, -1), 'link') || node.getAttributeNS(RS.slice(0, -1), 'link') || node.getAttributeNS(R.slice(0, -1), 'id') || node.getAttributeNS(RS.slice(0, -1), 'id');
        const entry = relationships.get(id);
        if (!entry || entry.external || kind(entry.type) !== 'image' || !['image/png', 'image/jpeg', 'image/webp'].includes(lookup(entry.target))) {
          warn(IMAGE_WARNING);
          let container = node;
          while (container.parentNode && !(WORD.has(container.namespaceURI) && ['drawing', 'pict', 'object'].includes(container.localName))) container = container.parentNode;
          if (container !== doc && container.parentNode && WORD.has(container.namespaceURI)) {
            const text = doc.createElementNS(container.namespaceURI, 'w:t'); text.textContent = '[图片暂不支持预览]'; container.parentNode.replaceChild(text, container);
          }
        }
      }
      if (WORD.has(node.namespaceURI) && node.localName === 'hyperlink') {
        const id = node.getAttributeNS(R.slice(0, -1), 'id') || node.getAttributeNS(RS.slice(0, -1), 'id');
        if (relationships.get(id)?.external) {
          while (node.firstChild) node.parentNode.insertBefore(node.firstChild, node);
          node.parentNode.removeChild(node);
        }
      }
    }
  }
  const parts = new Map(); let total = 0;
  const serializer = new XMLSerializer();
  for (const [name, original] of verified.parts) {
    let bytes = original;
    if (documents.has(name)) {
      // Old XML parsers normalize literal NEL/LS as line endings. References
      // preserve these legal XML 1.0 characters in text and attribute values.
      bytes = encoder.encode(serializer.serializeToString(documents.get(name).documentElement).replace(/[\u0085\u2028\u2029]/g, char => `&#${char.codePointAt(0)};`));
      if (bytes.byteLength > DOCX_LIMITS.xmlBytes) fail('转换副本 XML 大小超过限制（4 MiB）');
    }
    total += bytes.byteLength;
    if (total > DOCX_LIMITS.expandedBytes) fail('转换副本内容大小超过限制（60 MiB）');
    parts.set(name, bytes);
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
  if (encoder.encode(result.value).byteLength > DOCX_LIMITS.htmlBytes) fail('转换 HTML 大小超过限制（4 MiB）');
  if (result.messages.length) warn(CONVERSION_WARNING);
  return { html: result.value, images, warnings };
}
