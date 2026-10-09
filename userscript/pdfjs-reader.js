let cachedPdfjsRuntime;
function createPdfjsReader({ container, bytes, signal, onError }) {
  const runtime = cachedPdfjsRuntime || (cachedPdfjsRuntime = createPdfjsRuntime());
  const lifetime = new AbortController();
  const root = document.createElement('div'); root.className = 'fdpdf-reader';
  const controls = document.createElement('div'); controls.className = 'fdpdf-tools fdpdf-pdf-controls';
  const scroll = document.createElement('div'); scroll.className = 'fdpdf-pdf-scroll';
  const status = document.createElement('div'); status.className = 'fdpdf-reader-status'; status.setAttribute('role', 'status'); status.textContent = '正在加载内置 PDF.js…';
  root.append(controls, status, scroll); container.append(root);
  let documentProxy, opened, library, observer, cleanupPromise, passwordCleanup;
  let closed = false, failed = false, readySettled = false, usable = false, generation = 0;
  let pageNumber = 1, scale = 1, fit = true, lastFitWidth = 0, canvasTask, textTask;
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  ready.catch(() => {});
  const abortError = () => new DOMException('PDF preview cancelled', 'AbortError');
  const isCancellation = error => ['AbortError', 'AbortException', 'RenderingCancelledException'].includes(error?.name);
  function control(action, label, handler) {
    const node = document.createElement('button'); node.type = 'button'; node.className = 'fdpdf-action';
    node.dataset.action = action; node.textContent = label; node.disabled = true;
    node.addEventListener('click', handler, { signal: lifetime.signal }); controls.append(node); return node;
  }
  const previous = control('pdf-prev', '上一页', () => goTo(pageNumber - 1));
  const pageLabel = document.createElement('label'); pageLabel.textContent = '页码 ';
  const pageInput = document.createElement('input'); pageInput.type = 'number'; pageInput.min = '1'; pageInput.step = '1'; pageInput.value = '1'; pageInput.disabled = true; pageInput.setAttribute('aria-label', '页码');
  const pageCount = document.createElement('span'); pageCount.className = 'fdpdf-page-count'; pageCount.textContent = '/ —';
  pageLabel.append(pageInput); controls.append(pageLabel, pageCount);
  const next = control('pdf-next', '下一页', () => goTo(pageNumber + 1));
  const smaller = control('pdf-zoom-out', '缩小', () => zoom(1 / 1.25));
  const larger = control('pdf-zoom-in', '放大', () => zoom(1.25));
  const fitButton = control('pdf-fit', '适合宽度', () => { fit = true; void paint(); });
  pageInput.addEventListener('change', () => goTo(Number(pageInput.value)), { signal: lifetime.signal });
  pageInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); goTo(Number(pageInput.value)); } }, { signal: lifetime.signal });
  function updateControls() {
    previous.disabled = !usable || pageNumber <= 1; next.disabled = !usable || pageNumber >= documentProxy.numPages;
    pageInput.disabled = smaller.disabled = larger.disabled = fitButton.disabled = !usable;
    pageInput.value = String(pageNumber); fitButton.setAttribute('aria-pressed', String(fit));
  }
  function goTo(value) {
    if (!usable || closed) return;
    const target = Number.isFinite(value) ? Math.max(1, Math.min(documentProxy.numPages, Math.trunc(value))) : pageNumber;
    pageInput.value = String(target);
    if (target === pageNumber) return;
    pageNumber = target; updateControls(); void paint();
  }
  function zoom(factor) {
    if (!usable || closed) return;
    fit = false; scale = Math.max(0.1, Math.min(5, scale * factor)); updateControls(); void paint();
  }
  function cancelPaint() {
    canvasTask?.cancel(); textTask?.cancel(); canvasTask = textTask = null;
  }
  function rejectInitial(error) { if (!readySettled) { readySettled = true; rejectReady(error); } }
  function fail(error) {
    if (closed || failed) return;
    failed = true; rejectInitial(error); void destroy();
    if (!isCancellation(error) && typeof onError === 'function') {
      try { Promise.resolve(onError(error)).catch(() => {}); } catch { /* Cleanup must finish even if a consumer fails. */ }
    }
  }
  function checkViewport(viewport) {
    if (![viewport.width, viewport.height, viewport.scale, viewport.userUnit].every(value => Number.isFinite(value) && value > 0)) {
      throw new Error('PDF 页面尺寸无效。');
    }
  }
  async function paint() {
    const id = ++generation, number = pageNumber;
    cancelPaint();
    const current = () => !closed && id === generation;
    try {
      const page = await documentProxy.getPage(number);
      if (!current()) return;
      const natural = page.getViewport({ scale: 1 }); checkViewport(natural);
      if (fit) {
        lastFitWidth = scroll.clientWidth;
        scale = Math.max(0.01, Math.min(5, Math.max(1, lastFitWidth - 24) / natural.width));
      }
      const viewport = page.getViewport({ scale }); checkViewport(viewport);
      const sheet = document.createElement('div'); sheet.className = 'fdpdf-pdf-page'; sheet.dataset.page = String(number);
      sheet.style.width = `${viewport.width}px`; sheet.style.height = `${viewport.height}px`;
      sheet.style.setProperty('--scale-factor', String(viewport.scale)); sheet.style.setProperty('--user-unit', String(viewport.userUnit));
      const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', `PDF 第 ${number} 页`);
      const deviceRatio = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
      // The cap may reduce output below one pixel per CSS pixel on a large page.
      const ratio = Math.min(deviceRatio, Math.sqrt(16000000 / viewport.width / viewport.height), 8192 / viewport.width, 8192 / viewport.height);
      canvas.width = Math.max(1, Math.floor(viewport.width * ratio)); canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
      canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
      const layer = document.createElement('div'); layer.className = 'fdpdf-text-layer textLayer';
      sheet.append(canvas, layer); scroll.replaceChildren(sheet);
      const render = page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: [canvas.width / viewport.width, 0, 0, canvas.height / viewport.height, 0, 0] });
      const text = new library.TextLayer({ textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }), container: layer, viewport });
      canvasTask = render; textTask = text;
      await Promise.all([render.promise, text.render()]);
      if (!current()) return;
      canvasTask = textTask = null; sheet.dataset.ready = 'true'; status.hidden = true;
      usable = true; updateControls();
      if (!readySettled) { readySettled = true; resolveReady(); }
    } catch (error) { if (current()) fail(error); }
  }
  function askPassword({ reason, signal: passwordSignal }) {
    passwordCleanup?.();
    if (closed || passwordSignal.aborted) return Promise.resolve(null);
    status.hidden = true;
    return new Promise(resolve => {
      const form = document.createElement('form'); form.className = 'fdpdf-password';
      const message = document.createElement('p'); message.setAttribute('role', 'status'); message.textContent = reason === 2 ? '密码不正确，请重试。' : '此 PDF 需要密码。';
      const label = document.createElement('label'); label.textContent = 'PDF 密码 ';
      const input = document.createElement('input'); input.type = 'password'; input.autocomplete = 'off'; input.setAttribute('aria-label', 'PDF 密码'); label.append(input);
      const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'fdpdf-action'; submit.textContent = '解锁';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'fdpdf-action'; cancel.textContent = '取消';
      form.append(message, label, submit, cancel); root.insertBefore(form, scroll);
      let settled = false;
      const finish = value => {
        if (settled) return; settled = true;
        input.value = ''; form.removeEventListener('submit', onSubmit); cancel.removeEventListener('click', onCancel);
        passwordSignal.removeEventListener('abort', onCancel); form.remove(); passwordCleanup = null;
        if (!closed) { status.hidden = false; status.textContent = '正在加载内置 PDF.js…'; }
        resolve(value);
      };
      const onCancel = () => finish(null);
      const onSubmit = event => { event.preventDefault(); const value = input.value; input.value = ''; finish(value); };
      form.addEventListener('submit', onSubmit); cancel.addEventListener('click', onCancel); passwordSignal.addEventListener('abort', onCancel, { once: true });
      passwordCleanup = onCancel; input.focus();
    });
  }
  function destroy() {
    if (cleanupPromise) return cleanupPromise;
    closed = true; generation++; usable = false;
    signal?.removeEventListener('abort', destroy); lifetime.abort(); observer?.disconnect(); cancelPaint(); passwordCleanup?.();
    root.remove(); rejectInitial(abortError());
    cleanupPromise = Promise.resolve().then(() => opened?.destroy()).catch(() => {}).finally(() => library?.TextLayer.cleanup());
    return cleanupPromise;
  }
  if (signal?.aborted) { void destroy(); return { ready, destroy }; }
  signal?.addEventListener('abort', destroy, { once: true });
  (async () => {
    try {
      library = runtime.getLibrary();
      opened = runtime.open(bytes, { signal: lifetime.signal, onPassword: askPassword, onError: fail });
      if (closed) { await opened.destroy(); return; }
      documentProxy = await opened.promise;
      if (closed) return;
      pageCount.textContent = `/ ${documentProxy.numPages}`; pageInput.max = String(documentProxy.numPages);
      observer = new ResizeObserver(() => { if (!closed && usable && fit && scroll.clientWidth !== lastFitWidth) void paint(); }); observer.observe(scroll);
      await paint();
    } catch (error) { if (!closed) fail(error); }
  })();
  return { ready, destroy };
}
