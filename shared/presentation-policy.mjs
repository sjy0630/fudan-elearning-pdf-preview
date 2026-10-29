export const PRESENTATION_MIMES = Object.freeze({
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
});
export const PRESENTATION_LIMITS = Object.freeze({
  fileBytes: 50 * 1024 * 1024, expandedBytes: 150 * 1024 * 1024,
  entryBytes: 50 * 1024 * 1024, xmlBytes: 8 * 1024 * 1024,
  svgBytes: 8 * 1024 * 1024, entries: 10000, slides: 500,
  nodes: 200000, pageNodes: 50000, images: 1000,
  imagePixels: 40000000, canvasSide: 16384, timeoutMs: 30000,
});
export const presentationAbortError = () => new DOMException('幻灯片预览已取消。', 'AbortError');
export function checkPresentationTransfer(input, format, mime = '') {
  if (!Object.hasOwn(PRESENTATION_MIMES, format)) throw new Error('幻灯片格式不支持。');
  const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : null;
  if (!bytes) throw new Error('幻灯片文件数据无效。');
  if (bytes.byteLength > PRESENTATION_LIMITS.fileBytes) throw new Error('幻灯片文件大小超过预览限制（50 MiB）。');
  const type = String(mime).split(';')[0].trim().toLowerCase();
  if (type === 'text/html' || type === 'application/xhtml+xml') throw new Error('服务器返回了网页，可能需要重新登录。');
  if (type && type !== PRESENTATION_MIMES[format] && type !== 'application/octet-stream') throw new Error('文件类型与幻灯片格式不符。');
  const signature = format === 'pptx' ? [80, 75, 3, 4] : [208, 207, 17, 224, 161, 177, 26, 225];
  if (!signature.every((byte, i) => bytes[i] === byte)) throw new Error(`不是支持的 ${format.toUpperCase()} 容器，或文件已损坏。`);
  return bytes;
}
export function boundedPresentationText(value, limit = PRESENTATION_LIMITS.svgBytes) {
  if (typeof value !== 'string') return limit + 1;
  let size = 0;
  for (let i = 0; i < value.length; i++) {
    const n = value.charCodeAt(i);
    size += n < 128 ? 1 : n < 2048 ? 2 : n >= 0xd800 && n <= 0xdbff && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff ? (++i, 4) : 3;
    if (size > limit) return limit + 1;
  }
  return size;
}
export function validatePresentationDimensions(width, height) {
  if (![width, height].every(n => Number.isFinite(n) && n >= 1 && n <= PRESENTATION_LIMITS.canvasSide) || width * height > PRESENTATION_LIMITS.imagePixels) throw new Error('幻灯片画布尺寸无效或超过预览限制。');
}
export const PRESENTATION_WARNINGS = Object.freeze({
  static: '本预览为静态幻灯片；动画、音视频、宏和嵌入对象不运行，复杂版式可能与原文件不同。',
  external: '外部图片、资源和超链接已禁用，预览不会读取外部地址。',
  image: '部分图片格式或尺寸不受支持，已省略并保留其他幻灯片内容。',
  vector: '部分矢量图片暂不支持安全预览，已省略并保留其他幻灯片内容。',
  fonts: '预览使用本机字体，嵌入字体及文字换行可能与原文件不同。',
  content: '部分特殊效果或内容无法完整显示，请结合原文件查看。',
});
