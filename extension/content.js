(function () {
  'use strict';
  const api = globalThis.browser || chrome;
  window.addEventListener('click', (event) => {
    const file = FdPdf.fromClick(event);
    if (!file) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    api.runtime.sendMessage({ type: 'open-pdf', file }).then((result) => {
      if (!result?.ok) location.assign(file.original);
    }).catch(() => location.assign(file.original));
  }, true);
})();
