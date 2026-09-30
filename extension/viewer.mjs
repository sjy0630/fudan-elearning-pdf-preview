import * as pdfjs from './vendor/pdf.mjs';
import { HostPermissionError, readPdf } from './reader.mjs';

const api = globalThis.browser || chrome;
pdfjs.GlobalWorkerOptions.workerSrc = api.runtime.getURL('vendor/pdf.worker.mjs');
const $ = (id) => document.getElementById(id);
const query = new URLSearchParams(location.search);
const isDemo = query.get('demo') === '1';
const source = query.get('source');
const original = query.get('original') || source;
const name = isDemo ? '演示文件.pdf' : FdPdf.filename(query.get('name'));
let documentTask, pdf, pageNumber = 1, scale = 1, fitWidth = true, renderTask, textTask, generation = 0, objectUrl, pendingScope;

$('title').textContent = name;
document.title = `${name} · eLearning PDF 预览`;
if (!isDemo && FdPdf.fileUrl(original)) { $('original').href = original; $('original').hidden = false; }
$('demo-note').hidden = !isDemo;

function showStatus(title, detail, retry = false) {
  $('status').hidden = false;
  $('status-title').textContent = title;
  $('status-detail').textContent = detail;
  $('retry').hidden = !retry;
}

function updateControls() {
  const ready = Boolean(pdf);
  for (const id of ['page', 'zoom-in', 'zoom-out', 'fit']) $(id).disabled = !ready;
  $('previous').disabled = !ready || pageNumber <= 1;
  $('next').disabled = !ready || pageNumber >= pdf.numPages;
  $('page').value = pageNumber;
  $('page').max = pdf?.numPages || 1;
  $('page-count').textContent = `/ ${pdf?.numPages || '—'}`;
}

async function renderPage() {
  if (!pdf) return;
  const token = ++generation;
  const previousTask = renderTask;
  previousTask?.cancel();
  textTask?.cancel();
  try { await previousTask?.promise; } catch { /* cancellation */ }
  const page = await pdf.getPage(pageNumber);
  if (token !== generation) return;
  const natural = page.getViewport({ scale: 1 });
  if (fitWidth) scale = Math.min(2, Math.max(.25, ($('workspace').clientWidth - 64) / natural.width));
  const viewport = page.getViewport({ scale });
  const pixelRatio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(16000000 / (viewport.width * viewport.height)));
  const canvas = $('canvas');
  canvas.width = Math.floor(viewport.width * pixelRatio);
  canvas.height = Math.floor(viewport.height * pixelRatio);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  canvas.setAttribute('aria-label', `${name}，第 ${pageNumber} 页，共 ${pdf.numPages} 页`);
  $('paper').style.width = `${viewport.width}px`;
  $('paper').style.height = `${viewport.height}px`;
  $('paper').style.setProperty('--scale-factor', scale);
  $('paper').style.setProperty('--total-scale-factor', scale);
  $('paper').hidden = false;
  $('text-layer').replaceChildren();
  $('zoom-label').textContent = `${Math.round(scale * 100)}%`;
  updateControls();
  renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] });
  try {
    await renderTask.promise;
    if (token !== generation) return;
    $('status').hidden = true;
    const text = await page.getTextContent();
    if (token !== generation) return;
    textTask = new pdfjs.TextLayer({ textContentSource: text, container: $('text-layer'), viewport });
    await textTask.render();
  } catch (error) {
    if (token === generation && error.name !== 'RenderingCancelledException' && error.name !== 'AbortException') throw error;
  }
}

function renderSafely() {
  renderPage().catch(() => showStatus('这一页暂时无法显示', '可以尝试翻页、重新打开文件，或下载后阅读。', true));
}

