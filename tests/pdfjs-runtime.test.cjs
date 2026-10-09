const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

// Doubles cover only the browser Worker/timer and PDF.js library boundaries.
function setup({ workerThrows = false, destroyHangs = false } = {}) {
  assert.ok(fs.existsSync(path.join(__dirname, '../userscript/pdfjs-runtime.js')), 'createPdfjsRuntime API exists');
  const state = { workers: [], urls: [], revoked: [], tasks: [], pdfWorkers: [], timers: new Map(), libraryLoads: 0 };
  let timerId = 0;
  class WorkerDouble extends EventTarget {
    constructor(url, options) { super(); if (workerThrows) throw new Error('CSP blocked worker'); this.url = url; this.options = options; this.terminated = 0; state.workers.push(this); }
    terminate() { this.terminated++; }
    ready() { this.dispatchEvent(new MessageEvent('message', { data: { sourceName: 'worker', targetName: 'main', action: 'ready' } })); }
  }
  class PDFWorkerDouble {
    constructor({ port }) { this.port = port; this.destroyed = 0; this.promise = Promise.resolve(); state.pdfWorkers.push(this); }
    destroy() { this.destroyed++; }
  }
  const library = {
    PDFWorker: PDFWorkerDouble,
    getDocument(options) {
      const result = deferred();
      const task = { ...result, options, destroyed: 0, destroy() { this.destroyed++; return destroyHangs ? new Promise(() => {}) : Promise.resolve(); } };
      state.tasks.push(task);
      return task;
    },
  };
  const sandbox = {
    Uint8Array, Blob, DOMException, AbortController, Worker: WorkerDouble,
    URL: { createObjectURL(blob) { state.urls.push(blob); return `blob:private-${state.urls.length}`; }, revokeObjectURL(url) { state.revoked.push(url); } },
    setTimeout(callback, delay) { const id = ++timerId; state.timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { state.timers.delete(id); },
    createEmbeddedPdfjs() { return { workerSource: 'embedded worker', BinaryDataFactory: class {}, getLibrary() { state.libraryLoads++; return library; } }; },
  };
  const runtime = vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '../userscript/pdfjs-runtime.js'), 'utf8')}\ncreatePdfjsRuntime()`, sandbox);
  state.fireTimers = async () => { const timers = [...state.timers.entries()]; for (const [id, timer] of timers) { state.timers.delete(id); timer.callback(); } await tick(); };
  return { state, runtime };
}

test('runtime lazily opens each document in its own embedded module worker and preserves input bytes', async () => {
  const { state, runtime } = setup();
  assert.equal(state.libraryLoads, 0);
  const bytes = new Uint8Array([37, 80, 68, 70]);
  const first = runtime.open(bytes);
  assert.equal(state.workers.length, 1);
  assert.equal(state.tasks.length, 0, 'wait for actual worker readiness');
  assert.equal(state.workers[0].options.type, 'module');
  assert.equal(await state.urls[0].text(), 'embedded worker');
  state.workers[0].ready(); await tick();
  const task = state.tasks[0];
  assert.notEqual(task.options.data, bytes);
  assert.deepEqual(task.options.data, bytes);
  task.options.data[0] = 0;
  assert.equal(bytes[0], 37);
  assert.equal(task.options.worker.port, state.workers[0]);
  assert.equal(task.options.isEvalSupported, false);
  assert.equal(task.options.useWorkerFetch, false);
  assert.equal(task.options.stopAtErrors, true, 'decoding failures must reach the reader fallback');
  assert.equal(typeof task.options.BinaryDataFactory, 'function');
  const document = { numPages: 2 };
  task.resolve(document);
  assert.equal(await first.promise, document);
  assert.equal(state.timers.size, 0);
  const second = runtime.open(bytes); second.promise.catch(() => {});
  assert.equal(state.workers.length, 2);
  assert.equal(state.libraryLoads, 1, 'library initialized once');
  await Promise.all([first.destroy(), first.destroy(), second.destroy()]);
  assert.equal(task.destroyed, 1);
  assert.equal(state.pdfWorkers[0].destroyed, 1);
  assert.deepEqual(state.workers.map(worker => worker.terminated), [1, 1]);
  assert.deepEqual(state.revoked.sort(), ['blob:private-1', 'blob:private-2']);
  assert.equal(state.timers.size, 0);
});

test('abort and manual close reject pending open and detach all resources', async () => {
  for (const before of [true, false]) {
    const { state, runtime } = setup();
    const controller = new AbortController();
    if (before) controller.abort();
    const opened = runtime.open(new Uint8Array([1]), { signal: controller.signal });
    const rejected = assert.rejects(opened.promise, { name: 'AbortError' });
    if (!before) controller.abort();
    await rejected; await opened.destroy();
    assert.equal(state.workers.length, before ? 0 : 1);
    assert.equal(state.revoked.length, before ? 0 : 1);
    assert.equal(state.timers.size, 0);
  }
  const { runtime } = setup();
  const opened = runtime.open(new Uint8Array([1]));
  const rejected = assert.rejects(opened.promise, { name: 'AbortError' });
  await opened.destroy(); await rejected;
});

test('initialization timeout, CSP rejection, worker errors and invalid PDFs clean up without fallback', async () => {
  for (const failure of ['timeout', 'CSP', 'error', 'messageerror', 'invalid']) {
    const { state, runtime } = setup({ workerThrows: failure === 'CSP' });
    const opened = runtime.open(new Uint8Array([1]));
    const rejected = assert.rejects(opened.promise, /超时|CSP|Worker|invalid PDF/);
    if (failure === 'timeout') await state.fireTimers();
    if (failure === 'error' || failure === 'messageerror') state.workers[0].dispatchEvent(new Event(failure));
    if (failure === 'invalid') { state.workers[0].ready(); await tick(); state.tasks[0].reject(new Error('invalid PDF')); }
    await rejected; await opened.destroy();
    assert.equal(state.revoked.length, 1);
    assert.equal(state.workers[0]?.terminated ?? 1, 1);
    assert.equal(state.timers.size, 0);
    assert.equal(state.tasks.length, failure === 'invalid' ? 1 : 0);
  }
});

test('cleanup remains bounded when PDF.js destruction never settles', async () => {
  const { state, runtime } = setup({ destroyHangs: true });
  const opened = runtime.open(new Uint8Array([1])); opened.promise.catch(() => {});
  state.workers[0].ready(); await tick();
  const destroyed = opened.destroy();
  await tick(); await state.fireTimers(); await destroyed;
  assert.equal(state.workers[0].terminated, 1);
  assert.equal(state.revoked.length, 1);
});

test('password waits suspend timeout, retry restarts it, and cancel aborts loading', async () => {
  const { state, runtime } = setup();
  const password = deferred();
  let request, submitted;
  const opened = runtime.open(new Uint8Array([1]), { onPassword: value => { request = value; return password.promise; } });
  const rejected = assert.rejects(opened.promise, { name: 'AbortError' });
  state.workers[0].ready(); await tick();
  state.tasks[0].onPassword(value => { submitted = value; }, 1); await tick();
  assert.equal(request.reason, 1);
  assert.equal(request.signal.aborted, false);
  assert.equal(state.timers.size, 0);
  await state.fireTimers();
  assert.equal(state.workers[0].terminated, 0);
  password.resolve('secret'); await tick();
  assert.equal(submitted, 'secret');
  assert.equal(state.timers.size, 1);
  // The next request may be a wrong-password retry and can be cancelled.
  const second = setup();
  const cancelled = second.runtime.open(new Uint8Array([1]), { onPassword: async () => null });
  const cancelRejected = assert.rejects(cancelled.promise, { name: 'AbortError' });
  second.state.workers[0].ready(); await tick(); second.state.tasks[0].onPassword(value => assert.equal(value.name, 'AbortError'), 2);
  await cancelRejected; await cancelled.destroy();
  await opened.destroy(); await rejected;
  assert.equal(request.signal.aborted, true);
});

test('a late password result after close cannot revive the worker', async () => {
  const { state, runtime } = setup();
  const password = deferred(); let submitted = false;
  const opened = runtime.open(new Uint8Array([1]), { onPassword: () => password.promise }); opened.promise.catch(() => {});
  state.workers[0].ready(); await tick(); state.tasks[0].onPassword(() => { submitted = true; }, 1);
  await opened.destroy(); password.resolve('late'); await tick();
  assert.equal(submitted, false);
  assert.equal(state.timers.size, 0);
});

test('destroy is idempotent even when a password UI abort listener calls it again', async () => {
  const { state, runtime } = setup();
  let nested;
  const opened = runtime.open(new Uint8Array([1]), { onPassword: ({ signal }) => {
    signal.addEventListener('abort', () => { nested = opened.destroy(); });
    return new Promise(() => {});
  } });
  opened.promise.catch(() => {});
  state.workers[0].ready(); await tick(); state.tasks[0].onPassword(() => {}, 1); await tick();
  const destroyed = opened.destroy();
  await Promise.all([destroyed, nested]);
  assert.equal(state.tasks[0].destroyed, 1);
  assert.equal(state.workers[0].terminated, 1);
  assert.equal(state.revoked.length, 1);
});

test('worker failure after document readiness notifies once and contains callback exceptions', async () => {
  const { state, runtime } = setup();
  const errors = [];
  const opened = runtime.open(new Uint8Array([1]), { onError(error) { errors.push(error); throw new Error('UI callback failed'); } });
  state.workers[0].ready(); await tick(); state.tasks[0].resolve({ numPages: 2 }); await opened.promise;
  state.workers[0].dispatchEvent(new Event('error'));
  state.workers[0].dispatchEvent(new Event('messageerror'));
  await opened.destroy();
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Worker/);
  assert.equal(state.tasks[0].destroyed, 1);
  assert.equal(state.workers[0].terminated, 1);
});

test('normal close and caller abort do not report fatal worker errors', async () => {
  for (const abort of [false, true]) {
    const { runtime } = setup();
    const controller = new AbortController();
    const errors = [];
    const opened = runtime.open(new Uint8Array([1]), { signal: controller.signal, onError: error => errors.push(error) });
    opened.promise.catch(() => {});
    if (abort) controller.abort();
    await opened.destroy();
    assert.deepEqual(errors, []);
  }
});
