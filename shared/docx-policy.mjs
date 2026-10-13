export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const DOCX_LIMITS = Object.freeze({
  fileBytes: 20 * 1024 * 1024,
  entries: 1000,
  entryBytes: 20 * 1024 * 1024,
  expandedBytes: 60 * 1024 * 1024,
  xmlBytes: 4 * 1024 * 1024,
  htmlBytes: 4 * 1024 * 1024,
  nodes: 50000,
  images: 200,
  imagePixels: 40000000,
  timeoutMs: 20000,
});

// This checks transport bytes only, not proof of a real DOCX. Ordinary ZIP files
// still require full ZIP/OOXML package verification before preview or download.
export function checkDocxTransfer(input, mime = '') {
  let bytes;
  if (input instanceof Uint8Array) {
    bytes = input;
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else if (ArrayBuffer.isView(input)) {
    bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  } else {
    throw new Error('DOCX 文件数据无效。');
  }

  if (bytes.byteLength > DOCX_LIMITS.fileBytes) {
    throw new Error('DOCX 文件大小超过预览限制（20 MiB）。');
  }

  const type = String(mime).split(';')[0].trim().toLowerCase();
  if (type === 'text/html' || type === 'application/xhtml+xml') {
    throw new Error('服务器返回了网页，可能需要重新登录。');
  }
  if (type && type !== DOCX_MIME && type !== 'application/octet-stream') {
    throw new Error('文件类型与 DOCX 预览不符。');
  }

  const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (ole.every((value, i) => bytes[i] === value)) {
    throw new Error('加密 Office 或旧版 Word 文件暂不支持预览。');
  }
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) {
    throw new Error('不是支持的 DOCX 容器，或文件已损坏。');
  }
  return bytes;
}
