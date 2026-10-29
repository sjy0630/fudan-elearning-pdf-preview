import { createPresentationSession } from './presentation-runtime.mjs';
import { sanitizePresentationSlide } from './presentation-sanitize.mjs';
import { presentationAbortError, PRESENTATION_LIMITS } from './presentation-policy.mjs';

export async function createPresentationReader({ host, bytes, format, mime = '', signal, makeWorker, onVerified, formats }) {
  if (!host?.ownerDocument) throw new Error('幻灯片预览容器不可用。');
  const document = host.ownerDocument, window = document.defaultView, controller = new AbortController();
  let session, disposed = false, page = 0, busy = false, generation = 0, zoom = 1, fitting = true, resizeObserver;
  const root = document.createElement('section'); root.className = 'presentation-reader';
  root.style.cssText = 'display:flex;flex-direction:column;min-height:0;height:100%;background:#e8ebef;color:#202124';
  const controls = document.createElement('div'); controls.setAttribute('aria-label', '幻灯片控制');
  controls.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px;background:#fff;border-bottom:1px solid #ccd0d5';
  const button = (text, action) => { const element = document.createElement('button'); element.type = 'button'; element.textContent = text; element.addEventListener('click', action); controls.append(element); return element; };
  const prev = button('上一页', () => show(page - 1)), next = button('下一页', () => show(page + 1));
  const input = document.createElement('input'); input.type = 'number'; input.min = '1'; input.step = '1'; input.value = '1'; input.style.width = '72px'; input.setAttribute('aria-label', '跳转到幻灯片页码'); controls.append(input);
  const count = document.createElement('span'); count.textContent = '/ — 页'; controls.append(count);
  const jump = button('跳转', () => { const value = Number(input.value); if (Number.isInteger(value) && value >= 1 && value <= session?.slideCount) show(value - 1); else { status.textContent = `请输入 1 至 ${session?.slideCount || 1} 的页码。`; input.value = String(page + 1); } });
  input.addEventListener('keydown', event => { if (event.key === 'Enter') jump.click(); });
  const less = button('缩小', () => changeZoom(zoom / 1.2)), more = button('放大', () => changeZoom(zoom * 1.2));
  const zoomLabel = document.createElement('span'); zoomLabel.textContent = '100%'; controls.append(zoomLabel);
  const fit = button('适合窗口', () => { fitting = true; layout(); });
  const status = document.createElement('div'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.style.cssText = 'padding:6px 12px;font-size:13px'; status.textContent = '正在验证并打开幻灯片…';
  const warnings = document.createElement('div'); warnings.style.cssText = 'padding:6px 12px;font-size:12px;color:#5e4c2b;background:#fff7df';
  const viewport = document.createElement('div'); viewport.style.cssText = 'flex:1;min-height:200px;overflow:auto;padding:12px;box-sizing:border-box';
  const canvas = document.createElement('div'); canvas.style.cssText = 'margin:auto;box-shadow:0 2px 10px #0002;background:white'; viewport.append(canvas);
  root.append(controls, status, warnings, viewport); host.append(root);
  function check() { if (disposed || controller.signal.aborted) throw presentationAbortError(); }
  function updateControls() {
    prev.disabled = busy || !session || page <= 0; next.disabled = busy || !session || page >= session.slideCount - 1;
    jump.disabled = input.disabled = busy || !session;
    less.disabled = more.disabled = fit.disabled = !session;
    input.value = String(page + 1);
  }
  function layout() {
    if (!session || disposed) return;
    if (fitting) zoom = Math.min(Math.max((viewport.clientWidth - 24) / session.width, .05), Math.max((viewport.clientHeight - 24) / session.height, .05));
    canvas.style.width = `${session.width * zoom}px`; canvas.style.height = `${session.height * zoom}px`;
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }
  function changeZoom(value) { fitting = false; zoom = Math.max(.1, Math.min(4, value)); layout(); }
  async function show(target, initial = false) {
    if (busy || disposed || !session || target < 0 || target >= session.slideCount) return;
    busy = true; const token = ++generation; updateControls(); status.textContent = `正在显示第 ${target + 1} 页…`;
    try {
      const output = await session.render(target); check();
      const clean = await sanitizePresentationSlide(output, { width: session.width, height: session.height, window, signal: controller.signal, formats }); check();
      if (token !== generation) return;
      const frame = document.createElement('iframe'); frame.setAttribute('sandbox', ''); frame.setAttribute('referrerpolicy', 'no-referrer'); frame.title = `第 ${target + 1} 页幻灯片`;
      frame.style.cssText = 'display:block;border:0;width:100%;height:100%;background:white';
      await new Promise((resolve, reject) => {
        let done = false, timer;
        const finish = error => {
          if (done) return;
          done = true; clearTimeout(timer);
          frame.removeEventListener('load', loaded); frame.removeEventListener('error', failed);
          controller.signal.removeEventListener('abort', aborted);
          if (error) reject(error); else resolve();
        };
        const loaded = () => finish(), failed = () => finish(new Error('幻灯片页面加载失败。'));
        const aborted = () => finish(presentationAbortError());
        frame.addEventListener('load', loaded); frame.addEventListener('error', failed);
        controller.signal.addEventListener('abort', aborted, { once: true });
        if (controller.signal.aborted) { aborted(); return; }
        timer = setTimeout(() => finish(new Error('幻灯片页面加载超时，请下载原文件查看。')), PRESENTATION_LIMITS.timeoutMs);
        frame.srcdoc = clean.srcdoc; canvas.replaceChildren(frame);
      });
      check(); if (token !== generation) return;
      page = target;
      warnings.textContent = clean.warnings.join(' '); status.textContent = `第 ${page + 1} / ${session.slideCount} 页`; layout();
    } catch (error) {
      if (initial) throw error;
      if (!disposed && token === generation && error?.name !== 'AbortError') status.textContent = `第 ${target + 1} 页显示失败：${error?.message || '请下载原文件查看。'}`;
    } finally { if (!disposed && token === generation) { busy = false; updateControls(); } }
  }
  function dispose() {
    if (disposed) return;
    disposed = true; generation++; controller.abort(); session?.dispose(); resizeObserver?.disconnect();
    window?.removeEventListener('resize', layout); signal?.removeEventListener('abort', dispose); root.remove();
  }
  signal?.addEventListener('abort', dispose, { once: true });
  try {
    if (signal?.aborted) { dispose(); throw presentationAbortError(); }
    updateControls();
    session = await createPresentationSession(bytes, format, mime, { signal: controller.signal, makeWorker, onVerified }); check();
    count.textContent = `/ ${session.slideCount} 页`; input.max = String(session.slideCount);
    if (window?.ResizeObserver) { resizeObserver = new window.ResizeObserver(layout); resizeObserver.observe(viewport); }
    else window?.addEventListener('resize', layout);
    await show(0, true); check();
    return { dispose };
  } catch (error) { dispose(); throw error; }
}
