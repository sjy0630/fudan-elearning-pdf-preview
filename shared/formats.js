/* Shared by the extension and the generated userscript. No DOM or network access. */
globalThis.CanvasFileFormats = (() => {
  'use strict';
  const MiB = 1024 * 1024;
  const definitions = [
    ['pdf', 'application/pdf', ['pdf'], 100 * MiB],
    ['png', 'image/png', ['png'], 20 * MiB],
    ['jpeg', 'image/jpeg', ['jpg', 'jpeg'], 20 * MiB],
    ['webp', 'image/webp', ['webp'], 20 * MiB],
    ['text', 'text/plain', ['txt', 'csv', 'log', 'json', 'xml', 'yaml', 'yml', 'c', 'h', 'cpp', 'hpp', 'py', 'js', 'ts', 'java', 'css', 'sql', 'sh'], 2 * MiB],
  ];
  const formats = Object.create(null);
  for (const [id, mime, extensions, limit] of definitions) {
    formats[id] = Object.freeze({ id, mime, extensions: Object.freeze(extensions), limit });
  }
  Object.freeze(formats);
  const get = id => formats[id] || null;
  function required(id) {
    const format = get(id);
    if (!format) throw new Error('不支持的文件格式。');
    return format;
  }
  function identify(name) {
    const match = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return match ? Object.values(formats).find(f => f.extensions.includes(match[1].toLowerCase())) || null : null;
  }
  function safeName(name, formatId) {
    const format = required(formatId);
    let clean = String(name || '').replace(/[\x00-\x1f\x7f-\x9f/\\:*?"<>|]/g, '_').trim().replace(/[. ]+$/, '');
    if (!clean) clean = '文件';
    if (identify(clean) !== format) clean += '.' + format.extensions[0];
    return clean;
  }
  function asBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    throw new Error('文件数据无效。');
  }
  function malformed() { throw new Error('文件格式不符，或图像头部损坏、不完整。'); }
  function tag(b, at, s) { return at + s.length <= b.length && [...s].every((c, i) => b[at + i] === c.charCodeAt(0)); }
  const u16 = (b, i) => b[i] * 256 + b[i + 1];
  const le16 = (b, i) => b[i] + b[i + 1] * 256;
  const u32 = (b, i) => b[i] * 16777216 + b[i + 1] * 65536 + b[i + 2] * 256 + b[i + 3];
  const le24 = (b, i) => b[i] + b[i + 1] * 256 + b[i + 2] * 65536;
  const le32 = (b, i) => le24(b, i) + b[i + 3] * 16777216;
  function pngSize(b) {
    if (b.length < 33 || !tag(b, 0, '\x89PNG\r\n\x1a\n') || u32(b, 8) !== 13 || !tag(b, 12, 'IHDR')) malformed();
    const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
    if (!depths[b[25]]?.includes(b[24]) || b[26] !== 0 || b[27] !== 0 || b[28] > 1) malformed();
    return [u32(b, 16), u32(b, 20)];
  }
  function jpegSize(b) {
    if (b.length < 4 || b[0] !== 255 || b[1] !== 216) malformed();
    let at = 2;
    while (at < b.length) {
      if (b[at++] !== 255) malformed();
      while (b[at] === 255) at++;
      const marker = b[at++];
      if (marker === undefined || marker === 0 || marker === 216 || marker === 217 || marker === 218) malformed();
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (at + 2 > b.length) malformed();
      const length = u16(b, at);
      if (length < 2 || at + length > b.length) malformed();
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (length < 11 || !b[at + 7] || length !== 8 + 3 * b[at + 7] || ![8, 12, 16].includes(b[at + 2])) malformed();
        return [u16(b, at + 5), u16(b, at + 3)];
      }
      at += length;
    }
    malformed();
  }
  function webpSize(b) {
    if (b.length < 20 || !tag(b, 0, 'RIFF') || !tag(b, 8, 'WEBP') || le32(b, 4) + 8 !== b.length) malformed();
    let dimensions = null;
    let at = 12;
    while (at < b.length) {
      if (at + 8 > b.length) malformed();
      const length = le32(b, at + 4), p = at + 8;
      const next = p + length + (length % 2);
      if (next > b.length) malformed();
      if (tag(b, at, 'ANIM') || tag(b, at, 'ANMF')) throw new Error('暂不支持动画图像。');
      let size = null;
      if (tag(b, at, 'VP8X')) {
        if (length !== 10) malformed();
        if (b[p] & 2) throw new Error('暂不支持动画图像。');
        if ((b[p] & 0xc1) || b[p + 1] || b[p + 2] || b[p + 3]) malformed();
        size = [le24(b, p + 4) + 1, le24(b, p + 7) + 1];
      } else if (tag(b, at, 'VP8L')) {
        if (length < 5 || b[p] !== 0x2f || (b[p + 4] & 0xe0)) malformed();
        const bits = le32(b, p + 1);
        size = [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
      } else if (tag(b, at, 'VP8 ')) {
        if (length < 10 || (b[p] & 1) || !(b[p] & 0x10) || ((b[p] >>> 1) & 7) > 3 || !tag(b, p + 3, '\x9d\x01\x2a')) malformed();
        size = [le16(b, p + 6) & 0x3fff, le16(b, p + 8) & 0x3fff];
      }
      if (size) {
        if (dimensions && (size[0] !== dimensions[0] || size[1] !== dimensions[1])) malformed();
        dimensions = size;
      }
      at = next;
    }
    if (!dimensions) malformed();
    return dimensions;
  }
  function validate(input, formatId, mime = '') {
    const format = required(formatId), b = asBytes(input);
    if (b.length > format.limit) throw new Error('文件大小超过预览限制。');
    const type = String(mime).split(';')[0].trim().toLowerCase();
    const textType = /^text\/(?!html$)[a-z0-9.+-]+$/.test(type) || /^application\/(?:json|xml|yaml|x-yaml|javascript|x-javascript|sql|x-sh|x-shellscript|(?:[a-z0-9.-]+\+)(?:json|xml))$/.test(type);
    if (type === 'text/html' || type === 'application/xhtml+xml') throw new Error('服务器返回了网页，可能需要重新登录。');
    if (type && type !== 'application/octet-stream' && type !== format.mime && !(formatId === 'text' && textType)) throw new Error('文件类型与预览格式不符。');
    if (formatId === 'text') return { mime: format.mime };
    if (formatId === 'pdf') {
      if (!tag(b, 0, '%PDF-')) malformed();
      return { mime: format.mime };
    }
    const [width, height] = ({ png: pngSize, jpeg: jpegSize, webp: webpSize })[formatId](b);
    if (!width || !height || width > 16384 || height > 16384 || width * height > 40000000) throw new Error('图像尺寸无效或超过预览限制（单边 16384、总像素 4000 万）。');
    return { mime: format.mime, width, height };
  }
  function decodeText(input, encoding = 'auto') {
    const b = asBytes(input);
    if (b.length > formats.text.limit) throw new Error('文件大小超过预览限制。');
    let label = String(encoding).toLowerCase();
    if (!['auto', 'utf-8', 'gb18030'].includes(label)) throw new Error('不支持的文本编码。');
    if (label === 'auto') {
      label = b[0] === 255 && b[1] === 254 ? 'utf-16le' : b[0] === 254 && b[1] === 255 ? 'utf-16be' : 'utf-8';
    }
    let text;
    try { text = new TextDecoder(label, { fatal: true }).decode(b); }
    catch { throw new Error('文本编码无效，请尝试切换 UTF-8 或 GB18030 编码。'); }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text)) throw new Error('文件包含二进制控制字符，无法作为文本预览。');
    // Move forward once through each prefix; a repeated lazy-comment regex can
    // backtrack exponentially on ordinary text containing many comments.
    let prefixEnd = 0;
    while (prefixEnd < text.length) {
      while (prefixEnd < text.length && /\s/.test(text[prefixEnd])) prefixEnd++;
      let closing;
      if (text.startsWith('<!--', prefixEnd)) closing = '-->';
      else if (/^<\?xml\b/i.test(text.slice(prefixEnd, prefixEnd + 6))) closing = '?>';
      else break;
      const end = text.indexOf(closing, prefixEnd + (closing === '-->' ? 4 : 5));
      if (end === -1) break;
      prefixEnd = end + closing.length;
    }
    if (/^(?:<!doctype\s+html\b|<(?:html|head|body|form)\b)/i.test(text.slice(prefixEnd))) throw new Error('文件内容像登录网页，请重新登录后重试。');
    return text;
  }
  return Object.freeze({ identify, get, safeName, validate, decodeText });
})();
