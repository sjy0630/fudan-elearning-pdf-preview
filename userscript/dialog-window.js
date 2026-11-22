function createDialogWindow({ root, dialog, header, title, maximizeButton, resetButton, hint }) {
  let bounds, restoredBounds, maximized = false, gesture = null, suppressClick = false;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const viewport = () => ({ width: root.clientWidth, height: root.clientHeight });
  const minimum = view => ({ width: Math.min(480, view.width), height: Math.min(320, view.height) });
  function constrain(rect) {
    const view = viewport(), min = minimum(view);
    const width = clamp(rect.width, min.width, view.width), height = clamp(rect.height, min.height, view.height);
    return { x: clamp(rect.x, 0, view.width - width), y: clamp(rect.y, 0, view.height - height), width, height };
  }
  function centered() {
    const view = viewport(), margin = view.width <= 600 ? 8 : 16;
    const width = Math.min(1200, view.width - margin * 2), height = Math.min(900, view.height - margin * 2);
    return constrain({ x: (view.width - width) / 2, y: (view.height - height) / 2, width, height });
  }
  function apply(rect) {
    bounds = rect;
    Object.assign(dialog.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    dialog.classList.toggle('fdpdf-maximized', maximized);
    maximizeButton.textContent = maximized ? '还原' : '最大化';
    maximizeButton.setAttribute('aria-label', maximized ? '还原窗口' : '最大化窗口');
    maximizeButton.setAttribute('aria-pressed', String(maximized));
    hint.textContent = maximized ? '双击标题栏或点“还原”恢复窗口' : '拖动标题栏移动 · 拖动边缘调整大小';
  }
  function show() {
    const view = viewport();
    apply(maximized ? { x: 0, y: 0, ...view } : bounds ? constrain(bounds) : centered());
  }
  function finish(event) {
    if (!gesture || (event?.pointerId != null && event.pointerId !== gesture.id)) return;
    const previous = gesture; gesture = null;
    root.classList.remove('fdpdf-window-active'); root.style.removeProperty('cursor');
    if (previous.target.hasPointerCapture(previous.id)) previous.target.releasePointerCapture(previous.id);
  }
  function toggleMaximize() {
    finish();
    if (maximized) { maximized = false; apply(constrain(restoredBounds || centered())); }
    else { restoredBounds = { ...bounds }; maximized = true; show(); }
  }
  function reset() {
    finish(); maximized = false; restoredBounds = null; apply(centered());
  }
  function resize(rect, direction, dx, dy) {
    const view = viewport(), min = minimum(view);
    let left = rect.x, top = rect.y, right = rect.x + rect.width, bottom = rect.y + rect.height;
    if (direction.includes('w')) left = clamp(left + dx, 0, right - min.width);
    if (direction.includes('e')) right = clamp(right + dx, left + min.width, view.width);
    if (direction.includes('n')) top = clamp(top + dy, 0, bottom - min.height);
    if (direction.includes('s')) bottom = clamp(bottom + dy, top + min.height, view.height);
    return { x: left, y: top, width: right - left, height: bottom - top };
  }
  const interactive = target => target.closest('button, a, input, select, textarea, label, [contenteditable]');
  for (const direction of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
    const handle = document.createElement('div');
    handle.className = `fdpdf-resize fdpdf-resize-${direction}`; handle.dataset.resize = direction;
    handle.setAttribute('aria-hidden', 'true'); dialog.append(handle);
  }
  // Keep pointer capture outside the reader, including native PDF plugin surfaces.
  const shield = document.createElement('div'); shield.className = 'fdpdf-window-shield'; shield.setAttribute('aria-hidden', 'true'); root.append(shield);
  root.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.isPrimary === false) return;
    suppressClick = false;
    if (root.hidden || maximized || gesture) return;
    const direction = event.target.closest('[data-resize]')?.dataset.resize;
    if (!direction && (!header.contains(event.target) || interactive(event.target))) return;
    event.preventDefault();
    title.focus({ preventScroll: true });
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, bounds: { ...bounds }, direction, target: direction ? event.target.closest('[data-resize]') : header };
    root.style.cursor = direction ? `${direction}-resize` : 'grabbing';
    root.classList.add('fdpdf-window-active');
    gesture.target.setPointerCapture(event.pointerId);
  });
  root.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    // Some browsers omit pointerup when the mouse is released outside their window.
    if (event.pointerType === 'mouse' && event.buttons === 0) { finish(event); return; }
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) suppressClick = true;
    if (!suppressClick) return;
    event.preventDefault();
    apply(gesture.direction ? resize(gesture.bounds, gesture.direction, dx, dy) : constrain({ ...gesture.bounds, x: gesture.bounds.x + dx, y: gesture.bounds.y + dy }));
  });
  window.addEventListener('pointerup', finish, true);
  window.addEventListener('pointercancel', finish, true);
  root.addEventListener('lostpointercapture', finish);
  root.addEventListener('click', event => {
    if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; }
  }, true);
  header.addEventListener('dblclick', event => { if (!interactive(event.target)) { event.preventDefault(); toggleMaximize(); } });
  maximizeButton.addEventListener('click', toggleMaximize);
  resetButton.addEventListener('click', reset);
  title.tabIndex = 0;
  title.title = '拖动移动；双击最大化 / 还原；聚焦后用方向键移动，Shift + 方向键调整大小';
  title.addEventListener('keydown', event => {
    const delta = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[event.key];
    if (!delta || event.altKey || event.ctrlKey || event.metaKey || maximized) return;
    event.preventDefault();
    const [dx, dy] = delta;
    apply(event.shiftKey ? resize(bounds, 'se', dx, dy) : constrain({ ...bounds, x: bounds.x + dx, y: bounds.y + dy }));
  });
  window.addEventListener('blur', () => finish());
  window.addEventListener('resize', () => { finish(); if (!root.hidden) show(); });
  return { show, cancel: () => { finish(); suppressClick = false; } };
}
