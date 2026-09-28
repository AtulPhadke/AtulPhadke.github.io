/* Scroll-driven scenes, shared by the project pages. No dependencies.
 *
 * Markup (see css/scrolly.css for the layout):
 *   <section class="scrolly" data-scrolly="loop">
 *     <div class="scrolly__stage"> …the figure that stays pinned… </div>
 *     <ol class="scrolly__steps">
 *       <li class="scrolly__step" data-step="input"> …a sentence or two… </li>
 *       …
 *     </ol>
 *   </section>
 *
 * While a section is near the viewport this keeps, on the section element:
 *   data-step         name of the active step (its data-step, or its index)
 *   data-step-index   0-based index of the active step
 *   --scrolly-p       0..1 through the whole section
 *   --step-p          0..1 through the active step
 * and marks the active step with .is-active (earlier ones get .is-past).
 *
 * Page scripts subscribe with:
 *   Scrolly.onStep(section, ({ index, name, prev }) => …)   fires now, then on every change
 *   Scrolly.onProgress(section, ({ p, stepP, index }) => …) fires every frame the numbers move
 * or listen for the 'scrolly:step' / 'scrolly:progress' events on the section.
 *
 * A step becomes active when its top crosses the activation line (55% down the
 * viewport). Reduced motion changes nothing here: steps still switch as you
 * scroll; page scripts should swap states instantly instead of tweening.
 */
(() => {
  'use strict';

  const LINE = 0.55;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const scenes = new Map();
  const live = new Set();
  let queued = false;

  function measure(sc) {
    const vh = window.innerHeight || 1;
    const line = vh * LINE;
    const steps = sc.steps;
    if (!steps.length) return;
    let index = 0;
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].getBoundingClientRect().top <= line) index = i;
    }
    const first = steps[0].getBoundingClientRect();
    const last = steps[steps.length - 1].getBoundingClientRect();
    const cur = steps[index].getBoundingClientRect();
    const p = clamp01((line - first.top) / Math.max(1, last.bottom - first.top));
    const stepP = clamp01((line - cur.top) / Math.max(1, cur.height));

    if (index !== sc.index) {
      const prev = sc.index;
      sc.index = index;
      const name = steps[index].dataset.step || String(index);
      sc.el.dataset.step = name;
      sc.el.dataset.stepIndex = String(index);
      steps.forEach((s, i) => {
        s.classList.toggle('is-active', i === index);
        s.classList.toggle('is-past', i < index);
      });
      const detail = { index, name, prev };
      sc.stepFns.forEach((fn) => fn(detail));
      sc.el.dispatchEvent(new CustomEvent('scrolly:step', { detail }));
    }
    if (Math.abs(p - sc.p) > 1e-4 || Math.abs(stepP - sc.stepP) > 1e-4) {
      sc.p = p;
      sc.stepP = stepP;
      sc.el.style.setProperty('--scrolly-p', p.toFixed(4));
      sc.el.style.setProperty('--step-p', stepP.toFixed(4));
      const detail = { p, stepP, index };
      sc.progFns.forEach((fn) => fn(detail));
      sc.el.dispatchEvent(new CustomEvent('scrolly:progress', { detail }));
    }
  }

  function frame() {
    queued = false;
    live.forEach(measure);
  }
  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(frame);
  }

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const sc = scenes.get(e.target);
      if (!sc) continue;
      if (e.isIntersecting) live.add(sc);
      else live.delete(sc);
    }
    queue();
  }, { rootMargin: '25% 0px 25% 0px' });

  function register(el) {
    if (scenes.has(el)) return scenes.get(el);
    const sc = {
      el,
      steps: [...el.querySelectorAll('.scrolly__step')],
      index: -1,
      p: -1,
      stepP: -1,
      stepFns: new Set(),
      progFns: new Set(),
    };
    scenes.set(el, sc);
    el.classList.add('is-scrolly');
    measure(sc);
    io.observe(el);
    return sc;
  }

  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);

  window.Scrolly = {
    get(el) {
      const sc = register(el);
      return { index: sc.index, name: el.dataset.step, p: sc.p, stepP: sc.stepP, steps: sc.steps.length };
    },
    onStep(el, fn) {
      const sc = register(el);
      sc.stepFns.add(fn);
      fn({ index: sc.index, name: el.dataset.step, prev: -1 });
      return () => sc.stepFns.delete(fn);
    },
    onProgress(el, fn) {
      const sc = register(el);
      sc.progFns.add(fn);
      fn({ p: sc.p, stepP: sc.stepP, index: sc.index });
      return () => sc.progFns.delete(fn);
    },
    refresh: queue,
  };

  const init = () => document.querySelectorAll('[data-scrolly]').forEach(register);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
