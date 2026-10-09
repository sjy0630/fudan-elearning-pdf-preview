function createPdfPreference({ getValue, setValue } = {}) {
  const key = 'fudan-preview.pdf-reader';
  let current = 'native';
  let selected = false;
  let loadPromise;
  let writeQueue = Promise.resolve();

  function load() {
    if (!loadPromise) {
      loadPromise = (async () => {
        try {
          if (typeof getValue !== 'function') return { persisted: false };
          const stored = await getValue(key, 'native');
          // A user choice takes precedence even if the initial storage read is late.
          if (!selected) current = stored === 'pdfjs' ? 'pdfjs' : 'native';
          return { persisted: true };
        } catch {
          return { persisted: false };
        }
      })();
    }
    return loadPromise;
  }

  async function set(id) {
    if (id !== 'native' && id !== 'pdfjs') throw new RangeError('Unsupported PDF reader');
    selected = true;
    current = id;
    // Each storage operation settles before the next starts, including failures.
    writeQueue = writeQueue.then(async () => {
      try {
        if (typeof setValue !== 'function') return { persisted: false };
        await setValue(key, id);
        return { persisted: true };
      } catch {
        return { persisted: false };
      }
    });
    return writeQueue;
  }

  return { get: () => current, load, set };
}
