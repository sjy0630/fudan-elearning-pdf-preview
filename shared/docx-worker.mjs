import { checkDocxTransfer } from './docx-policy.mjs';
import { convertDocx } from './docx-convert.mjs';

// One request per Worker keeps its lifetime and resource budget unambiguous.
// Exporting the handler also permits a protocol harness without a browser DOM.
export function createDocxWorkerHandler(post) {
  let started = false;
  return async event => {
    if (started) return;
    started = true;
    const request = event?.data;
    const id = typeof request?.id === 'string' && request.id.length <= 128 || typeof request?.id === 'number' && Number.isSafeInteger(request.id) ? request.id : null;
    try {
      if (id === null) throw new Error('DOCX 转换请求无效。');
      const bytes = checkDocxTransfer(request.bytes, request.mime);
      const result = await convertDocx(bytes, { onVerified: () => post({ id, type: 'verified' }) });
      post({ id, type: 'result', ...result }, result.images.map(image => image.bytes.buffer));
    } catch (error) {
      // Only locally authored verifier/converter messages can cross the boundary.
      const message = /^(?:DOCX |OOXML |ZIP |服务器|文件类型|不是支持|加密 Office)/.test(error?.message || '') && error.message.length <= 256 ? error.message : 'DOCX 文档转换失败。';
      post({ id, type: 'error', message });
    }
  };
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof self.document === 'undefined') {
  self.onmessage = createDocxWorkerHandler((message, transfer = []) => self.postMessage(message, transfer));
}
