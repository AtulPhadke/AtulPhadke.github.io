/* LC-MS featurization page · vanilla, no dependencies.
 * Everything draws simulated data from a seeded PRNG: the textbook picture of
 * the problem, not the algorithm Atul wrote.
 *   [data-lcms-xic]     the one scroll-driven scene (js/scrolly.js supplies the
 *                       four steps). A peak draws in, its isotope copies rise
 *                       behind it to make a feature, then MZmine's pass and
 *                       ours sweep the whole run. It draws the frame for
 *                       u = active step + progress through it, so scrolling
 *                       scrubs both ways; a short rAF chase smooths jumps, and
 *                       with reduced motion u snaps to each step's last frame.
 *   [data-lcms-link]    three MS2 spectra linking (or not) to MS1 features;
 *                       plays once when seen, Replay starts it over.
 * Colours come from tokens.css via getComputedStyle; oklch() is converted to
 * sRGB here so alpha variants work in every canvas implementation.
 */
(() => {
  'use strict';

  const doc = document;
  const root = doc.documentElement;
  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  const ISO = 1.00336; // 13C minus 12C, in Da
  const REST = 0.999;  // u offset of a step's finished frame
  const TAU = Math.PI * 2;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const easeInOut = (t) => {
    t = clamp(t, 0, 1);
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };

  /* ------------------------------------------------------------------ *
   * Colour: tokens to [r, g, b, a]
   * ------------------------------------------------------------------ */
  function oklchToRgb(L, Cc, H) {
    const h = (H * Math.PI) / 180;
    const a = Cc * Math.cos(h);
    const b = Cc * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ].map((x) => {
      const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
      return Math.round(clamp(v, 0, 1) * 255);
    });
  }

  let probe = null;
  function parseColor(str) {
    const s = (str || '').trim();
    const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/i.exec(s);
    if (m) {
      const L = parseFloat(m[1]) / (m[2] ? 100 : 1);
      const alpha = m[5] == null ? 1 : parseFloat(m[5]) / (m[6] ? 100 : 1);
      return [...oklchToRgb(L, parseFloat(m[3]), parseFloat(m[4])), alpha];
    }
    // Anything else: let a 1x1 canvas parse it and read the pixel back.
    if (!probe) {
      const c = doc.createElement('canvas');
      c.width = c.height = 1;
      probe = c.getContext('2d', { willReadFrequently: true });
    }
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = 'transparent';
    if (s) probe.fillStyle = s; // an unparseable value leaves it transparent
    probe.fillRect(0, 0, 1, 1);
    const d = probe.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  }

  const TOKENS = {
    ch1: '--color-ch1', ch1ink: '--color-ch1-ink', ch2: '--color-ch2', ch2ink: '--color-ch2-ink',
    ink: '--color-ink', ink2: '--color-ink-2', muted: '--color-muted',
    rule: '--color-rule', rule2: '--color-rule-2',
    paper: '--color-paper', paper2: '--color-paper-2', paper3: '--color-paper-3',
    amberFill: '--color-ill-amber-fill', pinkFill: '--color-ill-pink-fill',
  };
  const C = {};
  function readPalette() {
    const cs = getComputedStyle(root);
    for (const k in TOKENS) C[k] = parseColor(cs.getPropertyValue(TOKENS[k]));
  }
  const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${Math.round(clamp(a * c[3], 0, 1) * 1000) / 1000})`;

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
  function gauss(rnd) {
    let u = 0;
    while (!u) u = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
  }

  /* ------------------------------------------------------------------ *
   * Drawing helpers
   * ------------------------------------------------------------------ */
  // Snap a CSS-px coordinate so a 1 CSS px line lands on whole device pixels.
  const crisp = (v, dpr) => (Math.round(v * dpr) + (Math.round(dpr) % 2 ? 0.5 : 0)) / dpr;

  function rrect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function range(a, b, step) {
    const out = [];
    for (let k = 0; ; k++) {
      const v = a + k * step;
      if (v > b + 1e-9) break;
      out.push(Math.round(v * 1e6) / 1e6);
    }
    return out;
  }

  // A rounded-rect outline as points about 8 px apart, for hand-drawn strokes.
  function loopPts(x, y, w, h, r) {
    const pts = [];
    const line = (x0, y0, x1, y1) => {
      const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 8));
      for (let i = 0; i < n; i++) pts.push([lerp(x0, x1, i / n), lerp(y0, y1, i / n)]);
    };
    const arc = (cx, cy, a0) => {
      for (let i = 0; i < 5; i++) {
        const a = a0 + (i / 5) * (Math.PI / 2);
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
    };
    line(x + r, y, x + w - r, y);
    arc(x + w - r, y + r, -Math.PI / 2);
    line(x + w, y + r, x + w, y + h - r);
    arc(x + w - r, y + h - r, 0);
    line(x + w - r, y + h, x + r, y + h);
    arc(x + r, y + h - r, Math.PI / 2);
    line(x, y + h - r, x, y + r);
    arc(x + r, y + r, Math.PI);
    pts.push([x + r + 6, y]); // overshoot the start a little, as a pen does
    return pts;
  }

  // Ink a point path like a pen going round twice: two passes with a slow,
  // seeded wobble, each drawn p of the way along. Holds still between frames.
  function sketch(ctx, pts, p, seed, col, lw, a = 1) {
    if (p <= 0 || a <= 0 || pts.length < 2) return;
    const n = pts.length - 1;
    const end = clamp(p, 0, 1) * n;
    const stop = Math.floor(end);
    for (let pass = 0; pass < 2; pass++) {
      const r = mulberry32(seed * 7 + pass * 131);
      const f1 = 0.19 + r() * 0.1, f2 = 0.06 + r() * 0.04, p1 = r() * TAU, p2 = r() * TAU;
      const amp = pass ? 1.2 : 0.8;
      ctx.beginPath();
      for (let i = 0; i <= Math.min(n, stop + 1); i++) {
        let x = pts[i][0], y = pts[i][1];
        if (i > stop) {
          const f = end - stop;
          x = lerp(pts[stop][0], x, f);
          y = lerp(pts[stop][1], y, f);
        }
        const j = Math.min(n, i + 1), k = Math.max(0, i - 1);
        const nx = -(pts[j][1] - pts[k][1]), ny = pts[j][0] - pts[k][0];
        const nl = Math.hypot(nx, ny) || 1;
        const o = amp * (Math.sin(i * f1 + p1) + 0.6 * Math.sin(i * f2 + p2));
        x += (nx / nl) * o;
        y += (ny / nl) * o;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(col, a * (pass ? 0.7 : 1));
      ctx.lineWidth = pass ? lw * 0.65 : lw;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }

  function marker(ctx, x, y, col, p) {
    if (p <= 0) return;
    ctx.globalAlpha = clamp(p, 0, 1);
    ctx.beginPath();
    ctx.arc(x, y, 5 * (0.6 + 0.4 * p), 0, TAU);
    ctx.fillStyle = rgba(C.paper);
    ctx.fill();
    ctx.strokeStyle = rgba(col);
    ctx.lineWidth = 1.75;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, TAU);
    ctx.fillStyle = rgba(col);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Elution profile: a gaussian with a slightly longer right tail, as real peaks have.
  function elution(f, rt) {
    const d = rt - f.rt;
    const s = d < 0 ? f.sd : f.sd * f.tail;
    return Math.exp(-0.5 * (d / s) * (d / s));
  }

  // One scan column of feature signal, in device pixels. Each isotope gets a
  // soft wide glow and a crisp core whose height follows the elution curve,
  // so a run of columns builds a small oval.
  function paintFeatures(g, feats, rt, x0, cw, yOf, hk) {
    for (const f of feats) {
      const e = elution(f, rt);
      if (e < 0.012) continue;
      const hc = (0.9 + 2.3 * Math.sqrt(e)) * hk;
      for (let j = 0; j < f.iso.length; j++) {
        const I = f.amp * f.iso[j] * e;
        const y = yOf(f.mz + j * ISO);
        g.fillStyle = rgba(C.ink2, 0.05 * Math.sqrt(I));
        g.fillRect(x0, y - hc * 2.2, cw, hc * 4.4);
        g.fillStyle = rgba(C.ink2, Math.min(0.9, 0.06 + 0.85 * Math.pow(I, 0.7)));
        g.fillRect(x0, y - hc, cw, hc * 2);
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * HTML labels over a canvas (real Recursive Mono, no canvas text)
   * ------------------------------------------------------------------ */
  function span(parent, cls, text) {
    const e = doc.createElement('span');
    e.className = cls;
    if (text != null) e.textContent = text;
    e.style.visibility = 'hidden';
    e._o = 0;
    parent.appendChild(e);
    return e;
  }
  // Place a label at (x, y) CSS px with opacity a; skips writes that change nothing.
  function put(e, x, y, a = 1) {
    const o = a <= 0.01 ? 0 : Math.round(Math.min(1, a) * 100) / 100;
    if (e._o !== o) {
      e._o = o;
      e.style.opacity = String(o);
      e.style.visibility = o ? '' : 'hidden';
    }
    if (!o) return;
    const l = Math.round(x), t = Math.round(y);
    if (e._l !== l) { e._l = l; e.style.left = `${l}px`; }
    if (e._t !== t) { e._t = t; e.style.top = `${t}px`; }
  }
  function setText(e, s) {
    if (e._s === s) return false;
    e._s = s;
    e.textContent = s;
    return true;
  }
  // Static labels for a layer that is rebuilt on every layout.
  function labeller(container) {
    const frag = doc.createDocumentFragment();
    return {
      add(cls, text, css) {
        const el = doc.createElement('span');
        el.className = `lcms-tick ${cls}`;
        el.textContent = text;
        for (const k in css) el.style[k] = typeof css[k] === 'number' ? `${Math.round(css[k])}px` : css[k];
        frag.appendChild(el);
        return el;
      },
      commit() { container.replaceChildren(frag); },
    };
  }

  /* ------------------------------------------------------------------ *
   * Stage: canvases sized to the frame at up to 2x device pixels
   * ------------------------------------------------------------------ */
  function stage(frame, canvases, onLayout) {
    const s = { w: 0, h: 0, dpr: 1 };
    const measure = (force) => {
      const w = Math.max(1, frame.clientWidth);
      const h = Math.max(1, frame.clientHeight);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (!force && w === s.w && h === s.h && dpr === s.dpr) return;
      s.w = w; s.h = h; s.dpr = dpr;
      for (const c of canvases) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      onLayout(s);
    };
    let pending = 0;
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => {
        if (!pending) pending = requestAnimationFrame(() => { pending = 0; measure(false); });
      }).observe(frame);
    } else {
      window.addEventListener('resize', () => measure(false));
    }
    measure(true);
    // label widths change once Recursive arrives
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(() => measure(true));
    return s;
  }

  /* ------------------------------------------------------------------ *
   * Scrubbing: u = active step + progress through it, chased by a short
   * rAF loop that stops as soon as it arrives. The engine only reports
   * while the scene is near the viewport, so offscreen scenes sit idle.
   * ------------------------------------------------------------------ */
  function scrub(section, count, apply) {
    let target = -1, cur = -1, raf = 0, last = 0, dog = 0;
    function snap() {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      cur = target;
      apply(cur);
    }
    // If frames stall (a throttled tab), land on the target instead of freezing mid-way.
    function watch() {
      clearTimeout(dog);
      dog = setTimeout(() => {
        if (cur === target) return;
        if (performance.now() - last > 200) snap();
        else watch();
      }, 250);
    }
    function frame(now) {
      raf = 0;
      // real elapsed time, so a late frame still catches up
      const dt = clamp((now - last) / 1000, 0.001, 0.5);
      last = now;
      const gap = target - cur;
      cur = Math.abs(gap) < 0.0015 ? target : cur + gap * (1 - Math.exp(-dt * 9));
      apply(cur);
      if (cur !== target) raf = requestAnimationFrame(frame);
    }
    function set(u) {
      if (u === target) return;
      target = u;
      if (cur < 0 || mqReduce.matches || doc.hidden) { snap(); return; }
      // a long jump (a link, the End key) skips ahead instead of fast-forwarding
      if (Math.abs(u - cur) > 1.5) cur = u - Math.sign(u - cur) * 0.5;
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
      watch();
    }
    function read(d) {
      const i = clamp(d.index | 0, 0, count - 1);
      set(mqReduce.matches ? i + REST : i + clamp(d.stepP || 0, 0, 1));
    }
    if (window.Scrolly) {
      Scrolly.onProgress(section, read);
      mqReduce.addEventListener('change', () => { target = -2; read(Scrolly.get(section)); });
    } else {
      set(count - 1 + REST); // no engine: show the finished story
    }
  }

  /* ------------------------------------------------------------------ *
   * 1. The XIC scene
   * ------------------------------------------------------------------ */
  function initXic(section) {
    const frame = section.querySelector('.lcms-frame');
    if (!frame) return;
    const canvas = doc.createElement('canvas');
    canvas.className = 'lcms-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    const layer = doc.createElement('div');
    layer.className = 'lcms-axes';
    layer.setAttribute('aria-hidden', 'true');
    frame.prepend(canvas, layer);
    const ctx = canvas.getContext('2d');

    /* ---------- simulated data ---------- */
    const RT0 = 2, RT1 = 13.2, SPAN = RT1 - RT0, DT = 0.015;
    const N = Math.round(SPAN / DT) + 1;

    // kind null: a clear peak a standard pass picks up. Otherwise, why it gets
    // missed. `sparse` peaks keep their label when the plot is too tight for all.
    const P_ = (rt, amp, sd, tail, kind = null, o = {}) => ({ rt, amp, sd, tail, kind, ...o });
    const feats = [
      P_(2.75, 0.06, 0.09, 1.2, 'low intensity'),
      P_(3.6, 0.64, 0.12, 1.3),
      P_(4.8, 0.075, 0.1, 1.2, 'low intensity'),
      P_(6.0, 1.0, 0.13, 1.35),
      P_(6.4, 0.34, 0.11, 1.2, 'shoulder', { side: 'right', sparse: true }),
      P_(8.2, 0.52, 0.12, 1.25),
      P_(8.55, 0.44, 0.12, 1.25, 'co-eluting', { side: 'right', sparse: true }),
      P_(9.5, 0.065, 0.1, 1.2, 'low intensity'),
      P_(10.7, 0.76, 0.12, 1.3),
      P_(11.8, 0.07, 0.1, 1.2, 'low intensity'),
      P_(12.7, 0.34, 0.12, 1.3),
    ];
    const F0 = feats[1]; // the peak the story starts on
    const shape = (f, t) => f.amp * elution(f, t);
    // baseline drifts up slowly over the run, with a gentle wave
    const baseAt = (t) => 0.032 + (0.026 * (t - RT0)) / SPAN + 0.009 * Math.sin(0.72 * t + 0.6);
    const model = (t) => feats.reduce((a, f) => a + shape(f, t), baseAt(t));

    // Each feature's window is about 2.6 sd each side; where two overlap, the
    // split goes where their contributions cross.
    for (const f of feats) { f.lo = f.rt - 2.6 * f.sd; f.hi = f.rt + 2.6 * f.sd * f.tail; }
    for (let k = 1; k < feats.length; k++) {
      const a = feats[k - 1], b = feats[k];
      if (a.hi <= b.lo) continue;
      let lo = a.rt, hi = b.rt;
      for (let it = 0; it < 40; it++) {
        const m = (lo + hi) / 2;
        if (shape(a, m) > shape(b, m)) lo = m;
        else hi = m;
      }
      a.hi = b.lo = (lo + hi) / 2;
    }

    // One scan every 0.9 s, noise that grows a little with the signal.
    const rnd = mulberry32(760585);
    const raw = new Float32Array(N), sm = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const t = RT0 + i * DT, m = model(t);
      raw[i] = m + gauss(rnd) * (0.008 + 0.006 * Math.sqrt(Math.max(0, m - baseAt(t))));
    }
    for (let i = 0; i < N; i++) {
      let s = 0, w = 0;
      for (let k = -6; k <= 6; k++) {
        const j = i + k;
        if (j < 0 || j >= N) continue;
        const g = Math.exp(-0.5 * (k / 2.2) * (k / 2.2));
        s += raw[j] * g;
        w += g;
      }
      sm[i] = s / w;
    }
    let vmax = 0;
    for (let i = 0; i < N; i++) vmax = Math.max(vmax, raw[i]);
    vmax *= 1.08;
    const idx = (t) => (t - RT0) / DT;
    const at = (arr, t) => {
      const x = clamp(idx(t), 0, N - 1), i = Math.floor(x);
      return i + 1 < N ? lerp(arr[i], arr[i + 1], x - i) : arr[i];
    };

    // The first peak's isotope copies, each its own XIC about 1 Da heavier.
    const ISO_R = [1, 0.47, 0.13];
    const ISO_BASE = 0.022;
    const isoRaw = [raw];
    {
      const r = mulberry32(761588);
      for (let j = 1; j < ISO_R.length; j++) {
        const arr = new Float32Array(N);
        for (let i = 0; i < N; i++) {
          const s = ISO_R[j] * shape(F0, RT0 + i * DT);
          arr[i] = ISO_BASE + s + gauss(r) * (0.005 + 0.005 * Math.sqrt(s));
        }
        isoRaw.push(arr);
      }
    }
    const ISO_LO = 3.1, ISO_HI = 4.15;

    /* ---------- the story, in scroll units ---------- */
    // steps: 0 elute, 1 feature, 2 mzmine, 3 ours
    const STEPS = 4;
    const HEAD0 = 0.45, HEAD1 = 0.88;             // the first peak draws in (stage pinned by now)
    const TILT0 = 1.12, TILT1 = 1.5;              // its isotope copies rise behind it
    const BOX0 = 1.5, BOX1 = 1.86;                // and a box goes round all three
    const FLAT0 = 2.0, FLAT1 = 2.1;               // back to one m/z
    const GROW0 = 2.06, GROW1 = 2.42;             // the view pulls out as the rest of the run draws in
    const SHOW = 2.44;                            // the counters appear
    const B0 = 2.5, B1 = 2.92;                    // MZmine's sweep
    const OUT0 = 3.0, OUT1 = 3.08;                // MZmine's marks give way to ours
    const C0 = 3.1, C1 = 3.5;                     // our sweep, done before the stage unpins
    const POP = 0.04;
    for (const f of feats) {
      f.tB = B0 + ((f.rt - RT0) / SPAN) * (B1 - B0);
      f.tC = C0 + ((f.rt - RT0) / SPAN) * (C1 - C0);
    }

    const V = {
      elute: { a: 2.95, b: 4.45, ym: 1.0 },
      feature: { a: 2.9, b: 5.0, ym: 0.84 },
      full: { a: RT0, b: RT1, ym: vmax },
    };
    const CAM = [[0, V.elute], [1.02, V.elute], [1.25, V.feature], [2.05, V.feature], [2.4, V.full]];
    function camAt(u) {
      if (u <= CAM[0][0]) return CAM[0][1];
      for (let k = 1; k < CAM.length; k++) {
        if (u > CAM[k][0]) continue;
        const [u0, v0] = CAM[k - 1], [u1, v1] = CAM[k];
        if (v0 === v1) return v0;
        const e = easeInOut((u - u0) / (u1 - u0));
        // zoom about a moving centre, width in log space so it feels even
        const c = lerp((v0.a + v0.b) / 2, (v1.a + v1.b) / 2, e);
        const w = Math.exp(lerp(Math.log(v0.b - v0.a), Math.log(v1.b - v1.a), e));
        let a = c - w / 2;
        a = clamp(a, RT0, RT1 - w);
        return { a, b: a + w, ym: lerp(v0.ym, v1.ym, e) };
      }
      return CAM[CAM.length - 1][1];
    }
    // Ions dripping off the column as the first peak draws: emission times
    // follow the signal, so the drip thickens at the apex.
    const FALL = 0.11;
    const rain = [];
    {
      const r = mulberry32(3600);
      const cdf = [];
      let tot = 0;
      for (let t = V.elute.a; t <= V.elute.b; t += 0.004) {
        tot += Math.max(0, model(t) - baseAt(t) * 0.55);
        cdf.push([t, tot]);
      }
      const K = 130;
      let j = 0;
      for (let k = 0; k < K; k++) {
        const q = ((k + r()) / K) * tot;
        while (j < cdf.length - 1 && cdf[j][1] < q) j++;
        rain.push({ rt: cdf[j][0], dx: (r() - 0.5) * 13, r: 1.4 + r() * 1.1 });
      }
    }

    /* ---------- overlays ---------- */
    const title = span(layer, 'lcms-tick lcms-tick--title', 'Simulated XIC at m/z 760.585');
    const yLab = span(layer, 'lcms-tick', 'intensity');
    const colLab = span(layer, 'lcms-tick xic-col', 'column');
    const isoLab = ['m/z 760.585', '+1 Da', '+2 Da'].map((t) => span(layer, 'lcms-tick xic-iso', t));
    const boxLab = span(layer, 'lcms-tick xic-boxlab', 'one feature');
    const tickEls = Array.from({ length: 18 }, () => span(layer, 'lcms-tick lcms-tick--x'));
    const unitLab = span(layer, 'lcms-tick lcms-tick--end', 'min');
    for (const f of feats) f.el = f.kind ? span(layer, 'lcms-tick xic-label', f.kind) : null;
    const cursorEl = span(layer, 'xic-cursor');
    const count = doc.createElement('p');
    count.className = 'xic-count';
    count.innerHTML =
      '<span class="xic-count__item xic-count__item--mz"><span class="xic-key xic-key--mz"></span>MZmine: <b>0</b><span class="xic-count__unit"> features</span></span>' +
      '<span class="xic-count__item xic-count__item--full"><span class="xic-key xic-key--full"></span>Ours: <b>0</b><span class="xic-count__unit"> features</span></span>';
    layer.appendChild(count);
    const [outMz, outFull] = count.querySelectorAll('b');

    /* ---------- layout ---------- */
    let S = null, P = null, narrow = false, sparse = false, DX = 50, DY = 50;
    let cam = V.elute, uNow = 0, mode = '', shown = '';
    const X = (rt) => P.x + ((rt - cam.a) / (cam.b - cam.a)) * P.w;
    const Y = (v) => P.y + P.h - (v / cam.ym) * P.h;

    function layout(s) {
      S = s;
      narrow = s.w < 560;
      const padX = narrow ? 12 : 20;
      P = { x: padX, y: narrow ? 66 : 56, w: s.w - 2 * padX };
      P.h = s.h - P.y - (narrow ? 30 : 36);
      sparse = P.w / SPAN < 52;
      // each copy sits about two peak widths right and a little up, so its
      // apex clears the flank of the one in front
      DX = (0.25 * P.w) / (V.feature.b - V.feature.a);
      DY = clamp(P.h * 0.11, 18, 76);
      put(title, padX, narrow ? 12 : 14);
      put(yLab, P.x + 6, P.y + 4);
      put(unitLab, P.x + P.w, P.y + P.h + 8);
      unitLab._w = unitLab.offsetWidth;
      for (const f of feats) if (f.el) { f.w = f.el.offsetWidth; f.h = f.el.offsetHeight; }
      for (const e of [colLab, boxLab, ...isoLab]) { e._w = e.offsetWidth; e._h = e.offsetHeight; }
      cursorEl._pass = '';
      placeLabels();
      render(uNow);
    }

    // Highest point of the trace (smallest y) between two x positions, in the current view.
    function topPx(x0, x1) {
      const k = (cam.b - cam.a) / P.w;
      const i0 = Math.max(0, Math.floor(idx(cam.a + (x0 - P.x) * k)));
      const i1 = Math.min(N - 1, Math.ceil(idx(cam.a + (x1 - P.x) * k)));
      let v = -Infinity;
      for (let i = i0; i <= i1; i++) v = Math.max(v, raw[i]);
      return Y(v);
    }

    // Full-view labels sit above (or beside) their marker, clear of the trace,
    // the other markers and each other; if there's no room they rise and get a leader.
    function placeLabels() {
      const keep = cam;
      cam = V.full;
      const marks = feats.map((f) => {
        f.mx = X(f.rt);
        f.my = Y(at(sm, f.rt));
        return { f, x0: f.mx - 7, x1: f.mx + 7, y0: f.my - 7, y1: f.my + 7 };
      });
      const hit = (a, b) => a.x0 < b.x1 + 4 && b.x0 < a.x1 + 4 && a.y0 < b.y1 + 3 && b.y0 < a.y1 + 3;
      const placed = [];
      for (const f of feats) {
        if (!f.kind) continue;
        f.lab = null;
        f.show = !sparse || f.sparse;
        if (!f.show) continue;
        const w = f.w, h = f.h;
        const sides = f.side === 'right' ? ['right', 'above', 'left'] : ['above', 'right', 'left'];
        let best = null;
        for (let lift = 0; lift <= 160 && !best; lift += 8) {
          for (const side of sides) {
            let x0 = side === 'above' ? f.mx - w / 2 : side === 'right' ? f.mx + 12 : f.mx - 12 - w;
            x0 = clamp(x0, P.x + 4, P.x + P.w - w - 4);
            const y1 = (side === 'above' ? f.my - 12 : f.my + h / 2) - lift;
            const b = { x0, x1: x0 + w, y0: y1 - h, y1 };
            if (b.y0 < P.y + 3) continue;
            // the middle of the label must clear the trace; its paper
            // background may cover a sliver of a neighbour's flank
            if (topPx(b.x0 + w * 0.22, b.x1 - w * 0.22) < b.y1 + 3) continue;
            if (placed.some((p) => hit(p, b)) || marks.some((m) => m.f !== f && hit(m, b))) continue;
            best = b;
            break;
          }
        }
        if (!best) {
          const x0 = clamp(f.mx - w / 2, P.x + 4, P.x + P.w - w - 4);
          best = { x0, x1: x0 + w, y0: P.y + 3, y1: P.y + 3 + h };
        }
        placed.push(best);
        f.lab = best;
      }
      cam = keep;
    }

    /* ---------- drawing ---------- */
    function tickStep() {
      const ppm = P.w / (cam.b - cam.a);
      const want = narrow ? 46 : 62;
      for (const s of [0.1, 0.2, 0.5, 1, 2]) if (s * ppm >= want) return s;
      return 2;
    }

    function grid(step) {
      const d = S.dpr;
      const minor = [], major = [];
      const half = step / 2;
      for (let v = Math.ceil(cam.a / half - 1e-6) * half; v <= cam.b + 1e-9; v += half) {
        const x = X(v);
        if (x < P.x + 0.5 || x > P.x + P.w - 0.5) continue;
        (Math.abs(v / step - Math.round(v / step)) < 1e-6 ? major : minor).push(x);
      }
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const x of minor) { const c = crisp(x, d); ctx.moveTo(c, P.y); ctx.lineTo(c, P.y + P.h); }
      for (const f of [0.25, 0.75]) { const c = crisp(P.y + P.h - f * P.h, d); ctx.moveTo(P.x, c); ctx.lineTo(P.x + P.w, c); }
      ctx.strokeStyle = rgba(C.rule2);
      ctx.stroke();
      ctx.beginPath();
      for (const x of major) { const c = crisp(x, d); ctx.moveTo(c, P.y); ctx.lineTo(c, P.y + P.h); }
      { const c = crisp(P.y + P.h / 2, d); ctx.moveTo(P.x, c); ctx.lineTo(P.x + P.w, c); }
      ctx.strokeStyle = rgba(C.rule);
      ctx.stroke();
      ctx.strokeRect(crisp(P.x, d), crisp(P.y, d), Math.round(P.w * d) / d, Math.round(P.h * d) / d);
      ctx.beginPath();
      for (const x of major) { const c = crisp(x, d); ctx.moveTo(c, P.y + P.h); ctx.lineTo(c, P.y + P.h + 5); }
      ctx.strokeStyle = rgba(C.muted, 0.75);
      ctx.stroke();
    }

    // Tick labels under the axis; the unit sits at the right end and any
    // tick that would run into it is left out.
    function ticks(step) {
      let k = 0;
      const first = Math.ceil(cam.a / step - 1e-6) * step;
      const room = P.x + P.w - unitLab._w - 14;
      for (let v = first; v <= cam.b + 1e-9 && k < tickEls.length; v += step) {
        const x = X(v);
        const txt = step < 1 ? v.toFixed(1) : String(Math.round(v));
        const half = txt.length * 4.2;
        if (x - half < P.x + 2 || x + half > room) continue;
        const e = tickEls[k++];
        setText(e, txt);
        put(e, x, P.y + P.h + 8, 1);
      }
      for (; k < tickEls.length; k++) put(tickEls[k], 0, 0, 0);
    }

    function linePath(arr, lo, hi) {
      lo = Math.max(lo, cam.a - 0.05, RT0);
      hi = Math.min(hi, cam.b + 0.05, RT1);
      if (hi <= lo) return false;
      const i0 = Math.ceil(idx(lo)), i1 = Math.floor(idx(hi));
      ctx.moveTo(X(lo), Y(at(arr, lo)));
      for (let i = i0; i <= i1; i++) ctx.lineTo(X(RT0 + i * DT), Y(arr[i]));
      ctx.lineTo(X(hi), Y(at(arr, hi)));
      return true;
    }

    function stroke(arr, lo, hi, col, a, lw = 1.4) {
      if (a <= 0) return;
      ctx.beginPath();
      if (!linePath(arr, lo, hi)) return;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = rgba(col, a);
      ctx.lineWidth = lw;
      ctx.stroke();
    }

    // Shaded area between the trace and the baseline, up to tEnd.
    function area(f, tEnd, col, a) {
      const t1 = Math.min(f.hi, tEnd);
      if (t1 <= f.lo || a <= 0 || t1 < cam.a || f.lo > cam.b) return;
      ctx.beginPath();
      ctx.moveTo(X(f.lo), Y(baseAt(f.lo)));
      ctx.lineTo(X(f.lo), Y(at(raw, f.lo)));
      for (let i = Math.ceil(idx(f.lo)); i <= Math.floor(idx(t1)); i++) ctx.lineTo(X(RT0 + i * DT), Y(raw[i]));
      ctx.lineTo(X(t1), Y(at(raw, t1)));
      for (let k = 8; k >= 0; k--) {
        const tt = f.lo + ((t1 - f.lo) * k) / 8;
        ctx.lineTo(X(tt), Y(baseAt(tt)));
      }
      ctx.closePath();
      ctx.fillStyle = rgba(col, a);
      ctx.fill();
    }

    // The isotope copies, back to front, lifted up and right as if the
    // m/z axis ran into the page (the same move as the card sketch).
    function isotopes(tilt) {
      for (let j = ISO_R.length - 1; j >= 1; j--) {
        const ox = j * DX * tilt, oy = -j * DY * tilt;
        ctx.save();
        ctx.translate(ox, oy);
        ctx.beginPath();
        ctx.moveTo(X(ISO_LO), Y(0));
        linePath(isoRaw[j], ISO_LO, ISO_HI);
        ctx.lineTo(X(ISO_HI), Y(0));
        ctx.closePath();
        ctx.fillStyle = rgba(C.paper2, Math.min(1, tilt * 4));
        ctx.fill();
        ctx.fillStyle = rgba(C.ink2, 0.07 * tilt);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(X(ISO_LO), Y(0));
        ctx.lineTo(X(ISO_HI), Y(0));
        ctx.strokeStyle = rgba(C.ink2, 0.35 * tilt);
        ctx.lineWidth = 1;
        ctx.stroke();
        stroke(isoRaw[j], ISO_LO, ISO_HI, C.ink2, (0.9 - 0.2 * j) * tilt, 1.3);
        ctx.restore();
      }
      // receding edges of the floor
      ctx.beginPath();
      for (const t of [ISO_LO, ISO_HI]) {
        ctx.moveTo(X(t), Y(0));
        ctx.lineTo(X(t) + 2 * DX * tilt, Y(0) - 2 * DY * tilt);
      }
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = rgba(C.ink2, 0.45 * tilt);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      // the front copy hides whatever is behind it (opaque early, so the
      // copies never show through it as they rise)
      ctx.beginPath();
      ctx.moveTo(X(ISO_LO), Y(0));
      linePath(raw, ISO_LO, ISO_HI);
      ctx.lineTo(X(ISO_HI), Y(0));
      ctx.closePath();
      ctx.fillStyle = rgba(C.paper2, Math.min(1, tilt * 4));
      ctx.fill();
    }

    function featureBox() {
      const top = Math.min(
        Y(F0.amp + baseAt(F0.rt)),
        ...[1, 2].map((j) => Y(ISO_R[j] * F0.amp + ISO_BASE) - j * DY),
      );
      // wide enough for the +2 Da copy's tail, which runs to ISO_HI
      const x0 = X(F0.lo) - 12, x1 = X(Math.max(F0.hi, ISO_HI)) + 2 * DX + 12;
      const y0 = top - 20, y1 = Y(0) - 6;
      return { x0, y0, x1, y1 };
    }

    function column(x, y, a) {
      // a small LC column riding the time cursor, dripping what elutes now
      if (a <= 0) return y + 50;
      const w = 14, h = 40;
      ctx.globalAlpha = a;
      rrect(ctx, x - w / 2, y, w, h, 4);
      ctx.fillStyle = rgba(C.amberFill);
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.beginPath();
      for (let k = -2; k < 8; k++) {
        ctx.moveTo(x - w / 2, y + k * 7);
        ctx.lineTo(x + w / 2, y + k * 7 - 9);
      }
      ctx.strokeStyle = rgba(C.ink2, 0.35);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      rrect(ctx, x - w / 2, y, w, h, 4);
      ctx.strokeStyle = rgba(C.ink);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 3.5, y + h);
      ctx.lineTo(x + 3.5, y + h);
      ctx.lineTo(x + 1.5, y + h + 6);
      ctx.lineTo(x - 1.5, y + h + 6);
      ctx.closePath();
      ctx.fillStyle = rgba(C.ink);
      ctx.fill();
      ctx.globalAlpha = 1;
      return y + h + 8;
    }

    function leader(mx, my, b, col, a) {
      const px = clamp(mx, b.x0 + 3, b.x1 - 3), py = clamp(my, b.y0, b.y1);
      const dx = px - mx, dy = py - my, len = Math.hypot(dx, dy);
      if (len < 18 || a <= 0) return;
      ctx.beginPath();
      ctx.moveTo(mx + (dx / len) * 7, my + (dy / len) * 7);
      ctx.lineTo(px - (dx / len) * 2, py - (dy / len) * 2);
      ctx.strokeStyle = rgba(col, 0.55 * a);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // A pass's sweep line with a soft band behind it.
    function sweep(rt, col, a) {
      if (a <= 0) return null;
      const x = X(rt);
      const gw = Math.min(40, P.w * 0.04);
      const glow = ctx.createLinearGradient(x - gw, 0, x, 0);
      glow.addColorStop(0, rgba(col, 0));
      glow.addColorStop(1, rgba(col, 0.1 * a));
      ctx.fillStyle = glow;
      ctx.fillRect(x - gw, P.y, gw, P.h);
      ctx.fillStyle = rgba(col, 0.9 * a);
      ctx.fillRect(crisp(x, S.dpr) - 0.75, P.y, 1.5, P.h);
      return { x, a };
    }

    function tag(c, pass) {
      if (!c) { put(cursorEl, 0, 0, 0); return; }
      if (cursorEl._pass !== pass) {
        cursorEl._pass = pass;
        cursorEl.textContent = pass === 'full' ? 'ours' : 'MZmine';
        cursorEl.dataset.pass = pass;
        cursorEl._w = cursorEl.offsetWidth;
      }
      const flip = c.x + 8 + cursorEl._w > P.x + P.w - 4;
      put(cursorEl, flip ? c.x - 8 - cursorEl._w : c.x + 8, P.y + 6, c.a);
    }

    function render(u) {
      uNow = u;
      if (!S) return;
      cam = camAt(u);
      const d = S.dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(d, 0, 0, d, 0, 0);

      const step = tickStep();
      grid(step);
      ticks(step);

      const tilt = easeInOut(seg(u, TILT0, TILT1)) * (1 - easeInOut(seg(u, FLAT0, FLAT1)));
      const grow = seg(u, GROW0, GROW1);
      const head = u < GROW0
        ? lerp(V.elute.a, V.elute.b, seg(u, HEAD0, HEAD1))
        : lerp(V.elute.b, RT1, grow);
      const bv = seg(u, SHOW, SHOW + 0.06) * (1 - seg(u, OUT0, OUT1));
      const pv = seg(u, OUT1 - 0.02, C0 + 0.02);
      const rtB = lerp(RT0, RT1, seg(u, B0, B1));
      const rtC = lerp(RT0, RT1, seg(u, C0, C1));
      const inFull = u > 2.3 ? 1 : 0; // labels only once the view shows the whole run

      ctx.save();
      ctx.beginPath();
      ctx.rect(P.x, P.y, P.w, P.h);
      ctx.clip();
      if (tilt > 0.002) isotopes(tilt);
      for (const f of feats) {
        if (!f.kind && bv > 0 && u > B0) area(f, rtB, C.ch1, 0.2 * bv);
        if (pv > 0 && u > C0) area(f, rtC, C.ch2, 0.24 * pv);
      }
      if (u > HEAD0) stroke(raw, V.elute.a, head, C.ink, 0.85);
      if (grow > 0) stroke(raw, RT0, V.elute.a + DT, C.ink, 0.85 * easeOut(grow));
      ctx.restore();

      // the pen: a dot at the head of the trace while it draws
      const drawing = (u > HEAD0 && u < HEAD1) || (u > GROW0 && u < GROW1);
      const hx = X(head);
      if (drawing && hx >= P.x && hx <= P.x + P.w) {
        const hy = Y(at(raw, head));
        ctx.beginPath();
        ctx.arc(hx, hy, 6, 0, TAU);
        ctx.fillStyle = rgba(C.ink, 0.12);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(hx, hy, 2.5, 0, TAU);
        ctx.fillStyle = rgba(C.ink);
        ctx.fill();
      }

      // step 0: the column rides the time cursor and drips ions onto the trace
      const colA = 1 - seg(u, 0.97, 1.06);
      if (colA > 0) {
        const cx = X(Math.min(head, V.elute.b));
        const tipY = column(cx, P.y + 8, colA);
        put(colLab, cx + 12, P.y + 28, colA);
        // a stream from the tip down to the pen: thick at the apex, thin in the tails
        const hd = u > HEAD0 && u < HEAD1 + 0.02 ? head : -1;
        const hy = Y(at(raw, Math.min(head, V.elute.b)));
        ctx.fillStyle = rgba(C.ink, 0.8 * colA);
        for (const r of rain) {
          if (hd < r.rt || hd > r.rt + FALL) continue;
          const q = (hd - r.rt) / FALL;
          const y = lerp(tipY, hy - 4, q);
          if (y > hy - 4) continue;
          ctx.globalAlpha = q < 0.1 ? q / 0.1 : 1;
          ctx.beginPath();
          ctx.arc(cx + r.dx * (0.2 + 0.8 * q), y, r.r, 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else {
        put(colLab, 0, 0, 0);
      }

      // step 1: one feature is the peak plus its isotope copies, boxed as one
      const boxP = easeInOut(seg(u, BOX0, BOX1));
      const boxA = 1 - seg(u, FLAT0, FLAT1);
      const labA = seg(tilt, 0.6, 1);
      if (tilt > 0.002) {
        // each copy is named beside its apex: the front one on the left, the
        // copies on their right, where the next ridge is still low
        for (let j = 0; j < ISO_R.length; j++) {
          const e = isoLab[j];
          const ax = X(F0.rt) + j * DX * tilt;
          const ay = Y(ISO_R[j] * F0.amp + (j ? ISO_BASE : baseAt(F0.rt))) - j * DY * tilt;
          if (j) put(e, ax + 14, ay - e._h - 4, labA);
          else put(e, ax - e._w - 22, ay - e._h / 2, labA);
        }
      } else {
        for (const e of isoLab) put(e, 0, 0, 0);
      }
      if (boxP > 0 && boxA > 0) {
        const b = featureBox();
        const pts = loopPts(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 14);
        rrect(ctx, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 14);
        ctx.fillStyle = rgba(C.ch2, 0.05 * seg(boxP, 0.8, 1) * boxA);
        ctx.fill();
        sketch(ctx, pts, boxP, 11, C.ch2, 2.4, boxA);
        put(boxLab, b.x0 + 4, b.y0 - boxLab._h - 4, seg(boxP, 0.7, 1) * boxA);
      } else {
        put(boxLab, 0, 0, 0);
      }

      // steps 2 and 3: the two passes
      for (const f of feats) {
        const mx = X(f.rt);
        if (mx < P.x - 6 || mx > P.x + P.w + 6) continue;
        const my = Y(at(sm, f.rt));
        if (my < P.y + 2) continue; // above the view while the camera zooms
        if (!f.kind && bv > 0) marker(ctx, mx, my, C.ch1ink, easeOut(seg(u, f.tB, f.tB + POP)) * bv);
        const p = easeOut(seg(u, f.tC, f.tC + POP)) * pv;
        if (p > 0) {
          if (f.kind && f.lab && inFull > 0) leader(f.mx, f.my, f.lab, C.ch2ink, p * inFull);
          marker(ctx, mx, my, C.ch2ink, p);
        }
      }
      for (const f of feats) {
        if (!f.el) continue;
        const a = f.show && f.lab && u >= f.tC + 0.02 ? pv * inFull : 0;
        if (a > 0) put(f.el, f.lab.x0, f.lab.y0, a);
        else put(f.el, 0, 0, 0);
      }
      const aB = (u > B0 && u < B1 + 0.04 ? 1 - seg(u, B1, B1 + 0.04) : 0) * bv;
      const aC = (u > C0 && u < C1 + 0.04 ? 1 - seg(u, C1, C1 + 0.04) : 0) * pv;
      const cb = sweep(rtB, C.ch1, aB);
      const cc = sweep(rtC, C.ch2, aC);
      tag(cc || cb, cc ? 'full' : 'mz');

      // counters
      const m = u < SHOW ? 'none' : u < OUT0 + 0.06 ? 'mzmine' : 'ours';
      if (m !== mode) { mode = m; frame.dataset.mode = m; }
      const nMz = feats.filter((f) => !f.kind && u >= f.tB).length;
      const nFull = feats.filter((f) => u >= f.tC).length;
      const key = `${nMz}/${nFull}`;
      if (key !== shown) {
        shown = key;
        outMz.textContent = String(nMz);
        outFull.textContent = String(nFull);
      }
    }

    scrub(section, STEPS, render);
    stage(frame, [canvas], layout);
  }

  /* ------------------------------------------------------------------ *
   * Self-playing figures: a rAF loop that runs only while wanted, on
   * screen, and in a visible tab. onSee fires once, when 40% is in view.
   * ------------------------------------------------------------------ */
  function motion(el, tick, onSee) {
    const m = { want: false, inView: false, seen: false, raf: 0, last: 0, active: false };
    function frame(now) {
      m.raf = 0;
      const dt = Math.min(0.05, Math.max(0, (now - m.last) / 1000));
      m.last = now;
      if (tick(dt) === false) m.want = false;
      m.sync();
    }
    m.sync = () => {
      const go = m.want && m.inView && !doc.hidden;
      if (go && !m.raf) {
        if (!m.active) m.last = performance.now();
        m.raf = requestAnimationFrame(frame);
      } else if (!go && m.raf) {
        cancelAnimationFrame(m.raf);
        m.raf = 0;
      }
      m.active = go;
    };
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        for (const e of entries) {
          m.inView = e.isIntersecting;
          if (!m.seen && e.isIntersecting && e.intersectionRatio >= 0.399) {
            m.seen = true;
            onSee();
          }
        }
        m.sync();
      }, { threshold: [0, 0.4] }).observe(el);
    } else {
      m.inView = true;
      m.seen = true;
      setTimeout(() => { onSee(); m.sync(); });
    }
    doc.addEventListener('visibilitychange', m.sync);
    return m;
  }

  // Canvas plus a label layer, prepended to a figure's frame.
  function surface(frame) {
    const canvas = doc.createElement('canvas');
    canvas.className = 'lcms-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    const layer = doc.createElement('div');
    layer.className = 'lcms-axes';
    layer.setAttribute('aria-hidden', 'true');
    frame.prepend(canvas, layer);
    return { canvas, layer, ctx: canvas.getContext('2d'), wrap: frame };
  }

  // Play a view once when it comes into view; Replay (if any) starts it over.
  // With reduced motion it shows the finished frame and Replay does the same.
  function playOnce(fig, view) {
    const frame = view.sl.wrap;
    const btn = fig.querySelector('[data-replay]');
    let t = mqReduce.matches ? view.END : 0;
    stage(frame, [view.sl.canvas], (s) => { view.layout(s); view.render(t); });
    const mo = motion(frame, (dt) => {
      t = Math.min(view.END, t + dt);
      view.render(t);
      return t < view.END;
    }, () => { if (!mqReduce.matches) mo.want = true; });
    if (btn) {
      btn.addEventListener('click', () => {
        t = mqReduce.matches ? view.END : 0;
        view.render(t);
        mo.want = !mqReduce.matches;
        mo.sync();
      });
    }
    mqReduce.addEventListener('change', () => {
      if (!mqReduce.matches) return;
      t = view.END;
      mo.want = false;
      mo.sync();
      view.render(t);
    });
  }

  /* ------------------------------------------------------------------ *
   * 2. MS2 spectra and the MS1 features they link to
   * ------------------------------------------------------------------ */
  function mapView(sl) {
    const RT0 = 7.2, RT1 = 7.8, MZ0 = 754, MZ1 = 772;
    const F = (mz, rt, sd, amp, iso) => {
      const f = { mz, rt, sd, tail: 1.3, amp, iso };
      f.lo = rt - 2.4 * sd;
      f.hi = rt + 2.4 * sd * f.tail;
      f.top = mz + (iso.length - 1) * ISO;
      return f;
    };
    // Targets run top to bottom in the same order as the spectra, so no two
    // connectors cross: a (linked) high, b (orphan) middle, c (two candidates) low.
    const A = F(767.42, 7.36, 0.026, 0.92, [1, 0.48, 0.14]);
    const B = F(757.21, 7.5, 0.022, 0.8, [1, 0.47, 0.13]);
    const Cf = F(757.21, 7.6, 0.024, 0.64, [1, 0.47, 0.13]);
    const D = F(763.05, 7.27, 0.022, 0.46, [1, 0.45]);
    const E = F(754.95, 7.73, 0.022, 0.42, [1, 0.45]);
    const feats = [A, B, Cf, D, E];

    const cases = [
      { key: 'a', out: 'linked', say: 'linked', rt: 7.366, mz: A.mz, hits: [A] },
      { key: 'b', out: 'orphan', say: 'orphan', rt: 7.47, mz: 762.2, hits: [] },
      { key: 'c', out: 'ambiguous', say: '2 candidates', rt: 7.555, mz: B.mz, hits: [B, Cf] },
    ];
    cases.forEach((c, k) => {
      const r = mulberry32(911 + k * 173);
      const n = k === 2 ? 17 : 10 + Math.floor(r() * 3);
      c.sticks = [];
      for (let j = 0; j < n; j++) c.sticks.push({ mz: 90 + r() * (c.mz - 140), h: 0.07 + 0.8 * Math.pow(r(), 2.4) });
      c.sticks[Math.floor(r() * n)].h = 1;
      if (k === 2) c.sticks[Math.floor(r() * n)].h = 0.86; // two parents' fragments mixed
      c.sticks.push({ mz: c.mz, h: 0.16 }); // leftover precursor
      c.sticks.sort((p, q) => p.mz - q.mz);
    });

    let S = null, lay = null, base = null, tags = [];
    const X = (rt) => lay.map.x + ((rt - RT0) / (RT1 - RT0)) * lay.map.w;
    const Y = (mz) => lay.map.y + lay.map.h - ((mz - MZ0) / (MZ1 - MZ0)) * lay.map.h;

    function bezier(p0, c1, c2, p1, n = 48) {
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const u = i / n, v = 1 - u;
        pts.push([
          v * v * v * p0[0] + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u * u * u * p1[0],
          v * v * v * p0[1] + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u * u * u * p1[1],
        ]);
      }
      return pts;
    }

    function layout(s) {
      S = s;
      const narrow = s.w < 520;
      const pad = 12;
      if (!narrow) {
        const top = 40, bottom = s.h - 34;
        lay = { narrow, map: { x: 52, y: top, w: Math.round(s.w * 0.56) - 52, h: bottom - top } };
        const cx0 = Math.round(s.w * 0.645), cx1 = s.w - 16, gap = 14;
        const ph = Math.min(220, (bottom - top - gap * 2) / 3);
        const py0 = top + (bottom - top - (ph * 3 + gap * 2)) / 2;
        lay.panels = cases.map((c, k) => ({ x: cx0, y: py0 + k * (ph + gap), w: cx1 - cx0, h: ph }));
        lay.colLabel = { left: cx0, top: py0 - 24 };
      } else {
        // Narrow: map on top, the three spectra in a row under it, labelled
        // below so no connector crosses the label.
        const top = 32, mb = Math.round(s.h * 0.54), side = 8;
        lay = { narrow, map: { x: 44, y: top, w: s.w - 44 - pad, h: mb - top } };
        const pt = mb + 44, gap = 6, pw = (s.w - 2 * side - gap * 2) / 3;
        lay.panels = cases.map((c, k) => ({ x: side + k * (pw + gap), y: pt, w: pw, h: s.h - pt - 34 }));
        lay.colLabel = { left: side + 4, top: s.h - 26 };
      }
      sl.wrap.classList.toggle('is-narrow', narrow);
      lay.pxDa = lay.map.h / (MZ1 - MZ0);

      // connectors: from each spectrum panel to its precursor on the map
      cases.forEach((c, k) => {
        const p = lay.panels[k];
        const px = X(c.rt), py = Y(c.mz), half = 0.5 * lay.pxDa;
        if (!lay.narrow) {
          const p0 = [p.x - 4, p.y + p.h / 2], p1 = [px + 7, py];
          const dx = p0[0] - p1[0];
          c.path = bezier(p0, [p0[0] - dx * 0.5, p0[1]], [p1[0] + dx * 0.5, p1[1]], p1);
        } else {
          const p0 = [p.x + p.w / 2, p.y - 4], p1 = [px, py + half + 5];
          const dy = p0[1] - p1[1];
          c.path = bezier(p0, [p0[0], p0[1] - dy * 0.5], [p1[0], p1[1] + dy * 0.5], p1);
        }
      });

      drawBase();

      const L = labeller(sl.layer);
      const xs = range(RT0, RT1, 0.2);
      xs.forEach((v, k) => {
        const last = k === xs.length - 1;
        L.add(last ? 'lcms-tick--x lcms-tick--end' : 'lcms-tick--x', v.toFixed(1) + (last ? ' min' : ''), { left: X(v) + (last ? 3 : 0), top: lay.map.y + lay.map.h + 8 });
      });
      range(755, 770, 5).forEach((v) => L.add('lcms-tick--y', String(v), { right: s.w - lay.map.x + 9, top: Y(v) }));
      L.add('lcms-tick--title', 'm/z', { right: s.w - lay.map.x + 9, top: lay.map.y - 26 });
      L.add('lcms-tick--title', 'MS1 features', { right: s.w - lay.map.x - lay.map.w, top: lay.map.y - 26 });
      L.add('lcms-tick--title', 'MS2 spectra', { left: lay.colLabel.left, top: lay.colLabel.top });
      tags = cases.map((c, k) => {
        const p = lay.panels[k];
        const el = L.add(`lcms-tag lcms-tag--${c.out}`, '', { left: p.x + 7, top: p.y + 6 });
        const kk = doc.createElement('span');
        kk.className = 'lcms-tag__k';
        kk.textContent = c.key;
        const out = doc.createElement('span');
        out.className = 'lcms-tag__out';
        out.textContent = narrow && c.out === 'ambiguous' ? 'ambiguous' : c.say; // the narrow panel is too small for "2 candidates"
        el.append(kk, out);
        return el;
      });
      L.commit();
    }

    function drawBase() {
      base = base || doc.createElement('canvas');
      base.width = sl.canvas.width;
      base.height = sl.canvas.height;
      const g = base.getContext('2d');
      const d = S.dpr, m = lay.map;
      g.setTransform(d, 0, 0, d, 0, 0);
      g.clearRect(0, 0, S.w, S.h);
      // graticule aligned to the data
      const vx = (list) => list.map(X), hy = (list) => list.map(Y);
      g.lineWidth = 1;
      const pass = (xs, ys, col) => {
        g.beginPath();
        for (const x of xs) { const c = crisp(x, d); g.moveTo(c, m.y); g.lineTo(c, m.y + m.h); }
        for (const y of ys) { const c = crisp(y, d); g.moveTo(m.x, c); g.lineTo(m.x + m.w, c); }
        g.strokeStyle = rgba(col);
        g.stroke();
      };
      pass(vx(range(RT0, RT1, 0.05)), hy(range(MZ0, MZ1, lay.pxDa >= 9 ? 1 : 2)), C.rule2);
      pass(vx(range(RT0, RT1, 0.2)), hy(range(755, 770, 5)), C.rule);
      g.strokeStyle = rgba(C.rule);
      g.strokeRect(crisp(m.x, d), crisp(m.y, d), Math.round(m.w * d) / d, Math.round(m.h * d) / d);
      g.beginPath();
      for (const x of vx(range(RT0, RT1, 0.2))) { const c = crisp(x, d); g.moveTo(c, m.y + m.h); g.lineTo(c, m.y + m.h + 5); }
      for (const y of hy(range(755, 770, 5))) { const c = crisp(y, d); g.moveTo(m.x - 5, c); g.lineTo(m.x, c); }
      g.strokeStyle = rgba(C.muted, 0.75);
      g.stroke();

      // blobs, painted column by column in device pixels
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.save();
      g.beginPath();
      g.rect(Math.round(m.x * d), Math.round(m.y * d), Math.round(m.w * d), Math.round(m.h * d));
      g.clip();
      const cols = Math.round(m.w / 1.5);
      const W = m.w * d, x00 = Math.round(m.x * d);
      const yOf = (mz) => Y(mz) * d;
      const hk = clamp(lay.pxDa / 12, 0.55, 1.2) * d;
      const r = mulberry32(4242);
      for (let i = 0; i < cols; i++) {
        const x0 = x00 + Math.round((i * W) / cols);
        const cw = x00 + Math.round(((i + 1) * W) / cols) - x0;
        const rt = RT0 + ((i + 0.5) * (RT1 - RT0)) / cols;
        paintFeatures(g, feats, rt, x0, cw, yOf, hk);
        if (r() < 0.55) {
          g.fillStyle = rgba(C.ink2, 0.05 + r() * r() * 0.25);
          g.fillRect(x0, yOf(MZ0 + r() * (MZ1 - MZ0)), cw, 1.2 * d);
        }
      }
      g.restore();

      // feature boxes, already found (ours, so pink)
      g.setTransform(d, 0, 0, d, 0, 0);
      const pad = Math.max(4, lay.pxDa * 0.5);
      feats.forEach((f, k) => {
        const x = X(f.lo), y = Y(f.top) - pad, w = X(f.hi) - X(f.lo), h = Y(f.mz) - Y(f.top) + pad * 2;
        rrect(g, x, y, w, h, 5);
        g.fillStyle = rgba(C.ch2, 0.06);
        g.fill();
        sketch(g, loopPts(x, y, w, h, 5), 1, 300 + k, C.ch2, 1.7, 0.9);
      });

      // spectrum panels
      for (const p of lay.panels) {
        rrect(g, p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1, 8);
        g.fillStyle = rgba(C.paper, 0.6);
        g.fill();
        g.strokeStyle = rgba(C.rule);
        g.lineWidth = 1;
        g.stroke();
        const by = crisp(p.y + p.h - 10, d);
        g.beginPath();
        g.moveTo(p.x + 8, by);
        g.lineTo(p.x + p.w - 8, by);
        g.strokeStyle = rgba(C.rule);
        g.stroke();
      }
    }

    function panelStick(p, mz) { return p.x + 10 + ((mz - 80) / (800 - 80)) * (p.w - 20); }

    function drawCase(ctx, c, k, u) {
      const p = lay.panels[k];
      const by = p.y + p.h - 10;
      const top = p.y + (lay.narrow ? 34 : 32);
      const hMax = by - top;
      // fragment sticks grow up from the panel baseline
      if (u > 0) {
        ctx.beginPath();
        c.sticks.forEach((st, j) => {
          const g = easeOut(seg(u, 0.02 * j, 0.02 * j + 0.28));
          if (g <= 0) return;
          const x = crisp(panelStick(p, st.mz), S.dpr);
          ctx.moveTo(x, by);
          ctx.lineTo(x, by - st.h * hMax * g);
        });
        ctx.lineCap = 'butt';
        ctx.strokeStyle = rgba(C.ink, 0.12);
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.strokeStyle = rgba(C.ink, 0.9);
        ctx.lineWidth = 2;
        ctx.stroke();
        // precursor marker over its leftover stick
        const pm = easeOut(seg(u, 0.25, 0.45));
        if (pm > 0) {
          const x = panelStick(p, c.mz), y = by - 0.16 * hMax - 7;
          ctx.globalAlpha = pm;
          ctx.beginPath();
          ctx.moveTo(x - 3.5, y - 4);
          ctx.lineTo(x + 3.5, y - 4);
          ctx.lineTo(x, y + 1);
          ctx.closePath();
          ctx.fillStyle = rgba(C.ink2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      // the precursor's isolation window on the map
      const pw = easeOut(seg(u, 0.35, 0.55));
      const px = X(c.rt), py = Y(c.mz), half = 0.5 * lay.pxDa;
      const hit = easeOut(seg(u, 1.0, 1.3));

      // target highlight first, so lines sit on top of it
      if (hit > 0 && c.hits.length) {
        const padB = Math.max(4, lay.pxDa * 0.5);
        for (const f of c.hits) {
          rrect(ctx, X(f.lo), Y(f.top) - padB, X(f.hi) - X(f.lo), Y(f.mz) - Y(f.top) + padB * 2, 5);
          ctx.fillStyle = rgba(C.ch2, (c.hits.length > 1 ? 0.11 : 0.17) * hit);
          ctx.fill();
          ctx.strokeStyle = rgba(C.ch2ink, 0.9 * hit);
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      // connector from the spectrum to its precursor
      const pc = easeInOut(seg(u, 0.45, 1.05));
      if (pc > 0) {
        const n = c.path.length - 1, fi = pc * n, i1 = Math.floor(fi);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(c.path[0][0], c.path[0][1]);
        for (let i = 1; i <= i1; i++) ctx.lineTo(c.path[i][0], c.path[i][1]);
        if (i1 < n) {
          const f = fi - i1;
          ctx.lineTo(lerp(c.path[i1][0], c.path[i1 + 1][0], f), lerp(c.path[i1][1], c.path[i1 + 1][1], f));
        }
        if (c.out === 'orphan') ctx.setLineDash([3, 3]);
        ctx.strokeStyle = rgba(c.out === 'orphan' ? C.ink2 : C.ink, 0.85);
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.restore();
        ctx.beginPath();
        ctx.arc(c.path[0][0], c.path[0][1], 2.5, 0, TAU);
        ctx.fillStyle = rgba(C.ink, 0.85);
        ctx.fill();
      }

      if (pw > 0) {
        const cap = 4;
        const x = crisp(px, S.dpr);
        ctx.globalAlpha = pw;
        ctx.beginPath();
        ctx.moveTo(x, py - half);
        ctx.lineTo(x, py + half);
        ctx.moveTo(x - cap, py - half);
        ctx.lineTo(x + cap, py - half);
        ctx.moveTo(x - cap, py + half);
        ctx.lineTo(x + cap, py + half);
        ctx.strokeStyle = rgba(C.ink);
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // outcomes
      if (hit > 0) {
        if (c.out === 'orphan') {
          ctx.save();
          ctx.setLineDash([2.5, 2.5]);
          ctx.beginPath();
          ctx.arc(px, py, 5 + 5 * hit, 0, TAU);
          ctx.strokeStyle = rgba(C.ink2, 0.8 * hit);
          ctx.lineWidth = 1.25;
          ctx.stroke();
          ctx.restore();
        } else if (c.hits.length > 1) {
          ctx.save();
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = rgba(C.ink, 0.8);
          ctx.lineWidth = 1.25;
          for (const f of c.hits) {
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(lerp(px, X(f.rt), hit), lerp(py, Y(f.mz), hit));
            ctx.stroke();
          }
          ctx.restore();
          for (const f of c.hits) {
            ctx.beginPath();
            ctx.arc(lerp(px, X(f.rt), hit), lerp(py, Y(f.mz), hit), 2.5, 0, TAU);
            ctx.fillStyle = rgba(C.ink, 0.85 * hit);
            ctx.fill();
          }
        } else {
          ctx.beginPath();
          ctx.arc(px, py, 2.75, 0, TAU);
          ctx.fillStyle = rgba(C.ink, hit);
          ctx.fill();
        }
      }
      if (tags[k]) tags[k].classList.toggle('is-on', u >= 1.0);
    }

    // the three cases play one after another, 1.5 s apart (about 4.4 s in all)
    const STEP = 1.5, CASE = 1.35, END = STEP * 2 + CASE;
    function render(t) {
      if (!lay) return;
      const ctx = sl.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, sl.canvas.width, sl.canvas.height);
      ctx.drawImage(base, 0, 0);
      ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
      cases.forEach((c, k) => drawCase(ctx, c, k, t - k * STEP));
    }

    return { sl, layout, render, END };
  }

  function initLink(fig) {
    const frame = fig.querySelector('.lcms-frame');
    if (frame) playOnce(fig, mapView(surface(frame)));
  }

  /* ------------------------------------------------------------------ */
  function init() {
    readPalette();
    const run = (sel, fn) => {
      const el = doc.querySelector(sel);
      if (!el) return;
      try { fn(el); } catch (err) { if (window.console) console.error(err); }
    };
    run('[data-lcms-xic]', initXic);
    run('[data-lcms-link]', initLink);
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})();
