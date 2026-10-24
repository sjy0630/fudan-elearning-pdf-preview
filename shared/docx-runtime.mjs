import { checkDocxTransfer, DOCX_LIMITS } from './docx-policy.mjs';

let taskSequence = 0;
const invalid = () => new Error('DOCX 转换结果无效或超过预览限制。');
const asError = failure => failure instanceof Error ? failure : new Error('DOCX 本地转换失败。');

// Count without allocating a second potentially large encoded string.
export function boundedDocxUtf8Length(value, limit = DOCX_LIMITS.htmlBytes) {
  let size = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) size++;
    else if (code < 0x800) size += 2;
    else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { size += 4; i++; }
    else size += 3;
    if (size > limit) return limit + 1;
  }
  return size;
}

export function validateDocxResult(result) {
  if (!result || typeof result.html !== 'string' || boundedDocxUtf8Length(result.html) > DOCX_LIMITS.htmlBytes || !Array.isArray(result.images) || result.images.length > DOCX_LIMITS.images || !Array.isArray(result.warnings) || result.warnings.length > 32) throw invalid();
  const ids = new Set();
  let totalBytes = 0;
  for (const image of result.images) {
    if (!image || typeof image.id !== 'string' || !/^docx-image-[1-9][0-9]{0,8}$/.test(image.id) || ids.has(image.id) || !['image/png', 'image/jpeg', 'image/webp'].includes(image.mime) || !(image.bytes instanceof Uint8Array) || image.bytes.byteLength > DOCX_LIMITS.entryBytes) throw invalid();
    ids.add(image.id);
    totalBytes += image.bytes.byteLength;
    if (totalBytes > DOCX_LIMITS.expandedBytes) throw invalid();
  }
  for (const warning of result.warnings) if (typeof warning !== 'string' || boundedDocxUtf8Length(warning, 1024) > 1024) throw invalid();
  return { html: result.html, images: result.images, warnings: result.warnings };
}

export const docxAbortError = () => new DOMException('DOCX 预览已取消。', 'AbortError');

export function runDocxTask(input, mime = '', { signal, makeWorker, onVerified } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(docxAbortError()); return; }
    let worker, dispose, timer, pendingResult, settled = false, verified = false, verificationDone = false;
    const id = `docx-task-${++taskSequence}`;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (worker) {
        for (const [name, handler] of [['message', message], ['error', error], ['messageerror', error]]) {
          try { worker.removeEventListener(name, handler); } catch { /* Continue releasing the remaining resources. */ }
        }
        try { worker.terminate(); } catch { /* Disposal still runs. */ }
      }
      try { dispose?.(); } catch { /* Cleanup must not replace the task outcome. */ }
    };
    const finish = (failure, result) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (failure) reject(failure);
      else resolve(result);
    };
    const abort = () => finish(docxAbortError());
    const error = () => finish(new Error('DOCX 本地转换进程启动或运行失败，请重试。'));
    const message = event => {
      if (settled || event?.data?.id !== id) return;
      const data = event.data;
      try {
        if (data.type === 'verified') {
          if (verified) throw invalid();
          verified = true;
          Promise.resolve(onVerified?.()).then(() => {
            if (settled) return;
            verificationDone = true;
            if (pendingResult) finish(null, pendingResult);
          }, failure => finish(failure instanceof Error ? failure : new Error('DOCX 已验证文件处理失败。')));
        } else if (data.type === 'result') {
          if (!verified || pendingResult) throw invalid();
          pendingResult = validateDocxResult(data);
          if (verificationDone) finish(null, pendingResult);
        } else if (data.type === 'error') {
          if (typeof data.message !== 'string' || !data.message || boundedDocxUtf8Length(data.message, 1024) > 1024) throw invalid();
          // Error text is authored by the packaged worker, never rendered as HTML.
          finish(new Error(data.message));
        } else throw invalid();
      } catch (failure) { finish(asError(failure)); }
    };
    try {
      const checked = checkDocxTransfer(input, mime);
      // Buffer.slice() aliases its input. Uint8Array.from always owns exact bytes.
      const copy = Uint8Array.from(checked);
      if (typeof makeWorker !== 'function') throw new Error('DOCX 本地转换进程不可用。');
      const created = makeWorker();
      worker = created?.worker;
      dispose = created?.dispose;
      if (!worker || typeof worker.postMessage !== 'function' || typeof worker.addEventListener !== 'function' || typeof worker.removeEventListener !== 'function' || typeof worker.terminate !== 'function' || typeof dispose !== 'function') throw new Error('DOCX 本地转换进程不可用。');
      worker.addEventListener('message', message);
      worker.addEventListener('error', error);
      worker.addEventListener('messageerror', error);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      timer = setTimeout(() => finish(new Error('DOCX 本地转换超时，请下载原文件查看。')), DOCX_LIMITS.timeoutMs);
      worker.postMessage({ id, bytes: copy, mime }, [copy.buffer]);
    } catch (failure) { finish(asError(failure)); }
  });
}
