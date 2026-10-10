const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '../userscript/pdf-preference.js');
const key = 'fudan-preview.pdf-reader';

function createPreference(storage = {}) {
  const source = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, 'utf8') : '';
  const context = {};
  const factory = vm.runInNewContext(
    `(function () { 'use strict';\n${source}\nreturn typeof createPdfPreference === 'function' ? createPdfPreference : undefined; })()`,
    context,
    { filename: sourcePath },
  );
  assert.equal(typeof factory, 'function', 'the private preference factory exists');
  assert.deepEqual(Object.keys(context), [], 'the module creates no page-global exports');
  return factory(storage);
}

function assertResult(result, persisted) {
  assert.deepEqual({ ...result }, { persisted });
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const nextTurn = () => new Promise(setImmediate);

test('defaults to native without reading or writing storage until requested', async () => {
  const calls = [];
  const preference = createPreference({
    getValue(...args) { calls.push(['read', ...args]); return args[1]; },
    setValue(...args) { calls.push(['write', ...args]); },
  });
  assert.equal(preference.get(), 'native');
  assert.deepEqual(calls, []);
  assertResult(await preference.load(), true);
  assert.equal(preference.get(), 'native');
  const saving = preference.set('pdfjs');
  assert.equal(preference.get(), 'pdfjs', 'selection changes before storage settles');
  assertResult(await saving, true);
  assert.deepEqual(calls, [['read', key, 'native'], ['write', key, 'pdfjs']]);
});

for (const id of ['native', 'pdfjs']) {
  for (const asynchronous of [false, true]) {
    test(`loads a stored ${id} choice from ${asynchronous ? 'asynchronous' : 'synchronous'} storage`, async () => {
      const preference = createPreference({
        getValue(storageKey, fallback) {
          assert.equal(storageKey, key);
          assert.equal(fallback, 'native');
          return asynchronous ? Promise.resolve(id) : id;
        },
      });
      assert.equal(preference.get(), 'native');
      assertResult(await preference.load(), true);
      assert.equal(preference.get(), id);
    });
  }
}

test('normalizes unknown stored values to native without rewriting storage', async () => {
  for (const value of [undefined, null, '', 'PDFJS', 'toString', '__proto__', 1, {}, ['pdfjs']]) {
    let writes = 0;
    const preference = createPreference({ getValue: () => value, setValue: () => { writes++; } });
    assertResult(await preference.load(), true);
    assert.equal(preference.get(), 'native');
    assert.equal(writes, 0);
  }
});

test('caches the first load across concurrent and later calls', async () => {
  let reads = 0;
  let finishRead;
  const preference = createPreference({
    getValue: () => { reads++; return new Promise(resolve => { finishRead = resolve; }); },
  });
  const first = preference.load();
  const second = preference.load();
  assert.equal(reads, 1);
  finishRead('pdfjs');
  assertResult(await first, true);
  assertResult(await second, true);
  assertResult(await preference.load(), true);
  assert.equal(preference.get(), 'pdfjs');
  assert.equal(reads, 1);
});

for (const [kind, getValue] of [
  ['missing', undefined],
  ['throwing', () => { throw new Error('read denied'); }],
  ['rejecting', () => Promise.reject(new Error('read denied'))],
]) {
  test(`${kind} reads resolve a cached failure and retain the native default`, async () => {
    let reads = 0;
    const preference = createPreference({
      getValue: getValue && ((...args) => { reads++; return getValue(...args); }),
    });
    assertResult(await preference.load(), false);
    assertResult(await preference.load(), false);
    assert.equal(preference.get(), 'native');
    assert.equal(reads, getValue ? 1 : 0);
  });
}

for (const [kind, setValue] of [
  ['missing', undefined],
  ['throwing', () => { throw new Error('write denied'); }],
  ['rejecting', () => Promise.reject(new Error('write denied'))],
]) {
  test(`${kind} writes resolve a failure and retain the current page selection`, async () => {
    const preference = createPreference({ setValue });
    const saving = preference.set('pdfjs');
    assert.equal(preference.get(), 'pdfjs');
    assertResult(await saving, false);
    assert.equal(preference.get(), 'pdfjs');
    assertResult(await preference.set('native'), false);
    assert.equal(preference.get(), 'native');
  });
}

test('unsupported choices reject without changing memory or writing any value', async () => {
  const writes = [];
  const preference = createPreference({ setValue: (...args) => { writes.push(args); } });
  await preference.set('pdfjs');
  for (const id of [undefined, null, '', 'PDFJS', 'toString', '__proto__', 1, {}, ['pdfjs']]) {
    await assert.rejects(preference.set(id), { name: 'RangeError' });
    assert.equal(preference.get(), 'pdfjs');
  }
  assert.deepEqual(writes, [[key, 'pdfjs']]);
});

test('a fresh instance reads the prior instance choice from synchronous storage', async () => {
  const values = new Map();
  const storage = {
    getValue: (storageKey, fallback) => values.has(storageKey) ? values.get(storageKey) : fallback,
    setValue: (storageKey, value) => { values.set(storageKey, value); },
  };
  const first = createPreference(storage);
  assertResult(await first.set('pdfjs'), true);
  const second = createPreference(storage);
  assert.equal(second.get(), 'native');
  assertResult(await second.load(), true);
  assert.equal(second.get(), 'pdfjs');
  assert.deepEqual([...values], [[key, 'pdfjs']]);
});

for (const id of ['native', 'pdfjs']) {
  test(`a delayed initial load never replaces a newer ${id} selection`, async () => {
    const read = deferred();
    const preference = createPreference({ getValue: () => read.promise, setValue: () => {} });
    const loading = preference.load();
    assertResult(await preference.set(id), true);
    read.resolve(id === 'native' ? 'pdfjs' : 'native');
    assertResult(await loading, true);
    assert.equal(preference.get(), id);
  });

  test(`loading after a ${id} selection never replaces it with older storage`, async () => {
    const write = deferred();
    let stored = id === 'native' ? 'pdfjs' : 'native';
    const preference = createPreference({
      getValue: () => stored,
      setValue: async (storageKey, value) => { await write.promise; stored = value; },
    });
    const saving = preference.set(id);
    assert.equal(preference.get(), id);
    assertResult(await preference.load(), true);
    assert.equal(preference.get(), id);
    write.resolve();
    assertResult(await saving, true);
    assert.equal(stored, id);
  });
}

test('a choice remains current after its write fails and a later load sees older storage', async () => {
  const preference = createPreference({
    getValue: () => 'native',
    setValue: () => { throw new Error('write denied'); },
  });
  assertResult(await preference.set('pdfjs'), false);
  assertResult(await preference.load(), true);
  assert.equal(preference.get(), 'pdfjs');
});

test('rapid selections serialize delayed writes and finish with the last choice persisted', async () => {
  const writes = [];
  let stored = 'native';
  const preference = createPreference({
    setValue(storageKey, value) {
      const completion = deferred();
      writes.push({ storageKey, value, completion });
      return completion.promise.then(() => { stored = value; });
    },
  });
  const selections = ['pdfjs', 'native', 'pdfjs', 'native'];
  const saves = selections.map(id => preference.set(id));
  assert.equal(preference.get(), 'native');
  for (let index = 0; index < selections.length; index++) {
    await nextTurn();
    assert.equal(writes.length, index + 1, 'only one write may be in flight');
    assert.equal(writes[index].storageKey, key);
    assert.equal(writes[index].value, selections[index]);
    writes[index].completion.resolve();
    assertResult(await saves[index], true);
    assert.equal(preference.get(), 'native', 'settling an older save never rolls back memory');
  }
  await Promise.all(saves);
  assert.equal(stored, 'native');
  assert.equal(preference.get(), 'native');
});

test('a rejected write does not prevent a queued newer selection from persisting', async () => {
  const firstWrite = deferred();
  let attempts = 0;
  let stored = 'native';
  const preference = createPreference({
    setValue(storageKey, value) {
      assert.equal(storageKey, key);
      if (++attempts === 1) return firstWrite.promise;
      stored = value;
    },
  });
  const failed = preference.set('pdfjs');
  const recovered = preference.set('native');
  await nextTurn();
  assert.equal(attempts, 1);
  firstWrite.reject(new Error('write denied'));
  assertResult(await failed, false);
  assertResult(await recovered, true);
  assert.equal(attempts, 2);
  assert.equal(stored, 'native');
  assert.equal(preference.get(), 'native');
  assertResult(await preference.set('pdfjs'), true);
  assert.equal(stored, 'pdfjs');
});

test('a read failure does not mark a later successful write as failed', async () => {
  let stored;
  const preference = createPreference({
    getValue: () => Promise.reject(new Error('read denied')),
    setValue: (storageKey, value) => { stored = value; },
  });
  assertResult(await preference.load(), false);
  assertResult(await preference.set('pdfjs'), true);
  assert.equal(preference.get(), 'pdfjs');
  assert.equal(stored, 'pdfjs');
});

test('invalid selections do not suppress an in-flight initial load', async () => {
  const read = deferred();
  const preference = createPreference({ getValue: () => read.promise });
  const loading = preference.load();
  await assert.rejects(preference.set('unknown'), { name: 'RangeError' });
  read.resolve('pdfjs');
  assertResult(await loading, true);
  assert.equal(preference.get(), 'pdfjs');
});

test('storage rejections are handled even when callers do not await an operation', async () => {
  const preference = createPreference({
    getValue: () => Promise.reject(new Error('read denied')),
    setValue: () => Promise.reject(new Error('write denied')),
  });
  preference.load();
  preference.set('pdfjs');
  await nextTurn();
  assert.equal(preference.get(), 'pdfjs');
});