async function load() {
  $('grant').hidden = true;
  pendingScope = null;
  $('paper').hidden = true;
  $('download').hidden = true;
  pdf = null;
  generation++;
  renderTask?.cancel(); textTask?.cancel();
  updateControls();
  showStatus('正在读取 PDF…', isDemo ? '演示文件已随扩展安装，无需登录或联网。' : '文件只在你的浏览器中处理。');
  if (!isDemo && !FdPdf.fileUrl(source)) {
    showStatus('请从 eLearning 打开 PDF', '回到作业页面，点击 PDF 文件名即可预览。');
    return;
  }
  try {
    await documentTask?.destroy();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    let bytes;
    if (isDemo) {
      // Fixed bundled resource only. A query parameter cannot select another URL.
      const response = await fetch(api.runtime.getURL('demo.pdf'));
      if (!response.ok) throw new Error('内置演示文件缺失，请重新安装扩展后重试。');
      bytes = new Uint8Array(await response.arrayBuffer());
    } else bytes = await readPdf(source, { api });
    objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    $('download').href = objectUrl;
    $('download').download = name;
    $('download').hidden = false;
    showStatus('正在打开 PDF…', '正在准备页面。');
    documentTask = pdfjs.getDocument({
      data: bytes,
      cMapUrl: api.runtime.getURL('vendor/cmaps/'), cMapPacked: true,
      standardFontDataUrl: api.runtime.getURL('vendor/standard_fonts/'),
      wasmUrl: api.runtime.getURL('vendor/wasm/'), isEvalSupported: false,
    });
    documentTask.onPassword = (updatePassword) => {
      const password = window.prompt('此 PDF 已加密，请输入文件密码（不会保存）：');
      if (password === null) {
        documentTask.destroy();
        showStatus('已取消打开加密文件', '点击重试可重新输入密码。', true);
      } else updatePassword(password);
    };
    pdf = await documentTask.promise;
    pageNumber = 1;
    await renderPage();
  } catch (error) {
    if (error instanceof HostPermissionError) {
      pendingScope = error.scope;
      $('grant').hidden = false;
      showStatus('需要允许读取文件服务器', `${new URL(error.scope).hostname}\n学校将这个文件转到上述服务器。点击下方按钮，仅允许此服务器；也可以打开原文件。`);
    } else {
      showStatus('暂时无法预览', error instanceof TypeError ? (isDemo ? '内置演示文件无法读取，请重新安装扩展后重试。' : '无法连接文件服务器。请确认已登录 eLearning，并检查网络。') : error.message || '文件无法读取。', true);
    }
  }
}

$('grant').addEventListener('click', () => {
  if (!pendingScope) return;
  api.permissions.request({ origins: [pendingScope] }).then((granted) => {
    if (granted) load();
    else showStatus('尚未获得文件服务器权限', '可以再次点击授权，或使用右上角“打开原文件”。');
  }).catch(() => showStatus('权限申请未完成', '请重试，或使用右上角“打开原文件”。'));
});
$('retry').addEventListener('click', load);
function turnPage(number) {
  if (!pdf) return;
  pageNumber = Math.max(1, Math.min(pdf.numPages, Math.trunc(Number(number) || 1)));
  renderSafely();
  window.scrollTo(0, 0);
}
$('previous').addEventListener('click', () => turnPage(pageNumber - 1));
$('next').addEventListener('click', () => turnPage(pageNumber + 1));
$('page').addEventListener('change', () => turnPage($('page').value));
for (const [id, factor] of [['zoom-in', 1.2], ['zoom-out', 1 / 1.2]]) $(id).addEventListener('click', () => {
  fitWidth = false; scale = Math.min(4, Math.max(.25, scale * factor)); renderSafely();
});
$('fit').addEventListener('click', () => { fitWidth = true; renderSafely(); });
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (fitWidth) renderSafely(); }, 150); });
document.addEventListener('keydown', (event) => {
  if (event.target.matches('input, button, a') || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'ArrowLeft') turnPage(pageNumber - 1);
  if (event.key === 'ArrowRight') turnPage(pageNumber + 1);
});
window.addEventListener('pagehide', () => { if (objectUrl) URL.revokeObjectURL(objectUrl); });
load();
