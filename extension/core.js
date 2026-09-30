/* Shared by content script, background and viewer; no remote code. */
(function (root) {
  'use strict';
  const catalog = root.CanvasPreviewCatalog;
  const formats = root.CanvasFileFormats;
  const canvasPath = /^\/(?:courses\/\d+\/)?files\/\d+(?:\/(?:download|preview))?\/?$/;
  function pathName(url) {
    try { return decodeURIComponent(url.pathname.split('/').pop()); } catch { return ''; }
  }
  const ORIGIN = catalog.platforms[0].origin;
  function schoolUrl(value) {
    try {
      const url = new URL(value);
      return catalog.platforms.some((platform) => platform.origin === url.origin) && !url.username && !url.password ? url : null;
    } catch { return null; }
  }
  function fileUrl(value) {
    const url = schoolUrl(value);
    if (url && /^\/(?:courses\/[^/]+\/)?files\//.test(url.pathname) && !canvasPath.test(url.pathname)) return null;
    return url && (canvasPath.test(url.pathname) || formats.identify(pathName(url))) ? url : null;
  }
  function filename(value) {
    const name = String(value || 'document.pdf').replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim().slice(0, 180);
    return /\.pdf$/i.test(name) ? name : `${name || 'document'}.pdf`;
  }
  function describe(href, label) {
    const url = fileUrl(href);
    const explicit = formats.identify(String(label || '').trim());
    const format = explicit || (url && formats.identify(pathName(url)));
    if (!url || !format) return null;
    const match = canvasPath.test(url.pathname) && url.pathname.match(/^(\/(?:courses\/\d+\/)?files\/\d+)/);
    const source = match ? new URL(`${match[1]}/download`, url.origin) : new URL(url);
    if (match) {
      source.searchParams.set('download_frd', '1');
      if (url.searchParams.has('verifier')) source.searchParams.set('verifier', url.searchParams.get('verifier'));
    }
    source.hash = '';
    return { source: source.href, original: url.href, name: fileName(explicit ? label : pathName(url), format.id), format: format.id };
  }
  function fileName(name, format) {
    const safe = formats.safeName(name, format);
    const suffix = safe.slice(safe.lastIndexOf('.'));
    return safe.length > 180 ? safe.slice(0, 180 - suffix.length) + suffix : safe;
  }
  function fromClick(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
    const link = event.target?.nodeType === 1 ? event.target.closest('a[href]') : null;
    if (!link || link.hasAttribute('download') || link.matches('.download, .download_link, [aria-label*="Download"], [aria-label*="下载"]')) return null;
    const labels = [link.dataset.filename, link.textContent?.trim(), link.title].filter(Boolean);
    const label = labels.find(value => formats.identify(value.trim())) || labels[0] || '';
    return describe(link.href, label);
  }
  function allowedMessage(message, sender, extensionId) {
    const legacy = message?.type === 'open-pdf';
    if (!sender || sender.id !== extensionId || !sender.tab || !schoolUrl(sender.url) ||
        (!legacy && message?.type !== 'open-file')) return false;
    const file = message.file;
    const id = file?.format || (legacy ? 'pdf' : null);
    if (!formats.get(id) || (legacy && id !== 'pdf') || !fileUrl(file?.source) ||
        !fileUrl(file?.original || (legacy ? file?.source : null))) return false;
    if (legacy && (!file.name || !/\.[a-z0-9]+$/i.test(String(file.name).trim()))) {
      return formats.identify(filename(file.name))?.id === 'pdf';
    }
    return formats.identify(file.name)?.id === id;
  }
  function permissionScope(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      return `${url.origin}/*`;
    } catch { return null; }
  }
  root.FdPdf = Object.freeze({ ORIGIN, schoolUrl, fileUrl, filename, fileName, describe, fromClick, allowedMessage, permissionScope });
})(globalThis);
