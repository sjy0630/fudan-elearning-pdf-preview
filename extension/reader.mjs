export class HostPermissionError extends Error {
  constructor(scope) {
    super(`需要允许读取文件服务器：${new URL(scope).hostname}`);
    this.scope = scope;
  }
}

export async function readFile(source, options = {}) {
  return readBounded(source, options, false);
}

export async function readPdf(source, options = {}) {
  return (await readBounded(source, { ...options, format: 'pdf' }, true)).bytes;
}

async function readBounded(source, { api, format, fetchImpl = fetch, limit, timeout = 60000, signal } = {}, legacyPdf) {
  const descriptor = globalThis.CanvasFileFormats.get(format);
  if (!descriptor) throw new Error('不支持的文件格式。');
  if (!globalThis.FdPdf.fileUrl(source)) throw new Error('仅支持复旦 eLearning 的文件链接。');
  if (signal?.aborted) throw signal.reason || new DOMException('已取消读取。', 'AbortError');
  limit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, descriptor.limit) : descriptor.limit;
  const sizeLabel = limit % (1024 * 1024) === 0 ? `${limit / (1024 * 1024)} MiB` : `${limit} 字节`;
  const tooLarge = () => new Error(`文件超过 ${sizeLabel}，请使用“打开原文件”。`);
  const baseScope = globalThis.FdPdf.permissionScope(source);
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(signal.reason || new DOMException('已取消读取。', 'AbortError'));
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Number.isFinite(timeout) && timeout >= 0 ? timeout : 60000);
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const onControllerAbort = () => rejectAbort(timedOut ? new Error('读取超时，请检查网络后重试。') : controller.signal.reason);
  controller.signal.addEventListener('abort', onControllerAbort, { once: true });
  const wait = promise => Promise.race([promise, aborted]);
  const seen = new Set([source]);
  let redirect = null;
  let requestId = null;
  const observe = (details) => {
    if (!seen.has(details.url) || (requestId && requestId !== details.requestId)) return;
    requestId = details.requestId;
    redirect = details.redirectUrl;
    seen.add(redirect);
  };
  let listening = false, reader, response;
  try {
    if (!(await wait(api.permissions.contains({ origins: [baseScope] })))) throw new HostPermissionError(baseScope);
    api.webRequest.onBeforeRedirect.addListener(observe, { urls: ['https://*/*'] });
    listening = true;
    response = await wait(fetchImpl(source, {
      credentials: 'include', redirect: 'follow', signal: controller.signal,
      headers: { Accept: descriptor.mime },
    }));
    if (!response.ok) {
      throw new Error([401, 403].includes(response.status)
        ? '登录已失效或没有文件权限。请先打开 eLearning 登录，然后重试。'
        : `文件读取失败（HTTP ${response.status}）。`);
    }
    if (Number(response.headers.get('content-length')) > limit) throw tooLarge();
    if (!response.body) throw new Error('文件服务返回了空内容。');
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await wait(reader.read());
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        throw tooLarge();
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const mime = response.headers.get('content-type') || '';
    let validated;
    try {
      // The original PDF API relied on the signature, irrespective of server MIME.
      validated = globalThis.CanvasFileFormats.validate(bytes, format, legacyPdf ? '' : mime);
    } catch (error) {
      if (legacyPdf) throw new Error('返回内容不是 PDF，可能是登录页面。请登录 eLearning 后重试。');
      throw error;
    }
    return { bytes, mime: validated.mime };
  } catch (error) {
    if (controller.signal.aborted) throw timedOut ? new Error('读取超时，请检查网络后重试。') : controller.signal.reason;
    if (error instanceof TypeError && redirect) {
      const scope = globalThis.FdPdf.permissionScope(redirect);
      if (scope && !(await wait(api.permissions.contains({ origins: [scope] })))) throw new HostPermissionError(scope);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    controller.signal.removeEventListener('abort', onControllerAbort);
    try { if (listening) api.webRequest.onBeforeRedirect.removeListener(observe); } catch { /* Keep the primary result. */ }
    try {
      const cancellation = reader ? reader.cancel() : response?.body?.cancel();
      Promise.resolve(cancellation).catch(() => {});
    } catch { /* Cancellation must not replace the primary error. */ }
    try { reader?.releaseLock(); } catch { /* Preserve the primary result. */ }
    controller.abort();
  }
}
