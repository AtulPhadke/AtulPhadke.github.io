/* Atul Phadke · portfolio · MLbroker: the decision loop, told in three steps
 * A camera moves over Atul's drawing of the loop (assets/work/mlbroker/
 * agent-decision-loop.svg) as js/scrolly.js steps through its three nodes:
 *   input     the queue, budgets, job type weights, prices, running jobs,
 *             and the admin's note all feed the Data input node
 *   decision  the brain proposes moves, a code check passes or drops each
 *             one, Kueue sends the rest to cloud or on-prem
 *   feedback  GPU and training stats flow back up to the inputs
 * The overlays are illustrative. They share the page's Pause buttons
 * ([data-run], js/site.js), stop offscreen, and show a finished frame with
 * reduced motion. Art: js/rig-art.js + js/mlbroker-art.js. Colours:
 * css/rig.css + css/mlbroker.css. Without JS the drawing stays static.
 */
(() => {
  'use strict';

  const doc = document;
  const RA = window.RigArt;
  const MA = window.MLArt;
  const S = window.Scrolly;
  if (!RA || !MA || !S) return;

  const NS = 'http://www.w3.org/2000/svg';
  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  const mqWide = matchMedia('(min-width: 60rem)');
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const n1 = (v) => Math.round(v * 10) / 10;

  /* ------------------------------------------------------------------ *
   * DOM helpers
   * ------------------------------------------------------------------ */
  function svg(name, attrs, parent) {
    const n = doc.createElementNS(NS, name);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function html(tag, attrs, parent, str) {
    const n = doc.createElement(tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (str != null) n.textContent = str;
    if (parent) parent.appendChild(n);
    return n;
  }
  function art(markup, attrs, parent) {
    const g = svg('g', attrs, parent);
    g.innerHTML = markup;
    return g;
  }
  function label(parent, x, y, str, cls, attrs) {
    const t = svg('text', { x, y, class: cls, ...(attrs || {}) }, parent);
    t.textContent = str;
    return t;
  }
  const at = (n, x, y, s = 1) => n.setAttribute('transform', s === 1 ? `translate(${n1(x)} ${n1(y)})` : `translate(${n1(x)} ${n1(y)}) scale(${s})`);
  const setText = (n, s) => { if (n.textContent !== s) n.textContent = s; };
  const on = (n, cls, v) => n.classList.toggle(cls, !!v);
  function chip(parent, x, y, str, cls) {
    const g = svg('g', { class: `fx-chip ${cls || ''}` }, parent);
    const w = 12 + str.length * 5.6;
    svg('rect', { x: x - w / 2, y: y - 9, width: w, height: 17, rx: 8.5 }, g);
    const t = label(g, x, y + 3.5, str, '', { 'text-anchor': 'middle' });
    return { g, t };
  }
  function packets(parent, n, state) {
    return Array.from({ length: n }, () => art(MA.art.packet, { class: 'fx-packet', 'data-state': state || 'idle', opacity: 0 }, parent));
  }
  function place(p, q, o) {
    at(p, q[0] - 11, q[1] - 8, 0.85);
    p.setAttribute('opacity', clamp(o, 0, 1).toFixed(2));
  }

  /* A polyline in drawing coordinates, sampled by arc length. */
  function route(pts) {
    const L = [0];
    for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = L[L.length - 1] || 1;
    return (f) => {
      const d = clamp(f, 0, 1) * total;
      let i = 1;
      while (i < L.length - 1 && L[i] < d) i++;
      const k = (d - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1]);
      return [lerp(pts[i - 1][0], pts[i][0], k), lerp(pts[i - 1][1], pts[i][1], k)];
    };
  }

  /* ------------------------------------------------------------------ *
   * Geometry of the drawing (its viewBox is 889 × 777), taken from the
   * Excalidraw source.
   * ------------------------------------------------------------------ */
  const W = 889;
  const H = 777;
  const R = {
    a1: route([[755, 302], [769, 306], [781, 316], [791, 327], [799, 340], [805, 355], [810, 369], [814, 384], [816, 399], [816, 407]]),
    a2: route([[806, 534], [810, 544], [812, 555], [813, 566], [812, 573], [809, 579], [806, 584]]),
    a3: route([[726, 612], [717, 615], [709, 622], [703, 630], [701, 640], [700, 654], [700, 663]]),
    a4: route([[815, 611], [825, 616], [832, 625], [837, 635], [842, 645], [845, 656], [845, 667]]),
    a5: route([[633, 734], [606, 744], [579, 754], [551, 760], [522, 765], [493, 767], [464, 767], [435, 765], [407, 760], [378, 756], [355, 749]]),
    a6: route([[136, 434], [139, 413], [144, 399], [150, 385], [157, 372], [164, 360], [173, 348], [183, 337], [193, 327]]),
  };
  const NODE = { input: [453.5, 328], runtime: [327.5, 551] };

  /* view: what the camera frames. focus: what stays bright (holes must not
   * overlap: the spotlight uses an even-odd fill). at: callout corner. */
  const STEPS = {
    input: { view: [150, -6, 620, 372], focus: [[150, 0, 624, 312], [428, 312, 52, 36]], at: 'bl' },
    decision: { view: [400, 280, 489, 497], focus: [[570, 290, 319, 487]], at: 'tl' },
    feedback: { view: [0, 180, 660, 597], focus: [[14, 440, 204, 162], [0, 602, 346, 175], [224, 530, 128, 72], [346, 724, 300, 53], [120, 316, 92, 124]], at: 'tr' },
  };

  const MOVES = [
    ['Preempt', 'the ablation sweep, after a checkpoint', true],
    ['Distribute', 'Project X training on 8 GPUs, all or nothing', true],
    ['Place', 'Eval 7 on cloud on-demand', false],
    ['Defer', 'Pretraining 2 until spot gets cheaper', true],
    ['Resume', 'the ablation sweep on cloud spot', true],
  ];

  function initLoop(section) {
    const fig = section.querySelector('[data-loop]');
    if (!fig) return;
    const viewEl = fig.querySelector('.loop__view');
    const world = fig.querySelector('.loop__world');
    const coWrap = fig.querySelector('.loop__callouts');
    fig.classList.add('is-live');

    const dimSvg = svg('svg', { class: 'loop__dim', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true', focusable: 'false' }, world);
    const dims = [svg('path', {}, dimSvg), svg('path', {}, dimSvg)];
    let dimI = 0;
    const fx = svg('svg', { class: 'loop__fx', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true', focusable: 'false' }, world);

    const anims = {};
    const groups = {};
    const callouts = {};
    const group = (key) => (groups[key] = svg('g', { class: 'fx' }, fx));
    function callout(key, cls, variant) {
      const c = html('div', { class: `co ${cls}`, 'data-at': STEPS[key].at }, coWrap);
      if (variant != null) {
        const f = svg('svg', { class: 'co__frame', viewBox: '0 0 300 160', preserveAspectRatio: 'none', 'aria-hidden': 'true' }, c);
        svg('rect', { x: 2, y: 2, width: 296, height: 156, rx: 4 }, f);
        f.insertAdjacentHTML('beforeend', MA.art.frame[variant % MA.art.frame.length]);
      }
      callouts[key] = c;
      return c;
    }

    /* ---------- 1 · Data input: every source feeds the node ---------- */
    {
      const g = group('input');
      // the queue: Job 3 drops into the empty slot
      const card = svg('g', {}, g);
      svg('rect', { class: 'fx-card', x: 0, y: 0, width: 81, height: 36, rx: 2 }, card);
      art(MA.art.frame[1], { class: 'fx-frame', transform: 'scale(0.27 0.225)' }, card);
      label(card, 40.5, 22, 'Job 3', 'fx-card-t', { 'text-anchor': 'middle' });
      // financials: spend against the monthly cap (soft cap dashed, hard cap solid)
      svg('rect', { class: 'fx-meter', x: 344, y: 151, width: 96, height: 7, rx: 3.5 }, g);
      const fill = svg('rect', { class: 'fx-meter-fill', x: 344, y: 151, width: 0, height: 7, rx: 3.5 }, g);
      svg('line', { class: 'fx-meter-soft', x1: 344 + 96 * 0.8, x2: 344 + 96 * 0.8, y1: 147, y2: 162 }, g);
      svg('line', { class: 'fx-meter-hard', x1: 440, x2: 440, y1: 146, y2: 163 }, g);
      const spend = label(g, 344, 174, '', 'fx-small');
      // job type weights: the note eases off sweeps
      const C = [256.4, 224.3];
      const RAD = 50.6;
      const base = [0.72, 0.66, 0.5, 0.8, 0.34, 0.46];
      const poly = svg('polygon', { class: 'fx-radar' }, g);
      // live pricing: a ticking spot price on the window's title bar
      const price = chip(g, 489, 191, 'spot $1.24/hr', 'fx-chip--place');
      const series = [1.24, 1.21, 1.18, 1.22, 1.27, 1.19, 1.12, 1.09, 1.14, 1.2, 1.16, 1.11];
      // running experiments: a cursor sweeping the chart
      const cur = svg('line', { class: 'fx-cursor', y1: 166, y2: 262 }, g);
      // everything flows to the Data input node
      const SOURCES = [[572, 96], [392, 84], [256, 224], [456, 228], [659, 214]];
      const routes = SOURCES.map((p) => route([p, [lerp(p[0], NODE.input[0], 0.5), Math.max(p[1], 250) + 20], NODE.input]));
      const flow = packets(g, SOURCES.length, 'pass');
      const ring = svg('circle', { class: 'fx-pulse', cx: NODE.input[0], cy: NODE.input[1], r: 12, opacity: 0 }, g);

      const c = callout('input', 'co--note');
      const q = html('blockquote', {}, c);
      const p = html('p', {}, q);
      const m1 = html('mark', {}, null, 'Push Project X');
      const m2 = html('mark', { class: 'is-down' }, null, 'ease off the ablation sweeps');
      p.append(m1, ' for the Friday demo, ', m2, '.');
      html('footer', {}, c, 'An admin’s note for the week, in plain English');

      const T = 8;
      anims.input = {
        still: 6,
        frame(tt) {
          const t = tt % T;
          const k = easeOut(seg(t, 0.4, 1.1));
          at(card, 532, 121 - (1 - k) * 60);
          card.setAttribute('opacity', (k * (1 - seg(t, 7.4, 7.9))).toFixed(2));
          const f = lerp(0.55, 0.84, ease(seg(t, 0.2, 3)));
          fill.setAttribute('width', n1(96 * f));
          setText(spend, `${Math.round(f * 100)}% of the cap`);
          on(fill, 'is-warn', f >= 0.8);
          on(m1, 'is-on', t > 1.2);
          on(m2, 'is-on', t > 2.2);
          const kk = ease(seg(t, 2.4, 3.4)) * (1 - seg(t, 7.3, 7.9));
          const vals = base.slice();
          vals[3] = lerp(base[3], 0.3, kk);
          poly.setAttribute('points', vals.map((v, i) => {
            const a = -Math.PI / 2 + (i * Math.PI) / 3;
            return `${n1(C[0] + Math.cos(a) * RAD * v)},${n1(C[1] + Math.sin(a) * RAD * v)}`;
          }).join(' '));
          setText(price.t, `spot $${series[Math.floor(tt / 0.9) % series.length].toFixed(2)}/hr`);
          const x = 568 + ((tt / 6) % 1) * 184;
          cur.setAttribute('x1', n1(x));
          cur.setAttribute('x2', n1(x));
          let hit = 0;
          flow.forEach((pk, i) => {
            const t0 = 3.6 + i * 0.4;
            const u = seg(t, t0, t0 + 1);
            place(pk, routes[i](ease(u)), u > 0 && u < 1 ? Math.min(1, u * 6, (1 - u) * 6) : 0);
            if (t > t0 + 0.9 && t < t0 + 1.5) hit = Math.max(hit, 1 - (t - t0 - 0.9) / 0.6);
          });
          ring.setAttribute('r', n1(12 + (1 - hit) * 10));
          ring.setAttribute('opacity', (hit * 0.9).toFixed(2));
        },
      };
    }

    /* ---------- 2 · Decision: propose, check in code, hand to Kueue ---------- */
    {
      const g = group('decision');
      const inflow = packets(g, 5, 'idle');
      const glow = svg('circle', { class: 'fx-glow', cx: 767, cy: 490, r: 78, opacity: 0 }, g);
      const think = [0, 1, 2].map((i) => svg('circle', { class: 'fx-dot', cx: 836 + i * 9, cy: 424, r: 3, opacity: 0 }, g));
      const shield = art(RA.art.shield, { class: 'shield', 'data-state': 'idle' }, g);
      at(shield, 796, 537);
      const checked = packets(g, MOVES.length, 'idle');
      const out = packets(g, 4, 'pass');
      chip(g, 706, 764, 'cloud');
      chip(g, 830, 764, 'on-prem');

      const c = callout('decision', 'co--moves', 1);
      html('p', { class: 'co__title' }, c, 'Proposed moves');
      const ol = html('ol', { class: 'co__moves' }, c);
      const items = MOVES.map(([verb, what, ok]) => {
        const li = html('li', {}, ol);
        html('b', {}, li, verb);
        html('span', {}, li, what);
        const vd = html('span', { class: 'co__verdict' }, li);
        const s = svg('svg', { viewBox: '0 0 20 20', 'aria-hidden': 'true' }, vd);
        if (ok) s.innerHTML = RA.art.tick;
        else {
          svg('circle', { class: 'co__failc', cx: 10, cy: 10, r: 8.5 }, s);
          art(RA.art.cross, { transform: 'translate(0.4 -0.6) scale(0.6)' }, s);
          html('span', { class: 'co__why' }, li, 'Would cross the hard cap, so it’s dropped');
        }
        return { li, vd, ok };
      });
      html('p', { class: 'co__note' }, c, 'Checked in code: spend cap, quotas, all or nothing, human pins');

      const T = 9.5;
      const CHECK0 = 3;
      const EACH = 0.75;
      const OUT0 = CHECK0 + MOVES.length * EACH + 0.4;
      anims.decision = {
        still: 8.8,
        frame(tt) {
          const t = tt % T;
          inflow.forEach((pk, i) => {
            const u = seg(t, 0.1 + i * 0.18, 0.9 + i * 0.18);
            place(pk, R.a1(ease(u)), u > 0 && u < 1 ? Math.min(1, u * 6, (1 - u) * 4) : 0);
          });
          const thinking = t > 0.9 && t < 2;
          think.forEach((d, i) => d.setAttribute('opacity', thinking ? (0.35 + 0.65 * Math.max(0, Math.sin(tt * 7 - i * 0.9))).toFixed(2) : 0));
          glow.setAttribute('transform', `rotate(${((tt * 24) % 360).toFixed(1)} 767 490)`);
          glow.setAttribute('opacity', (seg(t, 0.6, 1.1) * (thinking ? 0.65 + 0.35 * Math.sin(tt * 5) : 0.5)).toFixed(2));
          let state = 'idle';
          checked.forEach((pk, i) => {
            const t0 = CHECK0 + i * EACH;
            const ok = MOVES[i][2];
            const a = seg(t, t0, t0 + 0.35);
            const b = seg(t, t0 + 0.45, t0 + 0.8);
            let q;
            let o = 1;
            if (t < t0) o = 0;
            if (b <= 0) q = [lerp(806, 812, a), lerp(532, 552, ease(a))];
            else if (ok) { q = R.a2(0.45 + b * 0.55); o = 1 - seg(b, 0.6, 1); } else { q = [812 - b * 40, 552 + b * b * 30]; o = 1 - b; }
            place(pk, q, o);
            pk.setAttribute('data-state', t > t0 + 0.35 ? (ok ? 'pass' : 'fail') : 'idle');
            if (t > t0 + 0.3 && t < t0 + 0.8) state = ok ? 'pass' : 'fail';
            const shown = t > t0 + 0.4;
            items[i].vd.style.opacity = shown ? '1' : '0';
            on(items[i].li, 'is-fail', shown && !ok);
          });
          shield.setAttribute('data-state', state);
          out.forEach((pk, i) => {
            const u = seg(t, OUT0 + i * 0.3, OUT0 + 1 + i * 0.3);
            place(pk, (i % 2 ? R.a4 : R.a3)(ease(u)), u > 0 && u < 1 ? Math.min(1, u * 6, (1 - u) * 5) : 0);
          });
        },
      };
    }

    /* ---------- 3 · Runtime feedback: stats flow back to the inputs ---------- */
    {
      const g = group('feedback');
      const down = packets(g, 2, 'pass');
      const leds = [100, 208, 319].map((x, i) => svg('circle', { class: `fx-led${i === 1 ? ' is-bad' : ''}`, cx: x, cy: 680, r: 3.6 }, g));
      const bad = chip(g, 166, 607, 'spot, interrupted', 'fx-chip--bad');
      const cur = svg('line', { class: 'fx-cursor', y1: 454, y2: 548 }, g);
      const up = packets(g, 2, 'pass');
      const ring = svg('circle', { class: 'fx-pulse', cx: NODE.runtime[0], cy: NODE.runtime[1], r: 13, opacity: 0 }, g);

      const c = callout('feedback', 'co--stats', 2);
      html('p', { class: 'co__title' }, c, 'Coming back');
      const rows = html('div', { class: 'co__rows' }, c);
      const row = (k) => {
        const r = html('div', { class: 'co__row' }, rows);
        html('span', {}, r, k);
        return html('b', {}, r, '');
      };
      const s1 = row('Server 1');
      const s2 = row('Server 2');
      const s3 = row('Server 3');
      on(s2, 'is-bad', true);
      setText(s2, 'interrupted, requeued');
      const tr = row('Project X training');
      const sp = svg('svg', { class: 'co__spark', viewBox: '0 0 240 44', preserveAspectRatio: 'none', 'aria-hidden': 'true' }, c);
      svg('line', { class: 'sp-axis', x1: 0, x2: 240, y1: 43, y2: 43 }, sp);
      const line = svg('path', { class: 'sp-line' }, sp);
      const dot = svg('circle', { class: 'sp-dot', r: 3.5 }, sp);
      const lossAt = (f) => 2.4 * Math.exp(-2.6 * f) + 0.42 + 0.05 * Math.sin(f * 40);
      const ly = (f) => 42 - ((lossAt(f) - 0.3) / 2.6) * 40;

      anims.feedback = {
        still: 1.2,
        frame(t) {
          setText(s1, `util ${90 + Math.round(Math.sin(t * 0.9) * 4)}%, mem ${70 + Math.round(Math.sin(t * 0.6 + 1) * 5)}%`);
          setText(s3, `util ${86 + Math.round(Math.sin(t * 0.8 + 2) * 5)}%, mem ${62 + Math.round(Math.sin(t * 0.5) * 4)}%`);
          const f = 0.12 + ((t / 10) % 1) * 0.88;
          setText(tr, `step ${(Math.round(f * 100) * 100).toLocaleString('en-US')} of 10,000`);
          const N = Math.max(2, Math.round(f * 60));
          let d = '';
          for (let i = 0; i <= N; i++) d += `${i ? 'L' : 'M'}${n1((i / 60) * 240)} ${n1(ly(i / 60))}`;
          line.setAttribute('d', d);
          dot.setAttribute('cx', n1((N / 60) * 240));
          dot.setAttribute('cy', n1(ly(N / 60)));
          leds.forEach((l, i) => l.setAttribute('opacity', i === 1 ? (0.5 + 0.5 * Math.abs(Math.sin(t * 2.4))).toFixed(2) : ((t * 1.3 + i * 0.37) % 1) < 0.6 ? 1 : 0.3));
          bad.g.setAttribute('opacity', (0.75 + 0.25 * Math.sin(t * 2.4)).toFixed(2));
          const x = 26 + ((t / 6) % 1) * 182;
          cur.setAttribute('x1', n1(x));
          cur.setAttribute('x2', n1(x));
          down.forEach((pk, i) => {
            const u = ((t / 2.4) + i * 0.5) % 1;
            place(pk, R.a5(ease(u)), Math.min(1, (1 - u) * 5, u * 8));
          });
          up.forEach((pk, i) => {
            const u = ((t / 2.4) + i * 0.5 + 0.25) % 1;
            place(pk, R.a6(ease(u)), Math.min(1, (1 - u) * 5, u * 8));
          });
          const ph = (t % 1.6) / 1.6;
          ring.setAttribute('r', n1(13 + ph * 12));
          ring.setAttribute('opacity', (0.9 * (1 - ph)).toFixed(2));
        },
      };
    }

    /* ---------- camera + spotlight ---------- */
    let cur = null;
    function holes(focus) {
      let d = `M-600 -600 H${W + 600} V${H + 600} H-600 Z`;
      for (const [x, y, w, h] of focus) {
        const r = Math.min(14, w / 4, h / 4);
        d += ` M${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`;
      }
      return d;
    }
    function camera(key, instant) {
      const st = STEPS[key];
      const vw = viewEl.clientWidth;
      const vh = viewEl.clientHeight;
      if (!st || !vw || !vh) return;
      let [x, y, w, h] = st.view;
      if (!mqWide.matches) {
        // narrow: no callouts (css/mlbroker.css), so frame the main focus itself
        const f = st.focus[0];
        x = f[0] - 20; w = f[2] + 40;
        y = f[1] - 20; h = f[3] + 40;
      }
      const k = Math.min(vw / w, vh / h);
      const ww = vw / k;
      const wh = vh / k;
      const M = 16;
      let left = x + w / 2 - ww / 2;
      let top = y + h / 2 - wh / 2;
      left = ww >= W + M * 2 ? (W - ww) / 2 : clamp(left, -M, W + M - ww);
      top = wh >= H + M * 2 ? (H - wh) / 2 : clamp(top, -M, H + M - wh);
      if (instant) fig.classList.remove('is-moving');
      world.style.transform = `translate(${(-left * k).toFixed(1)}px, ${(-top * k).toFixed(1)}px) scale(${k.toFixed(4)})`;
      if (instant) { void world.offsetWidth; fig.classList.add('is-moving'); }
    }
    function spotlight(key) {
      const next = dims[dimI ^ 1];
      dims[dimI].classList.remove('is-on');
      next.setAttribute('d', holes(STEPS[key].focus));
      next.classList.add('is-on');
      dimI ^= 1;
    }

    /* ---------- local time per step; paused or reduced motion draws `still` ---------- */
    let running = (() => { const b = doc.querySelector('[data-run]'); return b ? b.dataset.state !== 'stopped' : !mqReduce.matches; })();
    let t = 0;
    let visible = false;
    let raf = 0;
    let last = 0;
    const draw = () => { if (cur && anims[cur]) anims[cur].frame(t); };
    function frame(now) {
      raf = 0;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      t += dt;
      draw();
      request();
    }
    function request() {
      if (raf) return;
      if (!running || !visible || doc.hidden) { last = 0; return; }
      raf = requestAnimationFrame(frame);
    }
    function setStep(key) {
      if (key === cur) return;
      const first = cur === null;
      cur = key;
      for (const k in groups) on(groups[k], 'is-on', k === key);
      for (const k in callouts) on(callouts[k], 'is-on', k === key);
      camera(key, first);
      spotlight(key);
      t = running ? 0 : anims[key].still;
      draw();
      request();
    }

    S.onStep(section, ({ name }) => setStep(STEPS[name] ? name : 'input'));
    doc.addEventListener('scope:run', (e) => {
      running = !!(e.detail && e.detail.running);
      if (!running && mqReduce.matches && cur) { t = anims[cur].still; draw(); }
      request();
    });
    new IntersectionObserver(([en]) => { visible = en.isIntersecting; request(); }, { rootMargin: '10% 0px' }).observe(section);
    doc.addEventListener('visibilitychange', request);
    const relayout = () => { if (cur) camera(cur, true); };
    window.addEventListener('resize', relayout);
    if ('ResizeObserver' in window) new ResizeObserver(relayout).observe(viewEl);
  }

  function init() {
    const sec = doc.querySelector('[data-scrolly="loop"]');
    if (sec) initLoop(sec);
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})();
