import createDOMPurify from 'dompurify';
import { DOCX_LIMITS } from './docx-policy.mjs';
import { boundedDocxUtf8Length, docxAbortError, validateDocxResult } from './docx-runtime.mjs';

const IMAGE_WARNING = '部分图片暂不支持预览，已显示占位说明。';
const CONVERSION_WARNING = '部分文档格式无法完整转换，预览可能有所省略。';
const LINK_WARNING = '链接和脚注仅保留文字，预览不提供跳转。';
const TABLE_WARNING = '部分表格合并属性无效，已按普通单元格显示。';
const FIXED_WARNINGS = new Set([
  IMAGE_WARNING, CONVERSION_WARNING, LINK_WARNING, TABLE_WARNING,
  '文档含公式，预览可能无法完整显示。', '文档含 SmartArt，预览可能无法完整显示。',
  '文档含图表，预览可能无法完整显示。', '文档含修订，预览可能无法完整呈现修改记录。',
  '文档含嵌入对象，预览不提供对象的运行或编辑。', '文档含 ActiveX 控件，预览不会运行这些控件。',
  '文档含 altChunk 内容，预览可能无法完整显示。', '文档含页眉页脚，预览不还原这些版面内容。',
  '文档含浮动布局，预览可能改变图文位置。', '文档含批注，预览可能无法完整显示。',
  '文档含不支持的图片格式，预览可能显示占位说明。', '外部超链接仅保留文字，预览不提供跳转。',
  '文档含外部图片或对象，预览不会读取这些资源。', '文档含外部关联资源，预览不会读取这些资源。',
]);
const TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'em', 'strong', 'u', 's', 'sub', 'sup', 'br', 'hr', 'ol', 'ul', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'img', 'a'];
const CSS = 'html{color-scheme:light;background:#fff;color:#202124}body{margin:0;padding:24px;font:16px/1.75 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;overflow-wrap:anywhere;word-break:normal}p{margin:0 0 1em;white-space:pre-wrap}h1,h2,h3,h4,h5,h6{line-height:1.4;margin:1.3em 0 .6em}ol,ul{padding-inline-start:2em}li>ol,li>ul{margin:.25em 0}table{display:block;max-width:100%;overflow-x:auto;border-collapse:collapse;margin:1em 0}td,th{border:1px solid #bbb;padding:.35em .6em;min-width:2em;vertical-align:top}img{max-width:100%;height:auto}a{color:inherit;text-decoration:none}hr{border:0;border-top:1px solid #ccc}';
const fail = message => { throw new Error(`DOCX ${message}。`); };
const checkAbort = signal => { if (signal?.aborted) throw docxAbortError(); };
let namespaceSequence = 0;

function countNodes(root) {
  let count = 0;
  const pending = [];
  for (let child = root.lastChild; child; child = child.previousSibling) pending.push(child);
  while (pending.length) {
    const node = pending.pop();
    count += 1 + (node.attributes?.length || 0);
    if (count > DOCX_LIMITS.nodes) fail('预览节点和属性数超过限制（50000）');
    for (let child = node.lastChild; child; child = child.previousSibling) pending.push(child);
    // Template contents are inert, but still consume the input allocation budget.
    if (node.content) for (let child = node.content.lastChild; child; child = child.previousSibling) pending.push(child);
  }
}

function staticPng(bytes) {
  // Header validation is shared with the existing image preview. Inspect every
  // bounded chunk before native decode so APNG cannot hide behind its canvas size.
  let at = 8;
  while (at < bytes.length) {
    if (at + 12 > bytes.length) return false;
    const length = bytes[at] * 16777216 + bytes[at + 1] * 65536 + bytes[at + 2] * 256 + bytes[at + 3];
    const next = at + 12 + length;
    if (next > bytes.length) return false;
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (['acTL', 'fcTL', 'fdAT'].includes(type)) return false;
    if (type === 'IEND') return length === 0 && next === bytes.length;
    at = next;
  }
  return false;
}

function imageHeader(image, formats) {
  try {
    const format = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' }[image.mime];
    const header = formats.validate(image.bytes, format, image.mime);
    if (!Number.isSafeInteger(header.width) || !Number.isSafeInteger(header.height) || header.width <= 0 || header.height <= 0 || header.width > 16384 || header.height > 16384 || header.width * header.height > DOCX_LIMITS.imagePixels) fail('图片尺寸超过预览限制');
    if (format === 'png' && !staticPng(image.bytes)) return null;
    return header;
  } catch (error) {
    if (/^(?:图像尺寸|DOCX 图片尺寸)/.test(error?.message || '')) fail('图片尺寸超过预览限制');
    return null;
  }
}

