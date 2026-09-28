/* Atul Phadke · portfolio
 * Vanilla JS, no dependencies. Progressive enhancement only: every piece of
 * content is in the HTML; this file adds the hero controls (js/rig.js draws
 * the scheduling scene), card signature drawings, the mobile menu,
 * scroll-spy, and the copy button.
 */
(() => {
  'use strict';

  const doc = document;
  const root = doc.documentElement;
  const $ = (sel, ctx = doc) => ctx.querySelector(sel);
  const $$ = (sel, ctx = doc) => Array.from(ctx.querySelectorAll(sel));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');

  /* ------------------------------------------------------------------ *
   * Seeded randomness
   * ------------------------------------------------------------------ */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash(i, seed) {
    let h = Math.imul((i | 0) ^ Math.imul(seed | 0, 0x9E3779B1), 0x85EBCA6B);
    h ^= h >>> 13;
    h = Math.imul(h, 0xC2B2AE35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }



  /* ------------------------------------------------------------------ *
   * Pause/Play buttons ([data-run]) drive the rig (js/rig.js) on any page.
   * ------------------------------------------------------------------ */
  function initScope() {
    const buttons = $$('[data-run]');
    if (!buttons.length) return null;
    const section = $('.scope');
    let running = !mqReduce.matches;

    function paint() {
      if (section) section.classList.toggle('is-stopped', !running);
      buttons.forEach((b) => { b.dataset.state = running ? 'running' : 'stopped'; });
    }
    function setRunning(next) {
      running = next;
      paint();
      doc.dispatchEvent(new CustomEvent('scope:run', { detail: { running } }));
    }
    buttons.forEach((b) => b.addEventListener('click', () => setRunning(!running)));
    mqReduce.addEventListener('change', () => { if (mqReduce.matches) setRunning(false); });
    paint();
    return { start() {}, remeasure() {} };
  }

  function initHero(scope) {
    const section = $('.scope');
    if (!section) return;
    const go = () => {
      section.classList.add('is-ready');
      if (scope) {
        scope.remeasure();
        scope.start();
      }
    };
    if (mqReduce.matches) { go(); return; }
    const fontLoad = doc.fonts && doc.fonts.load
      ? doc.fonts.load('800 1em "Recursive"').catch(() => {})
      : Promise.resolve();
    const timeout = new Promise((resolve) => setTimeout(resolve, 900));
    Promise.race([fontLoad, timeout]).then(() => requestAnimationFrame(go));
  }

  /* ------------------------------------------------------------------ *
   * Work cards: signature visuals + filtering
   * Same vocabulary as the hero: hand-drawn GPUs (js/rig-art.js) for
   * systems work, a double helix for biology, both for "both". The
   * featured card also gets the robot agent.
   * ------------------------------------------------------------------ */
  const SVGNS = 'http://www.w3.org/2000/svg';
  const JOBS = ['blue', 'green', 'amber', 'pink'];

  function svgEl(parent, name, attrs, text) {
    const el = doc.createElementNS(SVGNS, name);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (text != null) el.textContent = text;
    parent.appendChild(el);
    return el;
  }

  const n1 = (v) => (Math.round(v * 10) / 10).toString();

  function sigGpus(svg, seed, box, withRobot) {
    const art = window.RigArt;
    const rnd = mulberry32(seed * 97 + 3);
    const [gw, gh] = art ? art.size.gpu : [64, 44];
    let x0 = box.x;
    let w = box.w;
    if (withRobot && art) {
      const rs = Math.min(1.5, box.h / 132);
      const rg = svgEl(svg, 'g', { class: 'sig__robot', transform: `translate(${n1(box.x + 4)} ${n1(box.y + (box.h - 128 * rs) / 2)}) scale(${n1(rs * 100) / 100})` });
      rg.innerHTML = art.art.robot;
      x0 += 96 * rs + 24;
      w -= 96 * rs + 24;
    }
    const cols = 4;
    const rows = box.h > 150 ? 2 : 1;
    const s = Math.min((w - (cols - 1) * 10) / (cols * gw), (box.h - (rows - 1) * 18) / (rows * (gh + 8)), 1.5);
    const cw = gw * s;
    const ch = gh * s;
    const used = { w: cols * cw + (cols - 1) * 10, h: rows * (ch + 8) + (rows - 1) * 18 };
    const ox = x0 + (w - used.w) / 2;
    const oy = box.y + (box.h - used.h) / 2;
    for (let r = 0; r < rows; r++) {
      let c = 0;
      while (c < cols) {
        // a job occupies 1, 2, or 4 GPUs in a row (gang scheduled), or the GPU is idle
        const roll = rnd();
        const k = roll < 0.28 ? 0 : roll < 0.62 ? 1 : roll < 0.9 && c <= cols - 2 ? 2 : c === 0 ? 4 : 1;
        const span = Math.max(1, k);
        const job = k ? JOBS[Math.floor(rnd() * JOBS.length)] : 'idle';
        const prog = k ? 0.2 + rnd() * 0.7 : 0;
        for (let i = 0; i < span && c < cols; i++, c++) {
          const x = ox + c * (cw + 10);
          const y = oy + r * (ch + 8 + 18);
          const g = svgEl(svg, 'g', { class: 'gpu', 'data-job': job, transform: `translate(${n1(x)} ${n1(y)}) scale(${n1(s * 100) / 100})` });
          if (art) g.innerHTML = art.art.gpu;
          else svgEl(g, 'rect', { class: 'r-fx', x: 5, y: 4, width: 56, height: 28, rx: 3 });
          svgEl(svg, 'rect', { class: 'gpu-bar-bg', x: n1(x + 4), y: n1(y + ch + 3), width: n1(cw - 8), height: 3, rx: 1.5 });
          if (k) svgEl(svg, 'rect', { class: 'gpu-bar', 'data-job': job, x: n1(x + 4), y: n1(y + ch + 3), width: n1((cw - 8) * prog), height: 3, rx: 1.5 });
        }
      }
    }
  }

  function sigHelix(svg, seed, box) {
    const rnd = mulberry32(seed * 131 + 7);
    const cy = box.y + box.h / 2;
    const amp = Math.min(box.h * 0.36, 46);
    const lambda = 110 + rnd() * 60;
    const k = (Math.PI * 2) / lambda;
    const ph = rnd() * Math.PI * 2;
    const x0 = box.x - 20;
    const x1 = box.x + box.w + 20;
    const y = (x, which) => cy + amp * Math.sin(k * x + ph + (which ? Math.PI : 0));
    const step = 12;
    for (let x = x0 + 6, i = 0; x < x1; x += step, i++) {
      const pair = hash(i, seed) < 0.5 ? 'at' : 'cg';
      svgEl(svg, 'line', { class: `sig__rung sig__rung--${pair}`, x1: n1(x), x2: n1(x), y1: n1(y(x, 0)), y2: n1(y(x, 1)) });
    }
    for (const which of [0, 1]) {
      let d = '';
      for (let x = x0; x <= x1; x += 3) d += `${d ? 'L' : 'M'}${n1(x)} ${n1(y(x, which))}`;
      svgEl(svg, 'path', { class: `sig__strand sig__strand--${which ? 'b' : 'a'}`, d });
    }
    for (let x = x0 + 6; x < x1; x += step) {
      const depth = Math.cos(k * x + ph);
      for (const which of [0, 1]) {
        const front = which ? depth <= 0 : depth > 0;
        svgEl(svg, 'circle', { class: `sig__bead sig__bead--${which ? 'b' : 'a'}${front ? '' : ' is-back'}`, cx: n1(x), cy: n1(y(x, which)), r: front ? 3 : 2 });
      }
    }
  }

  /* fig: the figure to draw into; src: element carrying data-seed / data-channel. */
  function drawSignature(fig, src) {
    if (!fig || fig.querySelector('img')) return;   // a real image wins
    const old = $('.sig', fig);
    if (old) old.remove();

    const seed = parseInt(src.dataset.seed, 10) || 1;
    const channel = src.dataset.channel;
    const w = Math.round(clamp(fig.clientWidth || 360, 240, 1400));
    const h = Math.round(clamp(fig.clientHeight || w * 0.625, 140, 900));

    const svg = doc.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'sig');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    // Leave the top-left corner for the channel tags.
    const box = { x: 20, y: 50, w: w - 40, h: h - 50 - 18 };
    const robot = src.classList.contains('work-card--featured') || src.hasAttribute('data-signature-robot');
    if (channel === 'both') {
      const top = Math.round(box.h * 0.5);
      sigGpus(svg, seed, { x: box.x, y: box.y, w: box.w, h: top - 6 }, false);
      sigHelix(svg, seed, { x: box.x, y: box.y + top + 6, w: box.w, h: box.h - top - 6 });
    } else if (channel === 'biology') {
      sigHelix(svg, seed, box);
    } else {
      sigGpus(svg, seed, box, robot);
    }

    fig.dataset.drawnWidth = String(fig.clientWidth);
    fig.appendChild(svg);
  }

  /* Signature visuals on work cards and on any figure[data-signature]
   * (project pages). Redrawn only when a figure's width changes a lot. */
  function initSignatures() {
    const targets = [
      ...$$('.work-card').map((card) => [$('.work-card__media', card), card]),
      ...$$('figure[data-signature]').map((fig) => [fig, fig]),
    ].filter(([fig]) => fig);
    if (!targets.length) return;
    targets.forEach(([fig, src]) => drawSignature(fig, src));

    let timer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        targets.forEach(([fig, src]) => {
          if (!fig.offsetParent) return;
          const was = parseFloat(fig.dataset.drawnWidth) || 0;
          const now = fig.clientWidth;
          if (now && was && Math.abs(now / was - 1) > 0.15) drawSignature(fig, src);
        });
      }, 200);
    });
  }

  /* Hand-drawn icons from js/rig-art.js, placed with <span data-art="tag">. */
  const ART_BOX = {
    tag: '0 0 26 26', clock: '0 0 26 26', gauge: '0 0 26 24', save: '0 0 24 24', cloud: '0 0 26 22',
    cloudSpot: '0 0 26 22', building: '0 0 24 26', bolt: '0 0 24 28', tick: '0 0 20 20',
    shield: '0 0 32 36', gpu: '0 0 64 44', robot: '0 0 96 128',
  };
  function initArt() {
    const art = window.RigArt;
    if (!art) return;
    $$('[data-art]').forEach((el) => {
      const name = el.dataset.art;
      if (!art.art[name] || el.querySelector('svg')) return;
      const svg = doc.createElementNS(SVGNS, 'svg');
      svg.setAttribute('viewBox', ART_BOX[name] || '0 0 26 26');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      svg.innerHTML = art.art[name];
      el.appendChild(svg);
    });
  }

  /* ------------------------------------------------------------------ *
   * Nav: mobile sheet + scroll-spy
   * ------------------------------------------------------------------ */
  function initNav() {
    const toggle = $('.nav__toggle');
    const menu = $('#nav-menu');
    if (!toggle || !menu) return;
    const mqWide = matchMedia('(min-width: 40rem)');
    const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';
    const setOpen = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      menu.classList.toggle('is-open', open);
    };

    toggle.addEventListener('click', () => setOpen(!isOpen()));
    doc.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) {
        setOpen(false);
        toggle.focus();
      }
    });
    menu.addEventListener('click', (e) => {
      if (e.target.closest('a') && !mqWide.matches) setOpen(false);
    });
    doc.addEventListener('pointerdown', (e) => {
      if (isOpen() && !e.target.closest('.site-head')) setOpen(false);
    });
    menu.addEventListener('focusout', (e) => {
      if (mqWide.matches || !isOpen()) return;
      const next = e.relatedTarget;
      if (next && !next.closest('.site-head')) setOpen(false);
    });
    mqWide.addEventListener('change', () => setOpen(false));
  }

  function initScrollSpy() {
    if (!('IntersectionObserver' in window)) return;
    const links = $$('.nav__link[href^="#"]');
    const map = new Map();
    links.forEach((a) => {
      const target = doc.getElementById(a.getAttribute('href').slice(1));
      if (target) map.set(target, a);
    });
    if (!map.size) return;
    const order = Array.from(map.keys());
    const inView = new Set();
    let atEnd = false;

    const paint = () => {
      let current = null;
      if (atEnd) current = order[order.length - 1];
      else order.forEach((s) => { if (inView.has(s)) current = s; });
      links.forEach((a) => a.classList.toggle('is-active', current !== null && map.get(current) === a));
    };

    const head = $('.site-head');
    const navH = head ? head.offsetHeight : 72;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) inView.add(en.target); else inView.delete(en.target); });
      paint();
    }, { rootMargin: `-${navH}px 0px -55% 0px` });
    order.forEach((s) => io.observe(s));

    const end = $('.foot__meta');
    if (end) {
      new IntersectionObserver(([en]) => { atEnd = en.isIntersecting; paint(); }).observe(end);
    }
  }

  /* ------------------------------------------------------------------ *
   * Copy email
   * ------------------------------------------------------------------ */
  function initCopy() {
    const btn = $('[data-copy]');
    if (!btn) return;
    const status = $('[data-copy-status]');
    const link = $('[data-email]');
    let timer = 0;

    btn.addEventListener('click', async () => {
      const text = btn.dataset.copy;
      try {
        if (!navigator.clipboard || !window.isSecureContext) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(text);
        btn.dataset.state = 'copied';
        if (status) status.textContent = 'Email address copied.';
        clearTimeout(timer);
        timer = setTimeout(() => {
          btn.dataset.state = 'idle';
          if (status) status.textContent = '';
        }, 2000);
      } catch (err) {
        if (link) {
          const range = doc.createRange();
          range.selectNodeContents(link);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
        if (status) status.textContent = 'Email address selected.';
      }
    });
  }

  /* ------------------------------------------------------------------ */
  function init() {
    initNav();
    initScrollSpy();
    const scope = initScope();
    initSignatures();
    initArt();
    initCopy();
    initHero(scope);
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})();
