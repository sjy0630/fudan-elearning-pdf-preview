function createPdfjsDocumentResources(realDocument) {
  const ownedFonts = new Set(), ownedNodes = new Set();
  let disposed = false;
  const forward = (target, key) => {
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  };
  const nativeFonts = realDocument.fonts;
  const fonts = nativeFonts && new Proxy(nativeFonts, {
    get(target, key, receiver) {
      if (key === 'add') return font => {
        if (disposed) return receiver;
        const alreadyPresent = target.has(font);
        target.add(font);
        if (!alreadyPresent) ownedFonts.add(font);
        return receiver;
      };
      if (key === 'delete') return font => ownedFonts.delete(font) && target.delete(font);
      return forward(target, key);
    },
  });
  const ownerDocument = new Proxy(realDocument, {
    get(target, key) {
      if (key === 'fonts') return fonts;
      // PDF.js supports a <style> fallback. Keep it inside our node ownership
      // instead of adding a constructed sheet to the page's adopted sheets.
      if (key === 'adoptedStyleSheets') return undefined;
      if (key === 'createElement' || key === 'createElementNS') return (...args) => {
        if (disposed) throw new DOMException('PDF document disposed', 'AbortError');
        const node = Reflect.apply(Reflect.get(target, key, target), target, args);
        // Scratch canvases may otherwise be collectible before document close.
        ownedNodes.add(new WeakRef(node));
        return node;
      };
      return forward(target, key);
    },
    set: (target, key, value) => Reflect.set(target, key, value, target),
  });
  function destroy() {
    if (disposed) return;
    disposed = true;
    try {
      for (const font of ownedFonts) nativeFonts.delete(font);
    } finally {
      ownedFonts.clear();
      const liveNodes = new Set([...ownedNodes].map(reference => reference.deref()).filter(Boolean));
      // Preserve child links: a delayed PDF.js filter cleanup still traverses
      // defs -> svg -> div after its Terminate acknowledgement finally arrives.
      for (const node of liveNodes) if (!liveNodes.has(node.parentNode)) node.remove();
      ownedNodes.clear();
    }
  }
  return { ownerDocument, destroy };
}

function createPdfjsRuntime() {
  let assets, library;
  const getAssets = () => assets || (assets = createEmbeddedPdfjs());
  const getLibrary = () => library || (library = getAssets().getLibrary());

  function open(bytes, { signal, onPassword, onError } = {}) {
    const lifetime = new AbortController();
    const aborted = () => new DOMException('PDF loading cancelled', 'AbortError');
    let worker, pdfWorker, loadingTask, workerUrl, timer, cleanupPromise, documentResources;
    let closed = false, settled = false, resolveDocument, rejectDocument, resolveReady, rejectReady;
    const promise = new Promise((resolve, reject) => { resolveDocument = resolve; rejectDocument = reject; });
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    // A consumer can close immediately, before it has started awaiting the result.
    promise.catch(() => {});
    ready.catch(() => {});

    function stopTimer() { clearTimeout(timer); timer = undefined; }
    function startTimer() {
      stopTimer();
      timer = setTimeout(() => fail(new Error('PDF.js 初始化超时，请尝试浏览器原生预览。')), 15000);
    }
    function fail(error) {
      if (closed) return;
      if (!settled) { settled = true; rejectDocument(error); }
      void destroy().catch(() => {});
      if (error?.name !== 'AbortError' && typeof onError === 'function') {
        try { Promise.resolve(onError(error)).catch(() => {}); } catch { /* UI errors cannot interrupt cleanup. */ }
      }
    }
    const onAbort = () => fail(aborted());
    const onWorkerError = () => fail(new Error('PDF.js Worker 无法启动或已停止，请尝试浏览器原生预览。'));
    const onMessage = event => {
      const message = event.data;
      if (message?.sourceName === 'worker' && message.targetName === 'main' && message.action === 'ready') {
        worker.removeEventListener('message', onMessage);
        resolveReady();
      }
    };

    function destroy() {
      if (cleanupPromise) return cleanupPromise;
      let resolveCleanup, rejectCleanup;
      cleanupPromise = new Promise((resolve, reject) => { resolveCleanup = resolve; rejectCleanup = reject; });
      cleanupPromise.catch(() => {});
      closed = true;
      stopTimer();
      signal?.removeEventListener('abort', onAbort);
      lifetime.abort();
      rejectReady(aborted());
      if (!settled) { settled = true; rejectDocument(aborted()); }
      worker?.removeEventListener('message', onMessage);
      worker?.removeEventListener('error', onWorkerError);
      worker?.removeEventListener('messageerror', onWorkerError);
      (async () => {
        // A dead worker cannot acknowledge PDF.js's Terminate request. Bound
        // this wait, then release both the wrapper and the actual worker port.
        let deadline;
        try {
          if (loadingTask) await Promise.race([
            Promise.resolve().then(() => loadingTask.destroy()).catch(() => {}),
            new Promise(resolve => { deadline = setTimeout(resolve, 1000); }),
          ]);
        } finally {
          clearTimeout(deadline);
          try { pdfWorker?.destroy(); } finally {
            try { worker?.terminate(); } finally {
              try { documentResources?.destroy(); } finally {
                if (workerUrl) URL.revokeObjectURL(workerUrl);
              }
            }
          }
        }
      })().then(resolveCleanup, rejectCleanup);
      return cleanupPromise;
    }

    if (signal?.aborted) { fail(aborted()); return { promise, destroy }; }
    signal?.addEventListener('abort', onAbort, { once: true });
    startTimer();
    try {
      const embedded = getAssets();
      const pdfjs = getLibrary();
      workerUrl = URL.createObjectURL(new Blob([embedded.workerSource], { type: 'text/javascript' }));
      worker = new Worker(workerUrl, { type: 'module' });
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onWorkerError);
      worker.addEventListener('messageerror', onWorkerError);
      (async () => {
        // PDFWorker({port}) resolves immediately; wait for the real worker's
        // startup message first, so CSP rejection can never select fake-worker.
        await ready;
        if (closed) return;
        pdfWorker = new pdfjs.PDFWorker({ port: worker });
        documentResources = createPdfjsDocumentResources(globalThis.document);
        loadingTask = pdfjs.getDocument({
          data: bytes.slice(), worker: pdfWorker,
          ownerDocument: documentResources.ownerDocument,
          BinaryDataFactory: embedded.BinaryDataFactory,
          cMapPacked: true, useWorkerFetch: false, isEvalSupported: false,
          stopAtErrors: true,
        });
        loadingTask.onPassword = (updatePassword, reason) => {
          stopTimer();
          Promise.resolve().then(() => {
            if (closed) return null;
            return typeof onPassword === 'function' ? onPassword({ reason, signal: lifetime.signal }) : null;
          }).then(password => {
            if (closed) return;
            if (typeof password !== 'string') {
              const error = aborted();
              updatePassword(error);
              fail(error);
              return;
            }
            startTimer();
            updatePassword(password);
          }).catch(fail);
        };
        const document = await loadingTask.promise;
        if (closed) return;
        stopTimer();
        settled = true;
        resolveDocument(document);
      })().catch(fail);
    } catch (error) { fail(error); }
    return { promise, destroy };
  }
  return { getLibrary, open };
}