async function decodeImage(window, image, signal, deadline) {
  checkAbort(signal);
  let url;
  try {
    url = window.URL.createObjectURL(new window.Blob([image.bytes], { type: image.mime }));
    return await new Promise((resolve, reject) => {
      const native = new window.Image();
      let timer, done = false;
      const finish = (error, dimensions) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        native.onload = null;
        native.onerror = null;
        native.removeAttribute('src');
        if (error) reject(error);
        else resolve(dimensions);
      };
      const abort = () => finish(docxAbortError());
      native.onload = () => finish(null, [native.naturalWidth, native.naturalHeight]);
      native.onerror = () => finish(new Error('DOCX 图片无法解码。'));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      const remaining = deadline - Date.now();
      if (remaining <= 0) { finish(new Error('DOCX 图片解码超时。')); return; }
      timer = setTimeout(() => finish(new Error('DOCX 图片解码超时。')), remaining);
      try { native.src = url; } catch { finish(new Error('DOCX 图片无法解码。')); }
    });
  } finally {
    if (url !== undefined) window.URL.revokeObjectURL(url);
  }
}

function imageDataUrl(window, image) {
  const pieces = [];
  for (let at = 0; at < image.bytes.length; at += 8192) pieces.push(String.fromCharCode(...image.bytes.subarray(at, at + 8192)));
  return `data:${image.mime};base64,${window.btoa(pieces.join(''))}`;
}

function tableSpan(node, name, warn, original) {
  const value = original ? original[name] : node.getAttribute(name);
  if (value === null) return 1;
  if (!/^[0-9]+$/.test(value) || !/[1-9]/.test(value)) {
    node.removeAttribute(name);
    warn(TABLE_WARNING);
    return 1;
  }
  const normalized = value.replace(/^0+/, '');
  if (normalized.length > 4 || Number(normalized) > 1000) fail('表格合并跨度超过限制（1000）');
  node.setAttribute(name, normalized);
  return Number(normalized);
}

