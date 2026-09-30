const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, utimes, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');

test('portable ZIP has root-relative paths, exact bytes and deterministic metadata', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'canvas-archive-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'vendor'));
  await writeFile(path.join(dir, 'vendor', '中文.bin'), Buffer.from([0, 128, 255]));
  await writeFile(path.join(dir, 'manifest.json'), '{"manifest_version":3}\n');
  const { archiveDirectory } = await import('../scripts/archive.mjs');
  const { unzipSync } = await import('fflate');
  const first = await archiveDirectory(dir);
  await utimes(path.join(dir, 'manifest.json'), new Date(), new Date());
  assert.deepEqual(await archiveDirectory(dir), first);
  const entries = unzipSync(first);
  assert.deepEqual(Object.keys(entries), ['manifest.json', 'vendor/中文.bin']);
  assert.equal(Buffer.from(entries['manifest.json']).toString(), '{"manifest_version":3}\n');
  assert.deepEqual(entries['vendor/中文.bin'], new Uint8Array([0, 128, 255]));
});
