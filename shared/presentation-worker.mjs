import { parse, renderSlideToSvg, setMetafileDecoder, setFontDecoder } from '@web-ppt/core';
import { verifyPresentationPackage } from './presentation-package.mjs';
import { PRESENTATION_LIMITS as L, PRESENTATION_WARNINGS as W, boundedPresentationText, validatePresentationDimensions } from './presentation-policy.mjs';

// Do not invoke the optional legacy image or embedded-font decoders. Metafiles
// can contain independently compressed bitmaps with attacker-chosen dimensions.
setMetafileDecoder(() => null);
setFontDecoder(null);
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(id);
export function createPresentationWorkerHandler(post) {
  let presentation, opening = false, disposed = false, busy = false, warnings = [];
  const blobs = new Map();
  let blobBytes = 0;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    try { presentation?.dispose?.(); } catch { /* Termination also releases worker URLs. */ }
    for (const url of blobs.keys()) URL.revokeObjectURL(url);
    blobs.clear(); presentation = null;
  };
  const handle = async event => {
    const request = event?.data, id = validId(request?.id) ? request.id : null;
    if (disposed) return;
    if (busy) { post({ id, type: 'error', message: '幻灯片正在处理上一项请求。' }); return; }
    busy = true;
    const originalCreate = URL.createObjectURL;
    // Intercept only locally created blobs, never resolve a document URL using
    // fetch(). The wrapper is restored before another message can be handled.
    URL.createObjectURL = blob => {
      if (!(blob instanceof Blob) || blob.size > L.entryBytes || blobs.size >= L.entries || blobBytes + blob.size > L.expandedBytes) throw new Error('幻灯片资源大小超过限制。');
      const url = originalCreate.call(URL, blob);
      blobs.set(url, blob); blobBytes += blob.size;
      return url;
    };
    try {
      if (!id) throw new Error('幻灯片请求编号无效。');
      if (request.type === 'open') {
        if (opening || presentation) throw new Error('幻灯片文件已打开。');
        opening = true;
        const checked = verifyPresentationPackage(request.bytes, request.format, request.mime);
        const parsed = await parse(checked.parseBytes, { lazy: true });
        if (disposed) { parsed?.dispose?.(); return; }
        if (!parsed || parsed.source !== request.format || !Array.isArray(parsed.slides) || !parsed.slides.length || parsed.slides.length > L.slides || checked.slideCount !== null && checked.slideCount !== parsed.slides.length) throw new Error('幻灯片解析结构无效或超过限制（500 页）。');
        validatePresentationDimensions(parsed.width, parsed.height);
        presentation = parsed;
        presentation.embeddedFonts = [];
        warnings = checked.warnings;
        post({ id, type: 'ready', format: parsed.source, slideCount: parsed.slides.length, width: parsed.width, height: parsed.height, warnings });
      } else if (request.type === 'render') {
        if (!presentation || !Number.isInteger(request.page) || request.page < 0 || request.page >= presentation.slides.length) throw new Error('幻灯片页码无效。');
        const slide = presentation.slides[request.page];
        if (!slide || !Array.isArray(slide.elements)) throw new Error('幻灯片正文结构无效。');
        let svg = renderSlideToSvg(presentation, slide, { textMode: 'svg', media: 'badge' });
        if (boundedPresentationText(svg) > L.svgBytes) throw new Error('幻灯片页面内容超过限制（8 MiB）。');
        const assets = [], pageWarnings = [...warnings];
        let bytes = 0;
        for (const [url, blob] of blobs) {
          if (!svg.includes(url)) continue;
          if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) { svg = svg.split(url).join('presentation-unsupported-image'); if (!pageWarnings.includes(W.image)) pageWarnings.push(W.image); continue; }
          if (++bytes > L.images) throw new Error('幻灯片图片数量超过限制。');
          const asset = { id: `presentation-image-${assets.length + 1}`, mime: blob.type, bytes: new Uint8Array(await blob.arrayBuffer()) };
          svg = svg.split(url).join(asset.id); assets.push(asset);
        }
        if (!disposed) post({ id, type: 'slide', page: request.page, svg, assets, warnings: pageWarnings }, assets.map(a => a.bytes.buffer));
      } else throw new Error('幻灯片请求类型无效。');
    } catch (error) {
      if (!disposed) post({ id, type: 'error', message: /^(?:幻灯片 |ZIP |服务器|文件类型|不是支持)/.test(error?.message || '') && error.message.length <= 256 ? error.message : '幻灯片本地解析或渲染失败，请下载原文件查看。' });
    } finally {
      URL.createObjectURL = originalCreate;
      busy = false;
    }
  };
  handle.dispose = cleanup;
  return handle;
}
if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof self.document === 'undefined') self.onmessage = createPresentationWorkerHandler((message, transfer = []) => self.postMessage(message, transfer));
