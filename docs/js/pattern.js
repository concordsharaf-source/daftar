/*
 * لوحة الباترن (٣×٣ نقاط) — تُستخدم في إعداد القفل وفي شاشة الفتح.
 *
 * تُبنى بالكامل في JS فتُستعمل في أكثر من موضع بلا تكرار markup،
 * وتدعم الفأرة واللمس والقلم، وترسم خطوط التتبع على SVG.
 */

const GRID = 3;

/** ينشئ لوحة باترن داخل العنصر المعطى ويعيد واجهة تحكم بها. */
export function createPatternPad(host, { minDots = 4, onComplete } = {}) {
  host.innerHTML = '';
  host.classList.add('pattern-pad');

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'pattern-lines');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  host.appendChild(svg);

  const grid = document.createElement('div');
  grid.className = 'pattern-grid';
  host.appendChild(grid);

  const cells = [];
  for (let i = 0; i < GRID * GRID; i++) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'pattern-dot';
    cell.dataset.index = String(i);
    cell.setAttribute('aria-label', `نقطة ${i + 1}`);
    const inner = document.createElement('span');
    cell.appendChild(inner);
    grid.appendChild(cell);
    cells.push(cell);
  }

  let selected = [];
  let drawing = false;
  let lastPoint = null;

  function centerOf(index) {
    const rect = cells[index].getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function cellAt(x, y) {
    for (let i = 0; i < cells.length; i++) {
      const rect = cells[i].getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const radius = rect.width * 0.55;
      if (Math.hypot(x - cx, y - cy) <= radius) return i;
    }
    return -1;
  }

  function drawLines(cursor) {
    const hostRect = host.getBoundingClientRect();
    const toLocal = (point) => ({
      x: ((point.x - hostRect.left) / hostRect.width) * 100,
      y: ((point.y - hostRect.top) / hostRect.height) * 100,
    });

    const parts = [];
    for (let i = 0; i < selected.length - 1; i++) {
      const a = toLocal(centerOf(selected[i]));
      const b = toLocal(centerOf(selected[i + 1]));
      parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" />`);
    }
    if (cursor && selected.length) {
      const a = toLocal(centerOf(selected[selected.length - 1]));
      const b = toLocal(cursor);
      parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="live" />`);
    }
    svg.innerHTML = parts.join('');
  }

  function highlight() {
    cells.forEach((cell, i) => cell.classList.toggle('on', selected.includes(i)));
  }

  function addCell(index) {
    if (index < 0 || selected.includes(index)) return;
    selected.push(index);
    highlight();
    lastPoint = centerOf(index);
    drawLines(lastPoint);
  }

  function reset() {
    selected = [];
    highlight();
    svg.innerHTML = '';
    host.classList.remove('error');
  }

  function finish() {
    if (!drawing) return;
    drawing = false;
    drawLines(null);
    const pattern = selected.join('-');
    if (selected.length < minDots) {
      host.classList.add('error');
      host.classList.remove('error');
      setTimeout(() => host.classList.remove('error'), 10);
      setTimeout(() => { host.classList.add('error'); }, 0);
      const result = { pattern, ok: false, reason: 'too-short' };
      onComplete?.(result);
      setTimeout(reset, 450);
      return;
    }
    onComplete?.({ pattern, ok: true });
    setTimeout(reset, 260);
  }

  function onDown(event) {
    event.preventDefault();
    drawing = true;
    reset();
    host.setPointerCapture?.(event.pointerId);
    const index = cellAt(event.clientX, event.clientY);
    if (index >= 0) addCell(index);
  }

  function onMove(event) {
    if (!drawing) return;
    event.preventDefault();
    const index = cellAt(event.clientX, event.clientY);
    if (index >= 0) addCell(index);
    else drawLines({ x: event.clientX, y: event.clientY });
  }

  function onUp() {
    if (drawing) finish();
  }

  host.addEventListener('pointerdown', onDown);
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerup', onUp);
  host.addEventListener('pointercancel', onUp);
  host.addEventListener('pointerleave', (e) => { if (drawing) drawLines({ x: e.clientX, y: e.clientY }); });
  window.addEventListener('pointerup', onUp);

  return {
    reset,
    destroy() {
      window.removeEventListener('pointerup', onUp);
      host.innerHTML = '';
    },
    get selected() { return [...selected]; },
  };
}
