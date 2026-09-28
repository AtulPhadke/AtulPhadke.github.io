/* CAP-GENIE page (work/cap-genie/) · two illustrative figures, tokens via CSS.
 *  1. The pipeline, driven by the scroll steps (js/scrolly.js): find each variant
 *     between its flanks, drop low-quality reads and merge reads carrying a
 *     sequencing error, then compare each variant's share with the input library.
 *  2. Reads split across threads (the speed figure), with a Pause button
 *     ([data-run], wired by js/site.js, which dispatches 'scope:run').
 * Hand-drawn frames come from js/capgenie-art.js (window.CapArt). The reads,
 * variants and counts are made up; the captions say so. */
(() => {
  'use strict';

  const SVGNS = 'http://www.w3.org/2000/svg';
  const doc = document;
  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');

  function el(tag, attrs, parent, text) {
    const n = doc.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function art(markup, parent, transform) {
    const g = el('g', transform ? { transform } : {}, parent);
    g.innerHTML = markup;
    return g;
  }
  // per-glyph x positions, so letters line up with the washes behind them
  const xs = (x0, n, step) => Array.from({ length: n }, (_, i) => +(x0 + i * step).toFixed(1)).join(' ');

  /* ------------------------------------------------------------------ *
   * 1 · The pipeline
   * ------------------------------------------------------------------ */
  const UP = 'ACCAAC';
  const DN = 'GCACAG';
  const V = { A: 'ACTCTGGCGGTA', A2: 'ACTCTGTCGGTA', B: 'GGAACCTTACGT', C: 'CTTCAGAAGGAT', X: 'TAGGCATTCAAC' };
  const MM = 6; // the one base where A2 differs from A
  const QMIN = 20;
  // role after cleanup: lead (stays), dup (same as a lead), merge (one mismatch
  // from a lead), drop (below the quality threshold); k is the lead it joins
  const READS = [
    { q: 36, v: 'A', pre: 'GTC', post: 'TTA', role: 'lead', k: 0 },
    { q: 34, v: 'B', pre: 'ATG', post: 'CCT', role: 'lead', k: 1 },
    { q: 33, v: 'A2', pre: 'CAT', post: 'GGA', role: 'merge', k: 0 },
    { q: 11, v: 'B', pre: 'TGA', post: 'ACC', role: 'drop' },
    { q: 35, v: 'C', pre: 'GAC', post: 'TTG', role: 'lead', k: 2 },
    { q: 37, v: 'A', pre: 'CTA', post: 'AGC', role: 'dup', k: 0 },
    { q: 9, v: 'X', pre: 'AAT', post: 'CGT', role: 'drop' },
  ];
  // share of reads: [variant, input library, brain, fold change]
  const SHARE = [['A', 0.34, 0.82, '2.4×'], ['B', 0.33, 0.13, '0.4×'], ['C', 0.33, 0.05, '0.2×']];

  const W = 720;
  const H = 730;
  const CW = 12.6; // 21px monospace advance
  const X0 = 104;
  const rowTop = (i) => 66 + i * 34;
  const CHIP_W = 146;
  const CC = 10;
  const slot = (i) => [38 + (i % 4) * 162, 386 + Math.floor(i / 4) * 46];
  const finalSlot = (k) => [38 + k * 206, 402];
  const BAR_X = 170;
  const BAR_W = 380;

  function put(node, { x = 0, y = 0, sx = null, o = 1, d = 0, od = d }) {
    node.style.transform = sx == null ? `translate(${x}px, ${y}px)` : `scaleX(${sx})`;
    node.style.opacity = String(o);
    node.style.transitionDelay = `${d}ms, ${od}ms`;
  }

  function initPipeline(section) {
    const host = section.querySelector('[data-cg-scene]');
    const A = window.CapArt;
    if (!host || !A) return;
    section.classList.add('is-live');

    const svg = el('svg', { class: 'cg-svg no-anim', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true', focusable: 'false' }, host);
    const panel = (y, h, frame, label) => {
      const g = el('g', { class: 'cg-panel cg-t' }, svg);
      el('rect', { class: 'cg-panel__bg', x: 18, y, width: 684, height: h, rx: 6 }, g);
      art(frame, g, `translate(18 ${y})`);
      el('text', { class: 'cg-label', x: 38, y: y + 32 }, g, label);
      return g;
    };
    art(A.arrowDown, svg, 'translate(360 317)');
    art(A.arrowDown, svg, 'translate(360 509)');

    /* reads */
    const pReads = panel(16, 300, A.panelReads, 'FASTQ reads');
    const reads = READS.map((r, i) => {
      const top = rowTop(i);
      const low = r.q < QMIN;
      const g = el('g', { class: 'cg-read cg-t' }, pReads);
      const wash = el('g', { class: 'cg-t' }, g);
      el('rect', { class: 'cg-wash--flank', x: X0 + 3 * CW - 2, y: top + 3, width: 6 * CW + 4, height: 25, rx: 4 }, wash);
      el('rect', { class: 'cg-wash--var', x: X0 + 9 * CW - 2, y: top + 3, width: 12 * CW + 4, height: 25, rx: 4 }, wash);
      el('rect', { class: 'cg-wash--flank', x: X0 + 21 * CW - 2, y: top + 3, width: 6 * CW + 4, height: 25, rx: 4 }, wash);
      const b = el('g', { class: `cg-badge${low ? ' is-low' : ''}`, transform: `translate(36 ${top + 4})` }, g);
      el('rect', { class: 'cg-badge__bg', width: 52, height: 24, rx: 5 }, b);
      art(A.badge[i % 2], b);
      el('text', { class: 'cg-badge__t', x: 26, y: 17, 'text-anchor': 'middle' }, b, `Q${r.q}`);
      let strike = null;
      if (low) {
        strike = el('g', { class: 'cg-t' }, b);
        art(A.strike, strike);
      }
      el('text', { class: 'cg-seq', x: xs(X0, 30, CW), y: top + 22 }, g, r.pre + UP + V[r.v] + DN + r.post);
      return { g, wash, strike, low };
    });
    const legend = el('g', { class: 'cg-t' }, pReads);
    el('rect', { class: 'cg-wash--flank', x: 532, y: 66, width: 22, height: 14, rx: 3 }, legend);
    el('text', { class: 'cg-note', x: 562, y: 78 }, legend, 'known flank');
    el('rect', { class: 'cg-wash--var', x: 532, y: 92, width: 22, height: 14, rx: 3 }, legend);
    el('text', { class: 'cg-note', x: 562, y: 104 }, legend, 'variant');
    el('text', { class: 'cg-note', x: 532, y: 134 }, legend, 'Q = Phred quality');
    const qRule = el('text', { class: 'cg-note cg-note--low cg-t', x: 532, y: 156 }, pReads, 'Below Q20: dropped');

    /* variants */
    const pVars = panel(336, 172, A.panelVariants, 'Variants');
    const chips = READS.map((r, i) => {
      const g = el('g', { class: 'cg-chip cg-t' }, pVars);
      el('rect', { class: 'cg-chip__bg', width: CHIP_W, height: 32, rx: 4 }, g);
      art(A.chip[i % A.chip.length], g);
      const mm = r.role === 'merge' ? el('rect', { class: 'cg-mm cg-t', x: 13 + MM * CC - 1.5, y: 6, width: 11, height: 21, rx: 3 }, g) : null;
      el('text', { class: 'cg-chip__t', x: xs(13, 12, CC), y: 21.5 }, g, V[r.v]);
      return { g, mm, r, i };
    });
    const counts = ['×3', '×1', '×1'].map((t, k) => {
      const [x, y] = finalSlot(k);
      return el('text', { class: 'cg-count cg-t', x: x + CHIP_W + 10, y: y + 22 }, pVars, t);
    });
    const note = el('text', { class: 'cg-note cg-t', x: 38, y: 490 }, pVars, 'Dropped 2 low-quality reads, merged 1 sequencing error');

    /* shares against the input library */
    const pChart = panel(528, 190, A.panelChart, 'Share of reads');
    el('rect', { class: 'cg-bar--input', x: 470, y: 549, width: 22, height: 12, rx: 2 }, pChart);
    el('text', { class: 'cg-note', x: 500, y: 560 }, pChart, 'input library');
    el('rect', { class: 'cg-bar--brain', x: 612, y: 549, width: 22, height: 12, rx: 2 }, pChart);
    el('text', { class: 'cg-note', x: 642, y: 560 }, pChart, 'brain');
    const bars = SHARE.map(([v, a, b, fold], k) => {
      const top = 580 + k * 44;
      el('text', { class: 'cg-chip__t', x: xs(38, 12, CC), y: top + 22 }, pChart, V[v]);
      const bi = el('rect', { class: 'cg-bar cg-bar--input cg-t', x: BAR_X, y: top + 5, width: (a * BAR_W).toFixed(1), height: 11, rx: 2 }, pChart);
      const bb = el('rect', { class: 'cg-bar cg-bar--brain cg-t', x: BAR_X, y: top + 20, width: (b * BAR_W).toFixed(1), height: 11, rx: 2 }, pChart);
      const lab = el('text', { class: `cg-fold cg-t${k === 0 ? ' is-up' : ''}`, x: 574, y: top + 24 }, pChart, fold);
      return { bi, bb, lab };
    });

    function apply(s, back) {
      const D = (ms) => (back ? 0 : ms);
      put(pReads, { o: s >= 2 ? 0.4 : 1 });
      put(pVars, { o: s >= 2 ? 0.55 : 1 });
      put(pChart, { o: s >= 2 ? 1 : 0.45 });
      reads.forEach((r, i) => {
        put(r.wash, { o: s >= 0 ? 1 : 0, d: D(150 + i * 60) });
        put(r.g, { o: s >= 1 && r.low ? 0.35 : 1 });
        if (r.strike) put(r.strike, { o: s >= 1 ? 1 : 0 });
      });
      put(legend, { o: s >= 0 ? 1 : 0, d: D(150) });
      put(qRule, { o: s >= 1 ? 1 : 0 });

      chips.forEach(({ g, mm, r, i }) => {
        let pos = [X0 + 9 * CW - 13, rowTop(i)];
        let o = 0;
        let d = 0;
        let od = 0;
        if (s >= 0) {
          pos = slot(i);
          o = 1;
          d = od = D(650 + i * 90);
        }
        if (s >= 1) {
          if (r.role === 'drop') {
            pos = [pos[0], pos[1] + 14];
            o = 0;
            d = od = D(150);
          } else {
            pos = finalSlot(r.k);
            d = D(r.role === 'merge' ? 1150 : 900);
            od = d;
            if (r.role !== 'lead') {
              o = 0;
              od = D(r.role === 'merge' ? 1750 : 1500);
            }
          }
        }
        put(g, { x: pos[0], y: pos[1], o, d, od });
        if (mm) put(mm, { o: s >= 1 ? 1 : 0, d: D(350) });
      });
      counts.forEach((c) => put(c, { o: s >= 1 ? 1 : 0, d: D(1800) }));
      put(note, { o: s >= 1 ? 1 : 0, d: D(2000) });

      bars.forEach(({ bi, bb, lab }, k) => {
        put(bi, { sx: s >= 2 ? 1 : 0, d: D(250 + k * 120) });
        put(bb, { sx: s >= 2 ? 1 : 0, d: D(800 + k * 120) });
        put(lab, { o: s >= 2 ? 1 : 0, d: D(1400 + k * 120) });
      });
    }

    // Nothing plays until the scene is on screen; then it follows the steps.
    let seen = false;
    let cur = 0;
    let shown = -2;
    function update() {
      const s = seen ? cur : -1;
      if (s === shown) return;
      apply(s, s < shown);
      shown = s;
    }
    update();
    requestAnimationFrame(() => requestAnimationFrame(() => svg.classList.remove('no-anim')));

    if (window.Scrolly) window.Scrolly.onStep(section, ({ index }) => { cur = Math.max(0, index); update(); });
    new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { seen = true; update(); }
    }, { threshold: 0.3 }).observe(host);
  }

  /* ------------------------------------------------------------------ *
   * 2 · Reads split across threads
   * ------------------------------------------------------------------ */
  const LANES = 6;
  const LANE_X0 = 214;
  const LANE_X1 = 548;
  const laneY = (k) => 46 + k * 38;

  function initSpeed(fig) {
    const host = fig.querySelector('[data-cg-speed]');
    if (!host) return;
    const svg = el('svg', { class: 'cg-speed__svg', viewBox: '0 0 720 290', 'aria-hidden': 'true', focusable: 'false' }, host);

    // the FASTQ file
    const file = el('g', { class: 'cg-file', transform: 'translate(22 92)' }, svg);
    el('path', { class: 'cg-file__bg', d: 'M0 0 H58 L78 20 V112 H0 Z' }, file);
    el('path', { class: 'cg-file__edge', d: 'M58 0 V20 H78' }, file);
    for (let j = 0; j < 6; j++) el('line', { class: 'cg-file__line', x1: 12, x2: j % 2 ? 52 : 64, y1: 36 + j * 12, y2: 36 + j * 12 }, file);
    el('text', { class: 'cg-label', x: 39, y: 138, 'text-anchor': 'middle' }, file, 'FASTQ');

    // one lane per thread, fanned out from the file and back into the count
    for (let k = 0; k < LANES; k++) {
      const y = laneY(k);
      el('path', { class: 'cg-fan', d: `M104 148 C150 148 160 ${y} ${LANE_X0 - 8} ${y}` }, svg);
      el('line', { class: 'cg-lane', x1: LANE_X0, x2: LANE_X1, y1: y, y2: y }, svg);
      el('text', { class: 'cg-note', x: LANE_X0, y: y - 9 }, svg, `thread ${k + 1}`);
      el('path', { class: 'cg-fan', d: `M${LANE_X1 + 4} ${y} C${LANE_X1 + 40} ${y} ${LANE_X1 + 30} 148 590 148` }, svg);
    }
    const ticks = [];
    for (let k = 0; k < LANES; k++) {
      for (let j = 0; j < 4; j++) {
        const n = el('rect', { class: 'cg-tick', x: -13, y: laneY(k) - 5, width: 26, height: 10, rx: 3 }, svg);
        ticks.push({ n, ph: (j / 4 + k * 0.137) % 1, v: 0.34 + (k % 3) * 0.035 });
      }
    }

    // the real number
    const res = el('g', { transform: 'translate(596 96)' }, svg);
    el('rect', { class: 'cg-res__bg', width: 116, height: 104, rx: 8 }, res);
    el('text', { class: 'cg-res__n', x: 58, y: 54, 'text-anchor': 'middle' }, res, '2M+');
    el('text', { class: 'cg-note', x: 58, y: 76, 'text-anchor': 'middle' }, res, 'reads per');
    el('text', { class: 'cg-note', x: 58, y: 92, 'text-anchor': 'middle' }, res, 'second');

    let t = 2.6;
    let last = 0;
    let running = !mqReduce.matches;
    let visible = false;
    let raf = 0;
    function draw() {
      for (const { n, ph, v } of ticks) {
        const u = (ph + t * v) % 1;
        const x = LANE_X0 + 10 + u * (LANE_X1 - LANE_X0 - 20);
        n.setAttribute('transform', `translate(${x.toFixed(1)} 0)`);
        n.setAttribute('opacity', Math.min(1, u * 8, (1 - u) * 8).toFixed(2));
      }
    }
    function frame(now) {
      raf = 0;
      if (last) t += Math.min(0.05, (now - last) / 1000);
      last = now;
      draw();
      if (running && visible) raf = requestAnimationFrame(frame);
    }
    function sync() {
      if (running && visible && !raf) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    }
    draw();
    doc.addEventListener('scope:run', (e) => { running = e.detail.running; sync(); });
    new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); sync(); }).observe(host);
  }

  function init() {
    doc.querySelectorAll('[data-scrolly="pipeline"]').forEach(initPipeline);
    doc.querySelectorAll('[data-cg-speed-fig]').forEach(initSpeed);
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})();
