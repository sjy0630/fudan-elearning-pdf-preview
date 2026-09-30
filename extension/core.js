/* Shared by content script, background and viewer; no remote code. */
(function (root) {
  'use strict';
  const catalog = root.CanvasPreviewCatalog;
  const ORIGIN = catalog.platforms[0].origin;
  function schoolUrl(value) {
    try {
      const url = new URL(value);
      return catalog.platforms.some((platform) => platform.origin === url.origin) && !url.username && !url.password ? url : null;
    } catch { return null; }
  }
  function fileUrl(value) {
    const url = schoolUrl(value);
    return url && (/^\/(?:courses\/\d+\/)?files\/\d+(?:\/(?:download|preview))?\/?$/.test(url.pathname) || catalog.formats.some((format) => format.pathPattern.test(url.pathname))) ? url : null;
  }
  function filename(value) {
    const name = String(value || 'document.pdf').replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim().slice(0, 180);
    return /\.pdf$/i.test(name) ? name : `${name || 'document'}.pdf`;
  }
  function describe(href, label) {
    const url = fileUrl(href);
    const format = catalog.formats.find((format) => format.labelPattern.test(label));
    if (!url || !format) return null;
    const match = url.pathname.match(/^(\/(?:courses\/\d+\/)?files\/\d+)/);
    const source = match ? new URL(`${match[1]}/download`, url.origin) : new URL(url);
    if (match) {
      source.searchParams.set('download_frd', '1');
      if (url.searchParams.has('verifier')) source.searchParams.set('verifier', url.searchParams.get('verifier'));
    }
    source.hash = '';
    return { source: source.href, original: url.href, name: filename(label), format: format.id };
  }
  function fromClick(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
    const link = event.target?.nodeType === 1 ? event.target.closest('a[href]') : null;
    if (!link || link.hasAttribute('download') || link.matches('.download, .download_link, [aria-label*="Download"], [aria-label*="下载"]')) return null;
    const label = link.dataset.filename || link.textContent?.trim() || link.title || '';
    return describe(link.href, label);
  }
  function allowedMessage(message, sender, extensionId) {
    return sender.id === extensionId && Boolean(sender.tab) && Boolean(schoolUrl(sender.url)) &&
      message?.type === 'open-pdf' && catalog.formats.some((format) => format.id === (message.file?.format || 'pdf')) &&
      Boolean(fileUrl(message.file?.source)) && Boolean(fileUrl(message.file?.original));
  }
  function permissionScope(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      return `${url.origin}/*`;
    } catch { return null; }
  }
  root.FdPdf = Object.freeze({ ORIGIN, schoolUrl, fileUrl, filename, describe, fromClick, allowedMessage, permissionScope });
})(globalThis);
