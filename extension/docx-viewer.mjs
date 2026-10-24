import { readFile, HostPermissionError } from './reader.mjs';
import { runDocxTask, sanitizeDocxOutput, DOCX_MIME } from './vendor/docx-core.mjs';

const api = globalThis.browser || globalThis.chrome;
const $ = id => document.getElementById(id);
const query = new URLSearchParams(location.search);
// The demo has one fixed packaged input. No query value can choose a URL or file.
const demo = query.size === 1 && query.get('demo') === '1';
const source = query.get('source'), original = query.get('original');
const valid = demo || (!query.has('demo') && query.get('format') === 'docx' &&
  !!FdPdf.fileUrl(source) && !!FdPdf.fileUrl(original) &&
  CanvasFileFormats.identify(query.get('name'))?.id === 'docx');
const name = valid ? FdPdf.fileName(demo ? '演示文档.docx' : query.get('name'), 'docx') : 'DOCX 预览';
$('title').textContent = name;
document.title = `${name} · eLearning 文件预览`;
$('demo-note').hidden = !demo;
if (valid && !demo) { $('original').href = original; $('original').hidden = false; }

let generation = 0, controller = null, originalBytes = null, objectUrl = null, verified = false, pendingScope = null;

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
  controller?.abort();
  controller = null;
  originalBytes = null;
  verified = false;
  pendingScope = null;
  clearDownload();
  $('docx').hidden = true;
  $('docx').removeAttribute('srcdoc');
  $('warning-list').replaceChildren();
  $('warnings').hidden = true;
  $('grant').hidden = true;
  $('grant').disabled = false;
  $('retry').hidden = true;
  busy(false);
}

function makeWorker() {
  try {
    return { worker: new Worker(api.runtime.getURL('vendor/docx-worker.js')), dispose() {} };
  } catch {
    throw new Error('DOCX 本地转换进程无法启动，可能被浏览器安全策略拦截。请重试或打开原文件。');
  }
}

async function load() {
  cleanup();
  if (!valid) {
    status('暂时无法预览', '请从 eLearning 打开以 .docx 结尾的文件，或从帮助页打开内置演示。');
    return;
  }
  const token = generation;
  controller = new AbortController();
  const signal = controller.signal;
  const current = () => token === generation && !signal.aborted;
  busy(true);
  status('正在读取 DOCX…', demo ? '正在读取内置演示，无需联网。' : '文件只在你的浏览器中处理。');
  try {
    let transfer;
    if (demo) {
      const response = await fetch(api.runtime.getURL('demo.docx'), { signal });
      if (!response.ok) throw new Error('内置演示文件缺失，请重新安装后重试。');
      transfer = { bytes: new Uint8Array(await response.arrayBuffer()), mime: DOCX_MIME };
      // Like readFile, this is transfer screening only, never package approval.
      CanvasFileFormats.validate(transfer.bytes, 'docx', transfer.mime);
    } else transfer = await readFile(source, { api, format: 'docx', signal });
    if (!current()) return;
    originalBytes = transfer.bytes;
    const mime = transfer.mime;
    transfer = null;
    status('正在本地检查并转换 DOCX…', '检查完成后即可下载原文件。');
    const result = await runDocxTask(originalBytes, mime, {
      signal,
      makeWorker,
      onVerified() {
        if (!current()) return;
        verified = true;
        objectUrl = URL.createObjectURL(new Blob([originalBytes], { type: DOCX_MIME }));
        $('download').href = objectUrl;
        $('download').download = name;
        $('download').hidden = false;
      },
    });
    if (!current()) return;
    status('正在准备 DOCX 内容预览…', '原文件已通过检查，可以下载。');
    const output = await sanitizeDocxOutput(window, result, { signal, formats: CanvasFileFormats });
    if (!current()) return;
    $('warning-list').replaceChildren(...output.warnings.map(warning => {
      const item = document.createElement('li');
      item.textContent = warning;
      return item;
    }));
    $('warnings').hidden = output.warnings.length === 0;
    $('docx').srcdoc = output.srcdoc;
    $('docx').hidden = false;
    $('status').hidden = true;
    busy(false);
  } catch (error) {
    if (!current()) return;
    busy(false);
    // Keep the verified original available if conversion or sanitization fails.
    if (!verified) { originalBytes = null; clearDownload(); }
    if (!demo && error instanceof HostPermissionError) {
      pendingScope = error.scope;
      $('grant').hidden = false;
      status('需要允许读取文件服务器', `${new URL(error.scope).hostname}\n点击下方按钮，仅允许此服务器。也可以打开原文件。`);
    } else {
      const next = verified ? '\n可以下载已验证的原文件查看。' : demo ? '' : '\n也可以打开原文件查看。';
      status('暂时无法预览', (error?.message || '文件无法读取，请重试。') + next, true);
    }
  }
}

$('retry').addEventListener('click', load);
$('cancel').addEventListener('click', () => {
  cleanup();
  status('已取消 DOCX 预览', demo ? '点击重试可重新打开内置演示。' : '可以重试，或打开原文件查看。', true);
});
$('grant').addEventListener('click', () => {
  if (!pendingScope || demo) return;
  const token = generation;
  $('grant').disabled = true;
  api.permissions.request({ origins: [pendingScope] }).then(granted => {
    if (token !== generation) return;
    $('grant').disabled = false;
    if (granted) load();
    else status('尚未获得文件服务器权限', '可以再次授权，或打开原文件。');
  }).catch(() => {
    if (token !== generation) return;
    $('grant').disabled = false;
    status('权限申请未完成', '请重试授权，或打开原文件。');
  });
});
window.addEventListener('pagehide', cleanup);
load();
