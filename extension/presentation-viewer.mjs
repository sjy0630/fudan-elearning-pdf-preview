import { readFile, HostPermissionError } from './reader.mjs';
import { createPresentationReader } from './vendor/presentation-core.mjs';

const api = globalThis.browser || globalThis.chrome;
const $ = id => document.getElementById(id);
const query = new URLSearchParams(location.search);
const formats = ['ppt', 'pptx'];
// Demos always refer to fixed local resources, never a caller-supplied URL.
const demo = query.size === 1 && formats.includes(query.get('demo'));
const format = demo ? query.get('demo') : query.get('format');
const source = query.get('source'), original = query.get('original');
const valid = demo || (!query.has('demo') && formats.includes(format) &&
  !!FdPdf.fileUrl(source) && !!FdPdf.fileUrl(original) &&
  CanvasFileFormats.identify(query.get('name'))?.id === format);
const name = valid ? FdPdf.fileName(demo ? `演示文稿.${format}` : query.get('name'), format) : '幻灯片预览';
$('title').textContent = name;
document.title = `${name} · eLearning 文件预览`;
$('demo-note').hidden = !demo;
if (valid && !demo) { $('original').href = original; $('original').hidden = false; }

let generation = 0, controller = null, reader = null, bytes = null, objectUrl = null, verified = false, pendingScope = null;
function status(title, detail, retry = false) {
  $('status').hidden = false;
  $('status-title').textContent = title;
  $('status-detail').textContent = detail;
  $('retry').hidden = !retry;
}
function busy(value) {
  $('cancel').hidden = !value;
  $('workspace').setAttribute('aria-busy', String(value));
}
function clearDownload() {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  $('download').hidden = true;
  $('download').removeAttribute('href');
  $('download').removeAttribute('download');
}
function cleanup() {
  generation++;
  controller?.abort(); controller = null;
  reader?.dispose(); reader = null;
  bytes = null; verified = false; pendingScope = null;
  clearDownload();
  $('presentation').replaceChildren(); $('presentation').hidden = true;
  $('grant').hidden = true; $('grant').disabled = false; $('retry').hidden = true;
  busy(false);
}
function makeWorker() {
  return { worker: new Worker(api.runtime.getURL('vendor/presentation-worker.js')), dispose() {} };
}
async function load() {
  cleanup();
  if (!valid) { status('暂时无法预览', '请从 eLearning 打开 .ppt 或 .pptx 文件，或从帮助页打开内置演示。'); return; }
  const token = generation;
  controller = new AbortController();
  const signal = controller.signal, current = () => token === generation && !signal.aborted;
  busy(true);
  status('正在读取演示文稿…', demo ? '正在读取内置演示，无需联网。' : '文件只在你的浏览器中处理。');
  try {
    let transfer;
    if (demo) {
      const response = await fetch(api.runtime.getURL(`demo.${format}`), { signal });
      if (!response.ok) throw new Error('内置演示文件缺失，请重新安装后重试。');
      transfer = { bytes: new Uint8Array(await response.arrayBuffer()), mime: CanvasFileFormats.get(format).mime };
      CanvasFileFormats.validate(transfer.bytes, format, transfer.mime);
    } else transfer = await readFile(source, { api, format, signal });
    if (!current()) return;
    bytes = transfer.bytes;
    const mime = transfer.mime; transfer = null;
    status('正在本地解析幻灯片…', '较大的演示文稿可能需要一些时间，可以取消。');
    $('presentation').hidden = false;
    const activeReader = await createPresentationReader({
      host: $('presentation'), bytes, format, mime, signal, makeWorker,
      onVerified() {
        if (!current()) return;
        verified = true;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: CanvasFileFormats.get(format).mime }));
        $('download').href = objectUrl; $('download').download = name; $('download').hidden = false;
      },
    });
    if (!current()) { activeReader.dispose(); return; }
    reader = activeReader;
    $('status').hidden = true;
    busy(false);
    // Cancellation remains available while later pages are being rendered.
    $('cancel').hidden = false;
  } catch (error) {
    if (!current()) return;
    busy(false); $('presentation').hidden = true;
    if (!verified) { bytes = null; clearDownload(); }
    if (!demo && error instanceof HostPermissionError) {
      pendingScope = error.scope; $('grant').hidden = false;
      status('需要允许读取文件服务器', `${new URL(error.scope).hostname}\n仅允许此服务器即可读取。也可以打开原文件。`);
    } else status('暂时无法预览', (error?.message || '文件无法读取，请重试。') + (verified ? '\n可以下载已验证的原文件查看。' : demo ? '' : '\n也可以打开原文件查看。'), true);
  }
}
$('retry').addEventListener('click', load);
$('cancel').addEventListener('click', () => { cleanup(); status('已取消幻灯片预览', '点击重试可重新打开。', true); });
$('grant').addEventListener('click', () => {
  if (!pendingScope || demo) return;
  const token = generation; $('grant').disabled = true;
  api.permissions.request({ origins: [pendingScope] }).then(granted => {
    if (token !== generation) return;
    $('grant').disabled = false;
    if (granted) load(); else status('尚未获得文件服务器权限', '可以再次授权，或打开原文件。');
  }).catch(() => {
    if (token !== generation) return;
    $('grant').disabled = false; status('权限申请未完成', '请重试授权，或打开原文件。');
  });
});
window.addEventListener('pagehide', cleanup);
load();
