import { readFile, HostPermissionError } from './reader.mjs';
const api = globalThis.browser || globalThis.chrome;
const $ = id => document.getElementById(id);
const query = new URLSearchParams(location.search);
const demos = { image: { file: 'demo.png', format: 'png', name: '演示图像.png' }, text: { file: 'demo.txt', format: 'text', name: '演示文本.txt' } };
const demo = Object.hasOwn(demos, query.get('demo')) ? demos[query.get('demo')] : null;
const source = query.get('source'), original = query.get('original') || source;
const format = demo?.format || query.get('format');
const descriptor = CanvasFileFormats.get(format);
const valid = !!descriptor && format !== 'pdf' && (!!demo || (!query.has('demo') && FdPdf.fileUrl(source) && FdPdf.fileUrl(original) && CanvasFileFormats.identify(query.get('name'))?.id === format));
const name = valid ? FdPdf.fileName(demo?.name || query.get('name'), format) : '文件预览';
$('title').textContent = name; document.title = `${name} · eLearning 文件预览`;
if (!demo && FdPdf.fileUrl(original)) { $('original').href = original; $('original').hidden = false; }
$('demo-note').hidden = !demo;
$('text-controls').hidden = format !== 'text'; $('image-controls').hidden = !descriptor || format === 'text' || format === 'pdf';
let generation = 0, controller, objectUrl, bytes, image, dimensions, pendingScope, scale = 1, rotation = 0, fitting = true, textReady = false;
function status(title, detail, retry = false) {
  $('status').hidden = false; $('status-title').textContent = title; $('status-detail').textContent = detail; $('retry').hidden = !retry;
}
function controls() {
  for (const id of ['zoom-in','zoom-out','rotate','fit']) $(id).disabled = !image;
  $('encoding').disabled = !bytes || format !== 'text';
  $('copy').disabled = $('wrap').disabled = !textReady;
}
function clearDownload() {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null; $('download').hidden = true; $('download').removeAttribute('href');
}
function prepareDownload() {
  if (!objectUrl) objectUrl = URL.createObjectURL(new Blob([bytes], { type: descriptor.mime }));
  $('download').href = objectUrl; $('download').download = name; $('download').hidden = false;
}
function cleanup() {
  generation++; controller?.abort(); clearDownload();
  image = null; bytes = null; textReady = false; pendingScope = null;
  $('image-frame').replaceChildren(); $('image-frame').hidden = true;
  $('text').textContent = ''; $('text').hidden = true; $('copy-status').textContent = '';
  $('grant').hidden = true;
  controls();
}
function layout() {
  if (!image) return;
  const odd = rotation % 180 !== 0;
  const width = odd ? dimensions.height : dimensions.width, height = odd ? dimensions.width : dimensions.height;
  if (fitting) scale = Math.min(1, Math.max(1, $('workspace').clientWidth - 48) / width, Math.max(1, $('workspace').clientHeight - 48) / height);
  $('image-frame').style.width = `${width * scale}px`; $('image-frame').style.height = `${height * scale}px`;
  image.style.width = `${dimensions.width * scale}px`; image.style.height = `${dimensions.height * scale}px`;
  image.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`; image.dataset.rotation = String(rotation);
  $('zoom-label').textContent = `${Math.round(scale * 100)}%`;
}
function renderText() {
  clearDownload();
  textReady = false; $('text').hidden = true; $('text').textContent = ''; $('copy-status').textContent = '';
  try { $('text').textContent = CanvasFileFormats.decodeText(bytes, $('encoding').value); prepareDownload(); textReady = true; $('text').hidden = false; $('status').hidden = true; }
  catch (error) { status('暂时无法预览', error.message, true); }
  controls();
}
async function load() {
  cleanup(); const token = generation; controller = new AbortController(); const signal = controller.signal;
  status('正在读取文件…', demo ? '内置演示无需联网。' : '文件只在你的浏览器中处理。');
  if (!valid) { status('暂时无法预览', '请从 eLearning 打开支持的图像或文本文件。'); return; }
  try {
    let result;
    if (demo) {
      const response = await fetch(api.runtime.getURL(demo.file), { signal });
      if (!response.ok) throw Error('内置演示文件缺失，请重新安装后重试。');
      result = { bytes: new Uint8Array(await response.arrayBuffer()), mime: descriptor.mime };
    } else result = await readFile(source, { api, format, signal });
    if (token !== generation) return;
    dimensions = CanvasFileFormats.validate(result.bytes, format, result.mime); bytes = result.bytes;
    if (format === 'text') { renderText(); return; }
    prepareDownload();
    const candidate = new Image(); candidate.id = 'image'; candidate.alt = name; candidate.src = objectUrl;
    try { await candidate.decode(); } catch { throw Error('图像内容损坏，浏览器无法解码。可以打开原文件检查。'); }
    if (token !== generation) return;
    // EXIF orientation can swap width and height; use the decoder's bounded dimensions.
    const width = candidate.naturalWidth, height = candidate.naturalHeight;
    if (!width || !height || width > 16384 || height > 16384 || width * height > 40000000 || !((width === dimensions.width && height === dimensions.height) || (width === dimensions.height && height === dimensions.width))) throw Error('图像解码尺寸与文件头不符。');
    dimensions = { width, height }; image = candidate; rotation = 0; fitting = true;
    $('image-frame').replaceChildren(image); $('image-frame').hidden = false; layout(); controls(); $('status').hidden = true;
  } catch (error) {
    if (token !== generation || signal.aborted) return;
    if (format !== 'text') { clearDownload(); bytes = null; image = null; }
    if (error instanceof HostPermissionError) { pendingScope = error.scope; $('grant').hidden = false; status('需要允许读取文件服务器', `${new URL(error.scope).hostname}\n点击下方按钮，仅允许此服务器。也可以打开原文件。`); }
    else status('暂时无法预览', error.message || '文件无法读取，请登录 eLearning 后重试。', true);
    controls();
  }
}
$('retry').addEventListener('click', load);
$('grant').addEventListener('click', () => {
  if (!pendingScope) return;
  const token = generation;
  api.permissions.request({ origins: [pendingScope] }).then(granted => {
    if (token !== generation) return;
    if (granted) load(); else status('尚未获得文件服务器权限', '可以再次授权，或打开原文件。');
  }).catch(() => { if (token === generation) status('权限申请未完成', '请重试，或打开原文件。'); });
});
for (const [id, factor] of [['zoom-in',1.2],['zoom-out',1/1.2]]) $(id).addEventListener('click', () => { fitting = false; scale = Math.min(8,Math.max(.01, scale * factor)); layout(); });
$('rotate').addEventListener('click', () => { rotation = (rotation + 90) % 360; layout(); });
$('fit').addEventListener('click', () => { fitting = true; layout(); });
$('encoding').addEventListener('change', () => { if (bytes) renderText(); });
$('wrap').addEventListener('click', () => { const wrap = $('wrap').getAttribute('aria-pressed') !== 'true'; $('wrap').setAttribute('aria-pressed',String(wrap)); $('text').classList.toggle('no-wrap', !wrap); });
$('copy').addEventListener('click', async () => {
  const token = generation;
  try { await navigator.clipboard.writeText($('text').textContent); if (token === generation) $('copy-status').textContent = '已复制全文。'; }
  catch { if (token !== generation) return; $('copy-status').textContent = '复制未完成，请手动选择文字后复制。'; $('text').focus(); }
});
window.addEventListener('resize', () => { if (fitting) layout(); });
window.addEventListener('pagehide', cleanup);
load();
