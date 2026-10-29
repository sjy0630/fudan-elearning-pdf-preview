import { parsePresentationXml } from './presentation-package.mjs';
import { validatePresentationSlide } from './presentation-runtime.mjs';
import { PRESENTATION_LIMITS as L, PRESENTATION_WARNINGS as W, boundedPresentationText, validatePresentationDimensions, presentationAbortError } from './presentation-policy.mjs';

const SVG = 'http://www.w3.org/2000/svg';
const tags = new Set(['svg', 'g', 'defs', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc', 'image', 'clipPath', 'linearGradient', 'radialGradient', 'stop', 'pattern', 'marker']);
const drop = new Set(['script', 'style', 'foreignObject', 'iframe', 'object', 'embed', 'audio', 'video', 'animate', 'animateMotion', 'animateTransform', 'set', 'use', 'filter']);
const numeric = new Set(['x', 'y', 'x1', 'y1', 'x2', 'y2', 'dx', 'dy', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'fx', 'fy', 'fr', 'offset', 'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-width', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'font-size', 'letter-spacing', 'word-spacing', 'textLength', 'markerWidth', 'markerHeight', 'refX', 'refY']);
const enums = {
  'stroke-linecap': ['butt', 'round', 'square'], 'stroke-linejoin': ['miter', 'round', 'bevel'],
  'fill-rule': ['nonzero', 'evenodd'], 'clip-rule': ['nonzero', 'evenodd'],
  'text-anchor': ['start', 'middle', 'end'], 'dominant-baseline': ['auto', 'middle', 'central', 'hanging', 'alphabetic', 'text-before-edge', 'text-after-edge', 'ideographic'],
  'font-style': ['normal', 'italic', 'oblique'], 'font-weight': ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'],
  'text-decoration': ['none', 'underline', 'line-through', 'underline line-through'],
  'gradientUnits': ['userSpaceOnUse', 'objectBoundingBox'], 'patternUnits': ['userSpaceOnUse', 'objectBoundingBox'], 'patternContentUnits': ['userSpaceOnUse', 'objectBoundingBox'],
  'spreadMethod': ['pad', 'reflect', 'repeat'], 'lengthAdjust': ['spacing', 'spacingAndGlyphs'],
};
const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r/g, '&#13;');
const checkAbort = signal => { if (signal?.aborted) throw presentationAbortError(); };
const fail = () => { throw new Error('幻灯片页面无法安全显示或超过预览限制。'); };
let namespace = 0;
function staticPng(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 8; at < bytes.length;) {
    if (at + 12 > bytes.length) return false;
    const length = dv.getUint32(at), next = at + 12 + length;
    if (next > bytes.length) return false;
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (['acTL', 'fcTL', 'fdAT'].includes(type)) return false;
    if (type === 'IEND') return length === 0 && next === bytes.length;
    at = next;
  }
  return false;
}
export function validatePresentationImage(asset, formats = globalThis.CanvasFileFormats) {
  const format = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' }[asset.mime];
  if (!format) throw new Error('幻灯片图片格式不支持。');
  if (!formats || typeof formats.validate !== 'function') throw new Error('幻灯片图片验证组件不可用。');
  const info = formats.validate(asset.bytes, format, asset.mime);
  if (format === 'png' && !staticPng(asset.bytes)) throw new Error('幻灯片动画或损坏图片不支持。');
  if (info.width * info.height > L.imagePixels) fail();
  return info;
}
async function decodeImage(window, asset, signal, deadline) {
  checkAbort(signal);
  const url = window.URL.createObjectURL(new window.Blob([asset.bytes], { type: asset.mime }));
  try {
    return await new Promise((resolve, reject) => {
      let done = false, timer;
      const image = new window.Image();
      const finish = (error, result) => {
        if (done) return;
        done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        image.onload = image.onerror = null; image.removeAttribute('src');
        if (error) reject(error); else resolve(result);
      };
      const abort = () => finish(presentationAbortError());
      image.onload = () => finish(null, { width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => finish(new Error('幻灯片图片解码失败。'));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      const remaining = deadline - Date.now();
      if (remaining <= 0) { finish(new Error('幻灯片图片解码超时。')); return; }
      timer = setTimeout(() => finish(new Error('幻灯片图片解码超时。')), remaining);
      image.src = url;
    });
  } finally { window.URL.revokeObjectURL(url); }
}
function dataUrl(asset) {
  const pieces = [];
  for (let i = 0; i < asset.bytes.length; i += 8192) pieces.push(String.fromCharCode(...asset.bytes.subarray(i, i + 8192)));
  return `data:${asset.mime};base64,${globalThis.btoa(pieces.join(''))}`;
}
export async function sanitizePresentationSlide(output, { width, height, window, signal, formats } = {}) {
  checkAbort(signal); validatePresentationDimensions(width, height);
  const result = validatePresentationSlide(output), warnings = new Set(result.warnings), assets = new Map();
  const warn = value => warnings.add(value);
  // Copy before awaiting decode, so approval cannot race caller mutation.
  for (const asset of result.assets) assets.set(asset.id, { ...asset, bytes: Uint8Array.from(asset.bytes) });
  const doc = parsePresentationXml(result.svg, { nodes: 0 }, L.pageNodes);
  if (doc.documentElement.namespaceURI !== SVG || doc.documentElement.localName !== 'svg') fail();
  const prefix = `slide-${++namespace}-`, ids = new Map(), usedImages = new Set();
  const stack = [doc.documentElement];
  while (stack.length) {
    const node = stack.pop();
    if (node.nodeType !== 1) continue;
    const id = node.getAttribute('id');
    if (id && /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/.test(id)) {
      if (ids.has(id)) fail();
      ids.set(id, prefix + ids.size);
    }
    if (node.localName === 'image') usedImages.add(node.getAttribute('href') || node.getAttributeNS('http://www.w3.org/1999/xlink', 'href'));
    for (const child of Array.from(node.childNodes)) stack.push(child);
  }
  let pixels = 0, imageBytes = 0;
  const approved = new Map(), deadline = Date.now() + L.timeoutMs;
  for (const id of usedImages) {
    const asset = assets.get(id);
    if (!asset) { warn(W.external); continue; }
    try {
      const header = validatePresentationImage(asset, formats);
      pixels += header.width * header.height; imageBytes += asset.bytes.length;
      if (pixels > L.imagePixels || imageBytes > L.expandedBytes) fail();
      if (window) {
        const decoded = await decodeImage(window, asset, signal, deadline);
        if (decoded.width !== header.width || decoded.height !== header.height) throw new Error('幻灯片图片尺寸不匹配。');
      }
      approved.set(id, { url: dataUrl(asset), bytes: asset.bytes.length, pixels: header.width * header.height });
    } catch (error) {
      if (signal?.aborted) throw presentationAbortError();
      warn(W.image);
    }
  }
  const color = value => /^(?:#[0-9a-f]{3,8}|[a-z]{1,24}|(?:rgb|rgba|hsl|hsla)\([\d.%+ ,/-]+\))$/i.test(value);
  const fragment = value => {
    const match = /^url\(#([A-Za-z_][A-Za-z0-9_.:-]{0,127})\)$/.exec(value);
    return match && ids.has(match[1]) ? `url(#${ids.get(match[1])})` : null;
  };
  const attribute = (name, value) => {
    if (value.length > 200000) return null;
    if (name === 'id') return ids.get(value) || null;
    if (numeric.has(name)) return /^(?:[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?(?:px|%)?[ ,]*)+$/i.test(value) && ![...value.matchAll(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)].some(m => !Number.isFinite(Number(m[0])) || Math.abs(Number(m[0])) > 1e7) ? value : value === 'none' && name === 'stroke-dasharray' ? value : null;
    if (['fill', 'stroke', 'stop-color', 'color'].includes(name)) return color(value) ? value : fragment(value);
    if (['clip-path', 'marker-start', 'marker-mid', 'marker-end'].includes(name)) return fragment(value);
    if (name === 'stop-opacity') return /^0(?:\.\d+)?$|^1(?:\.0+)?$/.test(value) ? value : null;
    if (name === 'd') return /^[MmZzLlHhVvCcSsQqTtAaEe0-9+.,\s-]*$/.test(value) ? value : null;
    if (name === 'points' || name === 'viewBox') return /^[0-9eE+.,\s-]+$/.test(value) ? value : null;
    if (name === 'transform' || name === 'gradientTransform' || name === 'patternTransform') return /^(?:\s*(?:matrix|translate|scale|rotate|skewX|skewY)\([0-9eE+.,\s-]+\)\s*)+$/.test(value) ? value : null;
    if (name === 'font-family') return value.length < 512 && /^[\p{L}\p{N}\s,'"_.-]+$/u.test(value) ? value : null;
    if (name === 'preserveAspectRatio') return /^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?: (?:meet|slice))?)$/.test(value) ? value : null;
    if (name === 'orient') return value === 'auto' || /^-?\d+(?:\.\d+)?$/.test(value) ? value : null;
    if (name === 'xml:space') return value === 'preserve' ? value : null;
    return enums[name]?.includes(value) ? value : null;
  };
  let serializedBytes = 0, renderedImageBytes = 0, renderedImagePixels = 0;
  function render(node, depth = 0) {
    if (depth > 128) fail();
    if (node.nodeType === 3 || node.nodeType === 4) {
      const text = esc(node.data); serializedBytes += boundedPresentationText(text);
      if (serializedBytes > L.svgBytes) fail();
      return text;
    }
    if (node.nodeType !== 1) return '';
    const tag = node.localName;
    if (node.namespaceURI !== SVG || drop.has(tag)) { warn(W.content); return ''; }
    if (!tags.has(tag)) { warn(tag === 'a' ? W.external : W.content); return Array.from(node.childNodes).map(n => render(n, depth + 1)).join(''); }
    const attributes = new Map();
    for (const attr of Array.from(node.attributes)) {
      if (attr.name.startsWith('xmlns')) continue;
      if (attr.name === 'style') {
        for (const declaration of attr.value.split(';')) {
          const colon = declaration.indexOf(':');
          if (colon < 0) continue;
          const key = declaration.slice(0, colon).trim(), val = declaration.slice(colon + 1).trim();
          if (['font-family', 'font-size', 'font-style', 'font-weight', 'letter-spacing', 'text-decoration'].includes(key)) {
            const safe = attribute(key, val); if (safe !== null) attributes.set(key, safe);
          } else warn(W.content);
        }
        continue;
      }
      if (attr.name === 'href' || attr.name === 'xlink:href') continue;
      const safe = attribute(attr.name, attr.value);
      if (safe !== null) attributes.set(attr.name, safe);
      else if (!attr.name.startsWith('data-')) warn(W.content);
    }
    if (tag === 'image') {
      const id = node.getAttribute('href') || node.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (!approved.has(id)) { warn(W.image); return ''; }
      const image = approved.get(id);
      renderedImageBytes += image.bytes; renderedImagePixels += image.pixels;
      if (renderedImageBytes > L.expandedBytes || renderedImagePixels > L.imagePixels) fail();
      attributes.set('href', image.url);
    }
    if (node === doc.documentElement) { attributes.set('xmlns', SVG); attributes.set('viewBox', `0 0 ${width} ${height}`); attributes.set('width', '100%'); attributes.set('height', '100%'); }
    const content = Array.from(node.childNodes).map(n => render(n, depth + 1)).join('');
    const opening = `<${tag}${[...attributes].map(([key, value]) => ` ${key}="${esc(value)}"`).join('')}>`;
    // Raster data URIs have their own bounded expanded-byte budget.
    serializedBytes += boundedPresentationText(opening.replace(/data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+/g, '')) + tag.length + 3;
    if (serializedBytes > L.svgBytes) fail();
    return `${opening}${content}</${tag}>`;
  }
  const svg = render(doc.documentElement);
  checkAbort(signal);
  const csp = "default-src 'none'; script-src 'none'; connect-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; navigate-to 'none'";
  const srcdoc = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${esc(csp)}"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:white;color-scheme:light}svg{display:block;width:100%;height:100%}</style></head><body>${svg}</body></html>`;
  return { srcdoc, warnings: [...warnings], page: result.page };
}