export async function sanitizeDocxOutput(window, output, { signal, formats } = {}) {
  checkAbort(signal);
  const result = validateDocxResult(output);
  if (!formats || typeof formats.validate !== 'function') fail('图片验证组件不可用');
  const warnings = [];
  const warn = warning => {
    const fixed = FIXED_WARNINGS.has(warning) ? warning : CONVERSION_WARNING;
    if (!warnings.includes(fixed) && warnings.length < 32) warnings.push(fixed);
  };
  result.warnings.forEach(warn);
  const deadline = Date.now() + DOCX_LIMITS.timeoutMs;
  // Freeze exact image views before the first await. The caller cannot change
  // approved bytes while native decoding is in flight, even for unused images.
  const images = new Map(result.images.map(image => {
    const copy = { id: image.id, mime: image.mime, bytes: Uint8Array.from(image.bytes) };
    return [copy.id, { image: copy, header: imageHeader(copy, formats) }];
  }));

  // Templates parse without activating images, frames, styles or scripts.
  // Reject excessive opening tags before asking the browser to build the tree.
  let openingTags = 0;
  for (const ignored of result.html.matchAll(/<[A-Za-z]/g)) if (++openingTags > DOCX_LIMITS.nodes) fail('预览节点数超过限制（50000）');
  const template = window.document.createElement('template');
  template.innerHTML = result.html;
  countNodes(template.content);
  const markers = new WeakMap(), identified = new WeakSet(), tableSpans = new WeakMap();
  const purifier = createDOMPurify(window);
  if (!purifier.isSupported) fail('当前浏览器不支持安全文档预览');
  purifier.addHook('uponSanitizeElement', node => {
    if (node.nodeType !== 1) return;
    if (node.hasAttribute('id')) identified.add(node);
    if (node.localName === 'a' || node.hasAttribute('href')) warn(LINK_WARNING);
    if ((node.localName === 'td' || node.localName === 'th') && !tableSpans.has(node)) tableSpans.set(node, { rowspan: node.getAttribute('rowspan'), colspan: node.getAttribute('colspan') });
    if (node.localName === 'img') {
      const marker = node.getAttribute('src');
      if (/^docx-image-[1-9][0-9]{0,8}$/.test(marker || '')) markers.set(node, marker);
    }
  });
  let clean;
  try {
    clean = purifier.sanitize(template.content, {
      ALLOWED_TAGS: TAGS,
      ALLOWED_ATTR: ['alt', 'rowspan', 'colspan'],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      ALLOW_UNKNOWN_PROTOCOLS: false,
      FORBID_TAGS: ['script', 'style', 'svg', 'math', 'form', 'object', 'iframe', 'meta', 'base', 'template'],
      FORBID_ATTR: ['src', 'href', 'srcset', 'style', 'id', 'name'],
      RETURN_DOM_FRAGMENT: true,
      RETURN_TRUSTED_TYPE: false,
      SANITIZE_DOM: true,
    });
  } catch { fail('文档内容无法安全清理'); }
  finally { purifier.removeAllHooks(); }
  checkAbort(signal);

  const namespace = `docx-preview-${++namespaceSequence}-`;
  let idSequence = 0, tableArea = 0, referenceCount = 0, headerPixels = 0, renderedBytes = 0;
  const rendered = [];
  const walker = clean.ownerDocument.createTreeWalker(clean, 1);
  let node;
  while ((node = walker.nextNode())) {
    if (identified.has(node)) node.setAttribute('id', namespace + ++idSequence);
    if (node.localName === 'td' || node.localName === 'th') {
      tableArea += tableSpan(node, 'rowspan', warn, tableSpans.get(node)) * tableSpan(node, 'colspan', warn, tableSpans.get(node));
      if (tableArea > DOCX_LIMITS.nodes) fail('表格合并总面积超过限制（50000）');
    } else {
      node.removeAttribute('rowspan');
      node.removeAttribute('colspan');
    }
    if (node.localName !== 'img') continue;
    if (++referenceCount > DOCX_LIMITS.images) fail('图片引用数超过限制（200）');
    const entry = images.get(markers.get(node));
    if (entry?.header) {
      headerPixels += entry.header.width * entry.header.height;
      renderedBytes += entry.image.bytes.byteLength;
      if (headerPixels > DOCX_LIMITS.imagePixels || renderedBytes > DOCX_LIMITS.expandedBytes) fail('图片总量超过预览限制');
    }
    rendered.push({ node, entry });
  }
  countNodes(clean);
  // Measure content before introducing data URLs, which have a separate byte
  // budget above. Semantic CR must survive the final srcdoc HTML parse.
  const wrapper = clean.ownerDocument.createElement('div');
  wrapper.appendChild(clean);
  const content = wrapper.innerHTML.replace(/\r/g, '&#13;');
  if (boundedDocxUtf8Length(content) > DOCX_LIMITS.htmlBytes) fail('预览 HTML 超过限制（4 MiB）');

  let actualPixels = 0;
  const decoded = new Map(), dataUrls = new Map();
  for (const reference of rendered) {
    checkAbort(signal);
    const { entry, node: imageNode } = reference;
    let dimensions = null;
    if (entry?.header) {
      if (decoded.has(entry.image.id)) dimensions = decoded.get(entry.image.id);
      else {
        try { dimensions = await decodeImage(window, entry.image, signal, deadline); }
        catch (error) { if (error?.name === 'AbortError') throw error; }
        decoded.set(entry.image.id, dimensions);
      }
      if (dimensions) {
        const [width, height] = dimensions, header = entry.header;
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > 16384 || height > 16384 || width * height > DOCX_LIMITS.imagePixels) fail('实际图片尺寸超过预览限制');
        actualPixels += width * height;
        if (actualPixels > DOCX_LIMITS.imagePixels) fail('实际图片总像素超过预览限制');
        if (!((width === header.width && height === header.height) || (width === header.height && height === header.width))) dimensions = null;
      }
    }
    if (!dimensions) {
      imageNode.replaceWith(wrapper.ownerDocument.createTextNode('[图片暂不支持预览]'));
      warn(IMAGE_WARNING);
      continue;
    }
    if (!dataUrls.has(entry.image.id)) dataUrls.set(entry.image.id, imageDataUrl(window, entry.image));
    imageNode.setAttribute('src', dataUrls.get(entry.image.id));
  }
  checkAbort(signal);
  countNodes(wrapper);
  // Placeholder text can be longer than an empty img. Measure it without ever
  // counting or copying the large, project-generated data URL attributes.
  const payloadSources = [];
  for (const { node: imageNode } of rendered) if (imageNode.parentNode) {
    payloadSources.push([imageNode, imageNode.getAttribute('src')]);
    imageNode.removeAttribute('src');
  }
  if (boundedDocxUtf8Length(wrapper.innerHTML.replace(/\r/g, '&#13;')) > DOCX_LIMITS.htmlBytes) fail('预览 HTML 超过限制（4 MiB）');
  for (const [imageNode, src] of payloadSources) imageNode.setAttribute('src', src);
  const html = wrapper.innerHTML.replace(/\r/g, '&#13;');
  return {
    srcdoc: '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><style>' + CSS + '</style></head><body>' + html + '</body></html>',
    warnings,
  };
}
