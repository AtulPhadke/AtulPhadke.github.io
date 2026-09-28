/* Devserver provisioning in Slack · the scene plays itself.
 * The drawing is inline in the page (built by scratchpad/gpu-art/build-dev-scene.js);
 * this file switches its states and moves the camera (the SVG viewBox). The steps
 * advance on a timer and loop; clicking a step title jumps to it. The Pause button
 * (site.js dispatches 'scope:run'), leaving the screen, and reduced motion all stop
 * the advance as well as the loops.
 *
 *   step 0 ask        the request is typed into Slack and sent; the app replies
 *   step 1 provision  the arrow draws, box-3 goes pending then running, EFS mounts
 *   step 2 demand     close-up on the live board, then out to the whole system
 *
 * Parts with data-from="N" show from step N; other .dv-part groups are shown
 * by the step timelines below. Loops (bars, pulses, dots) stop with the Pause
 * button (site.js dispatches 'scope:run'), when the scene is off screen, and
 * under reduced motion. Reduced motion also skips the one-shot animations:
 * each step shows its finished frame straight away.
 */
(() => {
  'use strict';

  const root = document.querySelector('[data-dv]');
  const svg = root && root.querySelector('.dv-svg');
  if (!root || !svg) return;
  const stepEls = Array.from(root.querySelectorAll('.dv-step'));

  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  const $ = (sel) => svg.querySelector(sel);
  const $$ = (sel) => Array.from(svg.querySelectorAll(sel));

  const parts = $$('[data-from]');
  const ask = $('.dv-ask');
  const compose = $('.dv-compose');
  const typed = $('.dv-t-type');
  const placeholder = $('.dv-t-ph');
  const caret = $('.dv-caret');
  const bot = $('.dv-bot');
  const prov = $('.dv-prov');
  const packet = $('.dv-packet');
  const track = $('.dv-arrow-track');
  const slot = $('.dv-slot');
  const box3 = $('.dv-box--3');
  const state3 = $('.dv-state');
  const efs = $('.dv-efs');
  const mount3 = $('.dv-mount3');
  const files = $$('.dv-file');
  const file3 = $('.dv-file--3');
  const members = $$('.dv-member.dv-part');
  const bars = $$('.dv-bar');
  const free = $('.dv-free');

  const MSG = 'I need a GPU box for this afternoon';
  const CARET_X = 38;
  const ROW_DY = 40;

  /* camera: what each step must show (x y w h in drawing units). The view is
   * grown to the stage's shape, then kept inside BOUNDS so the edges of the
   * drawing don't leave bare paper. */
  const BOUNDS = [-40, -40, 720, 840];
  const WIDE = [-16, -12, 672, 734];
  const BOARD = [376, 2, 262, 270];   // step 2 opens on the demand board
  const FOCUS = [
    [8, 8, 392, 276],     // ask: the Slack window
    [140, 260, 490, 440], // provision: the arrow, the EC2 boxes, EFS
    WIDE,                 // demand: ends on everything
  ];
  function fit(f) {
    const r = svg.getBoundingClientRect();
    const a = r.width > 0 && r.height > 0 ? r.width / r.height : f[2] / f[3];
    let w = f[2];
    let h = f[3];
    if (w / h > a) h = w / a; else w = h * a;
    const clampAxis = (c, size, lo, span) => (size >= span ? lo + (span - size) / 2 : Math.min(lo + span - size, Math.max(lo, c - size / 2)));
    const x = clampAxis(f[0] + f[2] / 2, w, BOUNDS[0], BOUNDS[2]);
    const y = clampAxis(f[1] + f[3] / 2, h, BOUNDS[1], BOUNDS[3]);
    return [x, y, w, h];
  }

  let index = -1;
  let visible = true;
  let running = !mqReduce.matches;
  const reduce = () => mqReduce.matches;

  /* ---------- timers that die when the step changes ---------- */
  let gen = 0;
  const timers = new Set();
  let packetRaf = 0;
  function later(ms, fn) {
    const g = gen;
    const id = setTimeout(() => {
      timers.delete(id);
      if (g === gen) fn();
    }, ms);
    timers.add(id);
  }
  function cancelAll() {
    gen++;
    timers.forEach(clearTimeout);
    timers.clear();
    cancelAnimationFrame(packetRaf);
    packet.classList.remove('is-moving');
  }
  // change state with no transition (resets)
  function snap(el, fn) {
    el.classList.add('dv-snap');
    fn();
    el.getBoundingClientRect();
    el.classList.remove('dv-snap');
  }
  const show = (el, on) => el.classList.toggle('is-on', on);
  const hide = (el) => snap(el, () => show(el, false));

  /* ---------- composer ---------- */
  function setCompose(text) {
    typed.textContent = text;
    placeholder.style.opacity = text ? '0' : '';
    let w = 0;
    try { w = text ? typed.getComputedTextLength() : 0; } catch (e) { w = 0; }
    caret.setAttribute('x', (CARET_X + w + 1.5).toFixed(1));
  }

  /* ---------- per-step states ----------
   * reset(): back to "not reached", no transitions
   * final(): the finished frame
   * play():  from reset to final, over a few seconds */
  const H = [
    { // ask: type, send, the app replies
      reset() {
        snap(ask, () => ask.classList.remove('is-sent'));
        setCompose('');
        compose.classList.remove('is-typing');
        hide(bot);
        bot.dataset.phase = 'typing';
      },
      final() {
        ask.classList.add('is-sent');
        setCompose('');
        compose.classList.remove('is-typing');
        show(bot, true);
        if (bot.dataset.phase === 'typing') bot.dataset.phase = 'said';
      },
      play() {
        this.reset();
        compose.classList.add('is-typing');
        let i = 0;
        const tick = () => {
          i++;
          setCompose(MSG.slice(0, i));
          if (i < MSG.length) { later(30 + Math.random() * 40, tick); return; }
          later(400, () => {
            ask.classList.add('is-sent');
            setCompose('');
            compose.classList.remove('is-typing');
          });
          later(900, () => show(bot, true));
          later(1900, () => { bot.dataset.phase = 'said'; });
        };
        later(500, tick);
      },
    },
    { // provision: arrow, box-3 pending then running, EFS mounts everywhere
      reset() {
        snap(prov, () => prov.classList.remove('is-drawn'));
        hide(slot);
        snap(box3, () => { box3.dataset.state = 'off'; });
        state3.textContent = 'pending';
        hide(efs);
        files.forEach(hide);
        snap(mount3, () => mount3.classList.remove('is-drawn'));
        if (bot.dataset.phase === 'done') bot.dataset.phase = 'said';
      },
      final() {
        prov.classList.add('is-drawn');
        show(slot, false);
        box3.dataset.state = 'running';
        state3.textContent = 'running';
        bot.dataset.phase = 'done';
        show(efs, true);
        files.forEach((f) => show(f, true));
        mount3.classList.add('is-drawn');
      },
      play() {
        this.reset();
        show(slot, true);
        later(200, () => prov.classList.add('is-drawn'));
        later(1000, () => sendPacket(1));
        later(1800, () => { show(slot, false); box3.dataset.state = 'pending'; });
        later(3200, () => {
          box3.dataset.state = 'running';
          state3.textContent = 'running';
          bot.dataset.phase = 'done';
        });
        later(3500, () => {
          show(efs, true);
          files.forEach((f) => { if (f !== file3) show(f, true); });
        });
        later(3900, () => mount3.classList.add('is-drawn'));
        later(4800, () => show(file3, true));
      },
    },
    { // demand: the board up close, then the whole system
      reset() {
        root.classList.remove('is-board');
        members.forEach(hide);
      },
      final() {
        root.classList.remove('is-board');
        members.forEach((m) => show(m, true));
      },
      play() {
        this.reset();
        root.classList.add('is-board');
        camTo(fit(BOARD), true);
        later(3000, () => {
          root.classList.remove('is-board');
          camTo(fit(WIDE), true);
        });
        later(3600, () => members.forEach((m) => show(m, true)));
      },
    },
  ];

  /* ---------- a request travelling down the arrow ---------- */
  function sendPacket(times) {
    if (!track.getTotalLength) return;
    const len = track.getTotalLength();
    const dur = 800;
    let t0 = 0;
    let n = 0;
    packet.setAttribute('cx', '0');
    packet.setAttribute('cy', '0');
    packet.classList.add('is-moving');
    const frame = (now) => {
      if (!t0) t0 = now;
      let k = (now - t0) / dur;
      if (k >= 1) {
        n++;
        if (n >= times) { packet.classList.remove('is-moving'); return; }
        t0 = now;
        k = 0;
      }
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const pt = track.getPointAtLength(e * len);
      packet.style.transform = `translate(${pt.x.toFixed(1)}px, ${pt.y.toFixed(1)}px)`;
      packetRaf = requestAnimationFrame(frame);
    };
    packetRaf = requestAnimationFrame(frame);
  }

  /* ---------- camera ---------- */
  const cam = { cur: FOCUS[0].slice(), to: FOCUS[0].slice(), raf: 0, last: 0 };
  function paintCam() { svg.setAttribute('viewBox', cam.cur.map((n) => n.toFixed(2)).join(' ')); }
  function camStep(now) {
    const dt = cam.last ? Math.min(64, now - cam.last) : 16;
    cam.last = now;
    const k = 1 - Math.exp(-dt / 190);
    let moving = false;
    for (let i = 0; i < 4; i++) {
      const d = cam.to[i] - cam.cur[i];
      if (Math.abs(d) > 0.05) { cam.cur[i] += d * k; moving = true; } else cam.cur[i] = cam.to[i];
    }
    paintCam();
    cam.raf = moving ? requestAnimationFrame(camStep) : 0;
    if (!moving) cam.last = 0;
  }
  function camTo(view, animate) {
    cam.to = view.slice();
    if (!animate) {
      cancelAnimationFrame(cam.raf);
      cam.raf = 0;
      cam.last = 0;
      cam.cur = view.slice();
      paintCam();
      return;
    }
    if (!cam.raf) cam.raf = requestAnimationFrame(camStep);
  }

  /* ---------- live demand ---------- */
  const values = bars.map((b) => {
    const m = /scaleX\(([\d.]+)\)/.exec(b.getAttribute('style') || '');
    return m ? parseFloat(m[1]) : 0.5;
  });
  let liveTimer = 0;
  function paintBars() {
    let lo = 0;
    let hi = 0;
    values.forEach((v, i) => {
      if (v < values[lo]) lo = i;
      if (v > values[hi]) hi = i;
    });
    bars.forEach((b, i) => {
      b.style.transform = `scaleX(${values[i].toFixed(3)})`;
      b.dataset.job = i === lo ? 'green' : i === hi ? 'pink' : 'blue';
    });
    free.style.transform = `translateY(${lo * ROW_DY}px)`;
  }
  function liveTick() {
    // a slow random walk, kept apart enough that one box is clearly the free one
    for (let i = 0; i < values.length; i++) {
      values[i] = Math.min(0.95, Math.max(0.12, values[i] + (Math.random() - 0.5) * 0.55));
    }
    const sorted = values.slice().sort((a, b) => a - b);
    if (sorted[1] - sorted[0] < 0.12) {
      const lo = values.indexOf(sorted[0]);
      values[lo] = Math.max(0.12, values[lo] - 0.18);
    }
    paintBars();
    liveTimer = setTimeout(liveTick, 1700);
  }
  function updateLive() {
    const live = index >= 2;
    const loops = running && visible;
    root.classList.toggle('is-live', live);
    root.classList.toggle('is-paused', !loops);
    const shouldRun = live && loops;
    if (shouldRun && !liveTimer) liveTimer = setTimeout(liveTick, 500);
    if (!shouldRun && liveTimer) { clearTimeout(liveTimer); liveTimer = 0; }
  }

  /* ---------- apply a step ---------- */
  function apply(i, animate) {
    cancelAll();
    parts.forEach((el) => show(el, i >= +el.dataset.from));
    for (let k = 0; k < i; k++) H[k].final();
    for (let k = H.length - 1; k > i; k--) H[k].reset();
    camTo(fit(FOCUS[i] || WIDE), animate);
    if (animate) H[i].play();
    else H[i].final();
    updateLive();
  }

  // the stage changes shape with the window: re-fit the current view
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => camTo(fit(FOCUS[index] || WIDE), false), 120);
  });

  const canAnimate = () => !reduce() && visible;

  /* ---------- auto-advance: each step holds long enough to finish playing ---------- */
  const DWELL = [6500, 7000, 8000];
  let advance = 0;
  let left = 0;      // ms still to wait on the current step
  let since = 0;     // when the current wait started
  const moving = () => running && visible && !reduce();
  function markSteps() {
    stepEls.forEach((el, k) => {
      el.classList.toggle('is-active', k === index);
      const btn = el.querySelector('.dv-step__btn');
      if (btn) btn.setAttribute('aria-current', k === index ? 'step' : 'false');
    });
  }
  function hold() {
    clearTimeout(advance);
    advance = 0;
    if (since) left = Math.max(0, left - (performance.now() - since));
    since = 0;
  }
  function wait() {
    clearTimeout(advance);
    advance = 0;
    since = 0;
    if (!moving()) return;
    since = performance.now();
    advance = setTimeout(() => go((index + 1) % H.length), left);
  }
  function syncMotion() {
    root.classList.toggle('is-halted', !moving());
    if (!moving()) hold();
    else if (!advance) wait();   // already counting down: leave it be
    updateLive();
  }
  function go(i) {
    clearTimeout(advance);
    advance = 0;
    index = i;
    apply(i, canAnimate());
    // restart the step's progress bar
    root.classList.remove('is-ticking');
    root.style.setProperty('--dv-dwell', `${DWELL[i]}ms`);
    markSteps();
    root.getBoundingClientRect();
    root.classList.add('is-ticking');
    left = DWELL[i];
    since = 0;
    syncMotion();
  }

  // first frame: no transitions, then the stage fades in and the first step plays
  index = 0;
  apply(0, false);
  markSteps();
  root.classList.add('is-dv');
  requestAnimationFrame(() => go(0));

  stepEls.forEach((el, k) => {
    const btn = el.querySelector('.dv-step__btn');
    if (btn) btn.addEventListener('click', () => go(k));
  });

  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    syncMotion();
  }, { threshold: 0.25 }).observe(root.querySelector('.dv-stage') || root);

  document.addEventListener('scope:run', (e) => {
    running = !!(e.detail && e.detail.running);
    syncMotion();
  });
  mqReduce.addEventListener('change', () => {
    if (mqReduce.matches) running = false;
    apply(index, false);
    syncMotion();
  });
})();
