export class HostPermissionError extends Error {
  constructor(scope) {
    super(`需要允许读取文件服务器：${new URL(scope).hostname}`);
    this.scope = scope;
  }
}

export async function readPdf(source, { api, fetchImpl = fetch, limit = 100 * 1024 * 1024, timeout = 60000 } = {}) {
  if (!globalThis.FdPdf.fileUrl(source)) throw new Error('仅支持复旦 eLearning 的文件链接。');
  const baseScope = globalThis.FdPdf.permissionScope(source);
  if (!(await api.permissions.contains({ origins: [baseScope] }))) throw new HostPermissionError(baseScope);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const seen = new Set([source]);
  let redirect = null;
  let requestId = null;
  const observe = (details) => {
    if (!seen.has(details.url) || (requestId && requestId !== details.requestId)) return;
    requestId = details.requestId;
    redirect = details.redirectUrl;
    seen.add(redirect);
  };
  api.webRequest.onBeforeRedirect.addListener(observe, { urls: ['https://*/*'] });
  try {
    const response = await fetchImpl(source, {
      credentials: 'include', redirect: 'follow', signal: controller.signal,
      headers: { Accept: 'application/pdf' },
    });
    if (!response.ok) {
      throw new Error([401, 403].includes(response.status)
        ? '登录已失效或没有文件权限。请先打开 eLearning 登录，然后重试。'
        : `文件读取失败（HTTP ${response.status}）。`);
    }
    if (Number(response.headers.get('content-length')) > limit) throw new Error('文件超过 100 MiB，请使用“打开原文件”。');
    if (!response.body) throw new Error('文件服务返回了空内容。');
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error('文件超过 100 MiB，请使用“打开原文件”。');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') {
      throw new Error('返回内容不是 PDF，可能是登录页面。请登录 eLearning 后重试。');
    }
    return bytes;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('读取超时，请检查网络后重试。');
    if (error instanceof TypeError && redirect) {
      const scope = globalThis.FdPdf.permissionScope(redirect);
      if (scope && !(await api.permissions.contains({ origins: [scope] }))) throw new HostPermissionError(scope);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    api.webRequest.onBeforeRedirect.removeListener(observe);
    controller.abort();
  }
}
