import { checkPresentationTransfer, PRESENTATION_LIMITS as L, PRESENTATION_WARNINGS as W, presentationAbortError, boundedPresentationText, validatePresentationDimensions } from './presentation-policy.mjs';

let sequence = 0;
const invalid = () => new Error('幻灯片转换结果无效或超过限制。');
const fixedWarnings = new Set(Object.values(W));
export function validatePresentationWarnings(warnings) {
  if (!Array.isArray(warnings) || warnings.length > 32 || warnings.some(w => typeof w !== 'string' || boundedPresentationText(w, 1024) > 1024)) throw invalid();
  return [...new Set(warnings.map(w => fixedWarnings.has(w) ? w : W.content))];
}
export function validatePresentationSlide(result) {
  if (!result || !Number.isInteger(result.page) || result.page < 0 || result.page >= L.slides || typeof result.svg !== 'string' || !result.svg || boundedPresentationText(result.svg) > L.svgBytes || !Array.isArray(result.assets) || result.assets.length > L.images) throw invalid();
  const ids = new Set(); let total = 0;
  for (const asset of result.assets) {
    if (!asset || !/^presentation-image-[1-9][0-9]{0,4}$/.test(asset.id || '') || ids.has(asset.id) || !['image/png', 'image/jpeg', 'image/webp'].includes(asset.mime) || !(asset.bytes instanceof Uint8Array) || asset.bytes.length > L.entryBytes) throw invalid();
    ids.add(asset.id); total += asset.bytes.length;
    if (total > L.expandedBytes) throw invalid();
  }
  return { page: result.page, svg: result.svg, assets: result.assets, warnings: validatePresentationWarnings(result.warnings) };
}
export function createPresentationSession(input, format, mime = '', { signal, makeWorker, onVerified } = {}) {
  let worker, release, pending, closed = false, closedReason;
  const abort = () => dispose(presentationAbortError());
  const dispose = (failure = presentationAbortError()) => {
    if (closed) return;
    closed = true; closedReason = failure;
    if (pending) { clearTimeout(pending.timer); pending.reject(failure); pending = null; }
    signal?.removeEventListener('abort', abort);
    if (worker) {
      for (const [name, handler] of [['message', message], ['error', error], ['messageerror', error]]) try { worker.removeEventListener(name, handler); } catch { /* Release the rest. */ }
      try { worker.terminate(); } catch { /* Release the Blob URL as well. */ }
    }
    try { release?.(); } catch { /* Cleanup cannot change the outcome. */ }
  };
  const error = () => dispose(new Error('幻灯片本地处理进程失败，请重新打开文件。'));
  const message = event => {
    if (closed || !pending || event?.data?.id !== pending.id) return;
    const request = pending, data = event.data;
    try {
      if (data.type === 'error') {
        if (typeof data.message !== 'string' || !data.message || boundedPresentationText(data.message, 1024) > 1024) throw invalid();
        clearTimeout(request.timer); pending = null; request.reject(new Error(data.message)); return;
      }
      let result;
      if (request.kind === 'open' && data.type === 'ready') {
        if (data.format !== format || !Number.isInteger(data.slideCount) || data.slideCount < 1 || data.slideCount > L.slides) throw invalid();
        validatePresentationDimensions(data.width, data.height);
        result = { slideCount: data.slideCount, width: data.width, height: data.height, format, warnings: validatePresentationWarnings(data.warnings) };
      } else if (request.kind === 'render' && data.type === 'slide') {
        result = validatePresentationSlide(data);
        if (result.page !== request.page) throw invalid();
      } else throw invalid();
      clearTimeout(request.timer); pending = null; request.resolve(result);
    } catch (failure) { dispose(failure instanceof Error ? failure : invalid()); }
  };
  const ask = (kind, payload, transfers = []) => new Promise((resolve, reject) => {
    if (closed) { reject(closedReason || presentationAbortError()); return; }
    if (pending) { reject(new Error('幻灯片正在处理上一项请求。')); return; }
    const id = `presentation-${++sequence}`;
    const timer = setTimeout(() => dispose(new Error('幻灯片本地处理超时（30 秒），请下载原文件查看。')), L.timeoutMs);
    pending = { id, kind, page: payload.page, resolve, reject, timer };
    try { worker.postMessage({ type: kind, id, ...payload }, transfers); } catch { error(); }
  });
  try {
    if (signal?.aborted) return Promise.reject(presentationAbortError());
    const bytes = Uint8Array.from(checkPresentationTransfer(input, format, mime));
    const created = makeWorker?.();
    worker = created?.worker; release = created?.dispose;
    if (!worker || !['postMessage', 'addEventListener', 'removeEventListener', 'terminate'].every(key => typeof worker[key] === 'function') || typeof release !== 'function') throw new Error('幻灯片本地处理进程不可用。');
    worker.addEventListener('message', message); worker.addEventListener('error', error); worker.addEventListener('messageerror', error);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return Promise.reject(presentationAbortError()); }
    return ask('open', { bytes, format, mime }, [bytes.buffer]).then(async info => {
      if (closed) throw presentationAbortError();
      await onVerified?.();
      if (closed) throw presentationAbortError();
      return { ...info, render: page => {
        if (!Number.isInteger(page) || page < 0 || page >= info.slideCount) return Promise.reject(new Error('幻灯片页码无效。'));
        return ask('render', { page });
      }, dispose };
    }).catch(failure => { dispose(failure); throw failure; });
  } catch (failure) { dispose(failure); return Promise.reject(failure); }
}
