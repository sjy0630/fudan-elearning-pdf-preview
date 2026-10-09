// ==UserScript==
// @name         复旦 eLearning PDF 弹窗预览
// @namespace    https://elearning.fudan.edu.cn/
// @version      1.1.0
// @description  在 eLearning 页面中预览 PDF、图片和文本，无需自动保存文件
// @license      MIT
// @homepageURL  https://github.com/sjy0630/fudan-elearning-pdf-preview
// @supportURL   https://github.com/sjy0630/fudan-elearning-pdf-preview/issues
// @updateURL    https://raw.githubusercontent.com/sjy0630/fudan-elearning-pdf-preview/main/elearning-pdf-preview.user.js
// @downloadURL  https://raw.githubusercontent.com/sjy0630/fudan-elearning-pdf-preview/main/elearning-pdf-preview.user.js
// @match        https://elearning.fudan.edu.cn/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function () {
  'use strict';
  /* Shared by the extension and the generated userscript. No DOM or network access. */
const CanvasFileFormats = (() => {
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

  function pdfLinkFromClick(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
    const link = event.target?.nodeType === 1 ? event.target.closest('a[href]') : null;
    if (!link || link.hasAttribute('download') || link.matches('.download, .download_link, [aria-label*="Download"], [aria-label*="下载"]')) return null;
    let url;
    try { url = new URL(link.href, location.href); } catch { return null; }
    if (url.origin !== 'https://elearning.fudan.edu.cn' || url.origin !== location.origin || url.username || url.password) return null;
    const match = /^(\/(?:courses\/\d+\/)?files\/\d+)(?:\/(?:download|preview))?\/?$/.exec(url.pathname);
    if (!match && /^\/(?:courses\/\d+\/)?files\//.test(url.pathname)) return null;
    let basename;
    try { basename = decodeURIComponent(url.pathname.split('/').pop()); } catch { return null; }
    if (!match && !CanvasFileFormats.identify(basename)) return null;
    const name = [link.dataset.filename, link.textContent, link.title, ...(match ? [] : [basename])]
      .map(value => String(value || '').trim()).find(value => CanvasFileFormats.identify(value));
    if (!name) return null;
    const format = CanvasFileFormats.identify(name).id;
    const downloadUrl = match ? new URL(`${match[1]}/download?download_frd=1`, location.origin) : new URL(url.href);
    if (match && url.searchParams.has('verifier')) downloadUrl.searchParams.set('verifier', url.searchParams.get('verifier'));
    return { link, url, name: CanvasFileFormats.safeName(name, format), format, downloadUrl };
  }

  const abortError = () => new DOMException('Aborted', 'AbortError');
  const sizeError = format => new Error(`文件大小超过预览限制（${format.limit / (1024 * 1024)} MiB）。`);
  const httpError = status => new Error(status === 401 || status === 403 ? '登录状态或文件权限已失效。' : `文件请求失败（HTTP ${status}）。`);
  function requestThroughTampermonkey(url, signal, format) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') return reject(new Error('浏览器扩展未提供跨站文件读取功能。'));
      if (signal.aborted) return reject(abortError());
      let request, finished = false, mustAbort = false;
      const done = (error, blob, abort = false) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener('abort', onAbort);
        if (abort) { mustAbort = true; request?.abort(); }
        if (error) reject(error); else resolve(blob);
      };
      const onAbort = () => done(abortError(), null, true);
      const checkHeaders = response => {
        const match = /^content-length:\s*(\d+)\s*$/im.exec(response.responseHeaders || '');
        if (match && Number(match[1]) > format.limit) done(sizeError(format), null, true);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        request = GM_xmlhttpRequest({
          method: 'GET', url, responseType: 'blob', timeout: 60000,
          headers: { Accept: format.mime },
          onreadystatechange: checkHeaders,
          onprogress: response => {
            checkHeaders(response);
            if (response.loaded > format.limit || response.total > format.limit) done(sizeError(format), null, true);
          },
          onload: response => {
            if (finished) return;
            checkHeaders(response);
            if (finished) return;
            if (response.status < 200 || response.status >= 300) return done(httpError(response.status));
            const blob = response.response;
            if (!blob || typeof blob.size !== 'number') return done(new Error('文件服务返回了空内容。'));
            if (blob.size > format.limit) return done(sizeError(format), null, true);
            done(null, blob);
          },
          onerror: () => done(new Error('文件服务拒绝了预览请求。')),
          ontimeout: () => done(new Error('文件读取超时。'), null, true),
          onabort: () => done(abortError()),
        });
        if (mustAbort) request?.abort();
        if (signal.aborted && !finished) onAbort();
      } catch (error) { done(error); }
    });
  }

  async function retrievePdf(file, signal) {
    const format = CanvasFileFormats.get(file.format || 'pdf');
    const url = new URL(file.downloadUrl.href);
    if (!format || url.origin !== 'https://elearning.fudan.edu.cn' || url.username || url.password) throw new Error('文件地址无效。');
    let response;
    try {
      response = await fetch(url.href, { credentials: 'same-origin', redirect: 'follow', signal, headers: { Accept: format.mime } });
    } catch (error) {
      if (signal.aborted || error?.name !== 'TypeError') throw error;
      return requestThroughTampermonkey(url.href, signal, format);
    }
    if (!response.ok) { await response.body?.cancel(); throw httpError(response.status); }
    if (Number(response.headers.get('content-length')) > format.limit) { await response.body?.cancel(); throw sizeError(format); }
    let blob;
    if (response.body?.getReader) {
      const reader = response.body.getReader(), chunks = [];
      let size = 0;
      try {
        while (true) {
          if (signal.aborted) throw abortError();
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > format.limit) throw sizeError(format);
          chunks.push(value);
        }
        blob = new Blob(chunks, { type: response.headers.get('content-type') || '' });
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      finally { reader.releaseLock(); }
    } else blob = await response.blob();
    if (signal.aborted) throw abortError();
    if (blob.size > format.limit) throw sizeError(format);
    return blob;
  }

  const state = { root: null, requestId: 0, objectUrl: null, controller: null, bytes: null, image: null, rotation: 0, zoom: 1, oldOverflow: '', trigger: null };
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function button(action, text, handler) {
    const node = element('button', 'fdpdf-action', text);
    node.type = 'button'; node.dataset.action = action;
    node.addEventListener('click', handler);
    return node;
  }
  function ensureDialog() {
    if (state.root) return;
    const style = element('style');
    style.textContent = `
      .fdpdf-overlay[hidden], .fdpdf-overlay [hidden] { display:none !important; }
      .fdpdf-overlay { position:fixed; inset:0; z-index:2147483647; display:flex; align-items:center; justify-content:center; padding:16px; box-sizing:border-box; background:#0f172aad; font:14px/1.5 system-ui,sans-serif; }
      .fdpdf-dialog { display:flex; flex-direction:column; width:min(1200px,100%); height:min(900px,100%); min-height:280px; overflow:hidden; border-radius:12px; background:white; color:#1f2937; box-shadow:0 20px 70px #0006; }
      .fdpdf-header,.fdpdf-tools { display:flex; align-items:center; gap:8px; padding:10px 16px; flex-wrap:wrap; border-bottom:1px solid #e5e7eb; }
      .fdpdf-title { flex:1; min-width:0; margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:16px; }
      .fdpdf-action,.fdpdf-encoding { border:1px solid #cbd5e1; border-radius:6px; padding:6px 10px; background:white; color:#1d4ed8; text-decoration:none; font:inherit; cursor:pointer; }
      .fdpdf-body { position:relative; flex:1; min-height:0; overflow:auto; background:#e5e7eb; }
      .fdpdf-status { position:absolute; top:16px; left:16px; right:16px; z-index:1; padding:18px; background:white; border-radius:8px; white-space:pre-line; }
      .fdpdf-viewer { width:100%; height:100%; border:0; display:block; }
      .fdpdf-text { margin:0; padding:20px; min-height:100%; box-sizing:border-box; background:white; font:14px/1.6 ui-monospace,monospace; white-space:pre-wrap; overflow-wrap:anywhere; }
      .fdpdf-image-stage { position:relative; margin:auto; }
      .fdpdf-image { display:block; position:absolute; left:50%; top:50%; max-width:none; max-height:none; }
      .fdpdf-feedback { color:#334155; }
      @media(max-width:600px) { .fdpdf-overlay { padding:0; } .fdpdf-dialog { height:100%; border-radius:0; } .fdpdf-title { flex-basis:100%; } }
    `;
    const root = element('div','fdpdf-overlay'); root.hidden = true;
    const dialog = element('section','fdpdf-dialog'); dialog.setAttribute('role','dialog'); dialog.setAttribute('aria-modal','true'); dialog.setAttribute('aria-labelledby','fdpdf-title');
    const header = element('header','fdpdf-header');
    const title = element('h2','fdpdf-title'); title.id = 'fdpdf-title';
    const originalLink = element('a','fdpdf-action','打开原文件'); originalLink.target = '_blank'; originalLink.rel = 'noopener noreferrer';
    const downloadLink = element('a','fdpdf-action fdpdf-download','下载文件');
    const closeButton = button('close','关闭',closeDialog); closeButton.classList.add('fdpdf-close');
    header.append(title,originalLink,downloadLink,closeButton);
    const imageTools = element('div','fdpdf-tools');
    imageTools.append(button('zoom-in','放大',() => { state.zoom *= 1.25; layoutImage(); }),button('zoom-out','缩小',() => { state.zoom /= 1.25; layoutImage(); }),button('rotate','旋转 90°',() => { state.rotation = (state.rotation + 90) % 360; fitImage(); }),button('fit','适应窗口',fitImage));
    const textTools = element('div','fdpdf-tools');
    const encoding = element('select','fdpdf-encoding'); encoding.setAttribute('aria-label','文本编码');
    for (const [value,label] of [['auto','自动编码'],['utf-8','UTF-8'],['gb18030','GB18030']]) { const option = element('option','',label); option.value = value; encoding.append(option); }
    encoding.addEventListener('change',renderText);
    const wrap = button('wrap','自动换行',() => { const enabled = wrap.getAttribute('aria-pressed') !== 'true'; wrap.setAttribute('aria-pressed',String(enabled)); state.text.style.whiteSpace = enabled ? 'pre-wrap' : 'pre'; });
    const feedback = element('span','fdpdf-feedback'); feedback.setAttribute('role','status');
    textTools.append(encoding,wrap,button('copy','复制文本',copyText),feedback);
    const body = element('div','fdpdf-body');
    const status = element('div','fdpdf-status'); status.setAttribute('role','status');
    const viewer = element('iframe','fdpdf-viewer'); viewer.title = 'PDF 预览';
    const text = element('pre','fdpdf-text'); text.tabIndex = 0;
    const stage = element('div','fdpdf-image-stage');
    body.append(status,viewer,text,stage); dialog.append(header,imageTools,textTools,body); root.append(dialog);
    document.head.append(style); document.body.append(root);
    Object.assign(state,{root,title,originalLink,downloadLink,closeButton,imageTools,textTools,encoding,wrap,feedback,body,status,viewer,text,stage});
    root.addEventListener('click',event => { if (event.target === root) closeDialog(); });
    document.addEventListener('keydown',event => { if (event.key === 'Escape' && !root.hidden) closeDialog(); });
  }
  function dropObjectUrl() {
    state.downloadLink?.removeAttribute('href');
    if (state.downloadLink) state.downloadLink.hidden = true;
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
  }
  function clearPending() {
    state.requestId++;
    state.controller?.abort(); state.controller = null;
    if (!state.root) return;
    state.viewer.onload = state.viewer.onerror = null; state.viewer.removeAttribute('src'); state.viewer.hidden = true;
    if (state.image) { state.image.onload = state.image.onerror = null; state.image.removeAttribute('src'); state.image.remove(); }
    state.image = null; state.bytes = null; state.file = null;
    state.text.textContent = ''; state.text.hidden = true; state.stage.hidden = true;
    state.imageTools.hidden = state.textTools.hidden = true;
    state.encoding.value = 'auto'; state.wrap.setAttribute('aria-pressed','true'); state.text.style.whiteSpace = 'pre-wrap';
    state.feedback.textContent = ''; state.rotation = 0; state.zoom = 1;
    dropObjectUrl();
  }
  function closeDialog() {
    if (!state.root || state.root.hidden) return;
    clearPending(); state.root.hidden = true;
    document.body.style.overflow = state.oldOverflow;
    state.trigger?.focus(); state.trigger = null;
  }
  function showError(message) {
    state.status.hidden = false; state.status.textContent = `${message}\n可以打开原文件继续查看或下载。`;
    state.originalLink.hidden = false;
  }
  function setDownload(blob) {
    dropObjectUrl(); state.objectUrl = URL.createObjectURL(blob);
    state.downloadLink.href = state.objectUrl; state.downloadLink.download = state.file.name; state.downloadLink.hidden = false;
  }
  function renderText() {
    dropObjectUrl(); state.text.hidden = true; state.text.textContent = ''; state.feedback.textContent = '';
    try {
      const value = CanvasFileFormats.decodeText(state.bytes,state.encoding.value);
      state.text.textContent = value; state.text.hidden = false; state.status.hidden = true;
      setDownload(new Blob([state.bytes],{type:'text/plain'}));
    } catch (error) { showError(error.message); }
  }
  async function copyText() {
    if (state.text.hidden) return;
    const id = state.requestId, text = state.text.textContent;
    try {
      await navigator.clipboard.writeText(text);
      if (id === state.requestId) state.feedback.textContent = '已复制';
    } catch {
      if (id !== state.requestId) return;
      const range = document.createRange(); range.selectNodeContents(state.text);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      state.text.focus(); state.feedback.textContent = '已选中文本，请手动复制（Ctrl/Cmd+C）。';
    }
  }
  function layoutImage() {
    const image = state.image;
    if (!image?.naturalWidth) return;
    state.zoom = Math.max(0.01,Math.min(8,state.zoom));
    const rotated = state.rotation % 180 !== 0;
    state.stage.style.width = `${(rotated ? image.naturalHeight : image.naturalWidth) * state.zoom}px`;
    state.stage.style.height = `${(rotated ? image.naturalWidth : image.naturalHeight) * state.zoom}px`;
    image.style.width = `${image.naturalWidth}px`; image.style.height = `${image.naturalHeight}px`;
    image.style.transform = `translate(-50%, -50%) rotate(${state.rotation}deg) scale(${state.zoom})`;
    image.dataset.rotation = String(state.rotation);
  }
  function fitImage() {
    if (!state.image?.naturalWidth) return;
    const rotated = state.rotation % 180 !== 0, image = state.image;
    state.zoom = Math.min(1, state.body.clientWidth / (rotated ? image.naturalHeight : image.naturalWidth),state.body.clientHeight / (rotated ? image.naturalWidth : image.naturalHeight));
    layoutImage();
  }
  async function loadPdf(file) {
    const id = state.requestId, controller = new AbortController(); state.controller = controller;
    const current = () => id === state.requestId && !state.root.hidden && !controller.signal.aborted;
    const timeout = setTimeout(() => { if (current()) { clearPending(); showError('文件读取超时。'); } },60000);
    try {
      const blob = await retrievePdf(file,controller.signal);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (!current()) return;
      const validated = CanvasFileFormats.validate(bytes,file.format,file.format === 'pdf' ? '' : blob.type);
      if (file.format === 'text') {
        state.bytes = bytes; state.textTools.hidden = false; renderText();
      } else if (file.format === 'pdf') {
        setDownload(new Blob([bytes],{type:validated.mime}));
        state.viewer.onload = () => { if (current()) state.status.hidden = true; };
        state.viewer.onerror = () => { if (current()) showError('浏览器未能嵌入 PDF 预览。'); };
        state.viewer.hidden = false; state.viewer.src = state.objectUrl;
      } else {
        const image = new Image(); image.className = 'fdpdf-image'; image.alt = file.name; state.image = image;
        // Validate dimensions before decode, then check actual browser dimensions too (including EXIF orientation).
        state.objectUrl = URL.createObjectURL(new Blob([bytes],{type:validated.mime}));
        await new Promise((resolve,reject) => {
          const aborted = () => { cleanup(); reject(abortError()); };
          const cleanup = () => { image.onload = image.onerror = null; controller.signal.removeEventListener('abort',aborted); };
          image.onload = () => { cleanup(); resolve(); };
          image.onerror = () => { cleanup(); reject(new Error('无法解码此图像。')); };
          controller.signal.addEventListener('abort',aborted,{once:true});
          image.src = state.objectUrl;
        });
        if (!current()) return;
        const w = image.naturalWidth, h = image.naturalHeight;
        if (!w || !h || w > 16384 || h > 16384 || w*h > 40000000) throw new Error('图像尺寸超过预览限制。');
        state.stage.append(image); state.stage.hidden = false; state.imageTools.hidden = false;
        state.downloadLink.href = state.objectUrl; state.downloadLink.download = file.name; state.downloadLink.hidden = false;
        fitImage(); state.status.hidden = true;
      }
    } catch (error) {
      if (!current()) return;
      if (state.image) { state.image.removeAttribute('src'); state.image.remove(); state.image = null; }
      state.bytes = null; dropObjectUrl(); showError(error.message || '无法读取文件。');
    } finally { clearTimeout(timeout); if (state.controller === controller) state.controller = null; }
  }
  function openDialog(file) {
    ensureDialog();
    if (state.root.hidden) state.oldOverflow = document.body.style.overflow;
    clearPending(); state.file = file; state.trigger = file.link;
    state.title.textContent = file.name; state.originalLink.href = file.url.href; state.originalLink.hidden = false;
    state.status.textContent = '正在读取文件…'; state.status.hidden = false;
    state.root.hidden = false; document.body.style.overflow = 'hidden'; state.closeButton.focus();
    void loadPdf(file);
  }
  window.addEventListener('pagehide',closeDialog);
  window.addEventListener('click',event => {
    const file = pdfLinkFromClick(event);
    if (!file || state.root?.contains(file.link)) return;
    event.preventDefault(); event.stopImmediatePropagation(); openDialog(file);
  },true);
})();
