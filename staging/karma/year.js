// A team's year, week by week, drawn as columns of 0/1 characters.
//   data-year="today": the same reserved block every week -> idle 0s in quiet weeks, waiting 1s in crunches
//   data-year="karma": reserved blocks only in busy stretches, the rest covered by spot / on-demand
// Columns type in left to right when the figure comes on screen, then the digits keep flickering.

const WEEKS = 52, ROWS = 16, BLOCK = 9;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

function demand() {
  // made-up year: low base, two crunches before conference deadlines
  let s = 7;
  const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  return Array.from({ length: WEEKS }, (_, w) => {
    const crunch = Math.exp(-((w - 17) ** 2) / 10) * 8 + Math.exp(-((w - 42) ** 2) / 8) * 7;
    return Math.max(1, Math.min(ROWS, Math.round(3 + r() * 2.5 + crunch * 1.15)));
  });
}

export function mountYear(fig) {
  const grid = fig.querySelector('.yr__grid');
  const mode = fig.dataset.year;
  const d = demand();
  const reservedAt = (w) => (mode === 'today' ? BLOCK : (d[w] >= 10 ? Math.min(ROWS, d[w]) : 0));

  // cell states: '' empty, use, idle, wait, flex
  const cols = d.map((dem, w) => {
    const res = reservedAt(w);
    return Array.from({ length: ROWS }, (_, row) => {
      const y = row + 1; // 1 = bottom
      if (mode === 'today') {
        if (y <= Math.min(dem, res)) return 'use';
        if (y <= res) return 'idle';
        if (y <= dem) return 'wait';
        return '';
      }
      if (y <= Math.min(dem, res)) return 'use';
      if (y <= res) return 'idle';
      if (y <= dem) return 'flex';
      return '';
    });
  });

  grid.style.setProperty('--cols', WEEKS);
  grid.style.setProperty('--rows', ROWS);
  const cells = [];
  const frag = document.createDocumentFragment();
  for (let row = ROWS - 1; row >= 0; row--) {
    for (let w = 0; w < WEEKS; w++) {
      const c = document.createElement('i');
      const st = cols[w][row];
      c.dataset.s = st;
      if (mode === 'today' && row === BLOCK - 1 && !st) c.dataset.line = '';
      if (mode === 'today' && row === BLOCK - 1) c.dataset.edge = '';
      c.textContent = st ? (Math.random() < 0.5 ? '0' : '1') : '·';
      if (st === 'idle') c.textContent = '0';
      cells.push({ el: c, w, st });
      frag.appendChild(c);
    }
  }
  grid.appendChild(frag);

  let shown = reduce ? WEEKS : 0, raf = 0, last = 0, onScreen = false;
  const paint = () => { for (const c of cells) c.el.classList.toggle('on', c.w < shown); };
  paint();

  function tick(t) {
    raf = requestAnimationFrame(tick);
    if (!onScreen) return;
    if (t - last < 70) return;
    last = t;
    if (shown < WEEKS) { shown++; paint(); }
    // a few digits flip each tick, idle reservations stay as 0s
    for (let k = 0; k < 18; k++) {
      const c = cells[(Math.random() * cells.length) | 0];
      if (c.st && c.st !== 'idle' && c.w < shown) c.el.textContent = Math.random() < 0.5 ? '0' : '1';
    }
  }
  new IntersectionObserver(([e]) => {
    onScreen = e.isIntersecting;
    if (onScreen && !raf && !reduce) raf = requestAnimationFrame(tick);
  }, { threshold: 0.35 }).observe(fig);
}
