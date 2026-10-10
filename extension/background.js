/* Firefox loads core.js before this script; Chromium uses a service worker. */
if (typeof importScripts === 'function') importScripts('formats.js', 'catalog.js', 'core.js');
const api = globalThis.browser || chrome;

api.runtime.onMessage.addListener((message, sender, respond) => {
  if (!FdPdf.allowedMessage(message, sender, api.runtime.id)) return false;
  const format = CanvasPreviewCatalog.formats.find((format) => format.id === (message.file.format || 'pdf'));
  const url = new URL(api.runtime.getURL(format.viewer));
  url.searchParams.set('source', message.file.source);
  url.searchParams.set('original', message.file.original || message.file.source);
  url.searchParams.set('name', message.type === 'open-pdf' ? FdPdf.filename(message.file.name) : FdPdf.fileName(message.file.name, format.id));
  url.searchParams.set('format', format.id);
  api.tabs.create({ url: url.href, openerTabId: sender.tab.id }).then(
    () => respond({ ok: true }),
    () => respond({ ok: false }),
  );
  return true;
});

api.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') api.tabs.create({ url: api.runtime.getURL('help.html') });
});
