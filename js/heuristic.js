/* Atul Phadke · portfolio · "why a fixed formula breaks"
 * A small scripted simulation of a generic priority heuristic:
 *   score = 3 × priority + 2 × wait − GPUs; run the top job if it fits, else wait.
 * Four scenarios show it working, then breaking: a big job blocks the queue and
 * GPUs go idle, new signals (price, budget) aren't inputs, and a deadline moves
 * without changing the score. Illustrative only. Art from js/rig-art.js;
 * colours from css/rig.css + css/project.css.
 */
(() => {
  'use strict';

  const ART = window.RigArt;
  if (!ART) return;
  const A = ART.art;
  const NS = 'http://www.w3.org/2000/svg';
  const doc = document;
  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  function el(name, attrs, parent) {
    const n = doc.createElementNS(NS, name);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function text(parent, x, y, str, cls, attrs) {
    const t = el('text', { x, y, class: cls, ...(attrs || {}) }, parent);
    t.textContent = str;
    return t;
  }
  const at = (n, x, y, s = 1) => n.setAttribute('transform', s === 1 ? `translate(${x} ${y})` : `translate(${x} ${y}) scale(${s})`);

  /* ------------------------------------------------------------------ *
   * Geometry (viewBox 640 × 456)
   * ------------------------------------------------------------------ */
  const VB = [640, 456];
  const CARD = { x: 8, y: 8, w: 372, h: 164 };
  const QUEUE = { x: 8, y: 226, dy: 50, max: 4, s: 1.1 };
  const GPU = { x0: 200, dx: 96, rows: [240, 344], s: 1.15, bar: 55, label: 70, w: 66 };
  const METER = { y: 446 };
  const PRIO_PTS = { 1: 3, 2: 2, 3: 1 };
  const JOBC = ['blue', 'green', 'amber', 'pink'];

  /* ------------------------------------------------------------------ *
   * Scenarios. Each sets up the world and a small script of events.
   * Time is in simulated seconds; one loop is `len` seconds.
   * ------------------------------------------------------------------ */
  const SCENARIOS = {
    normal: {
      len: 16,
      nodes: ['Cluster A', 'Cluster B'],
      setup(w) {
        w.run([['Sweep', 1, 3], ['Training', 2, 5], ['Sweep', 1, 2], ['Eval', 1, 4], ['Training', 2, 6]]);
        w.queue([['Sweep', 1, 2, 4], ['Eval', 1, 3, 3], ['Training', 2, 2, 5]]);
      },
      events: [
        ...Array.from({ length: 12 }, (_, i) => ({ t: 1 + i * 1.2, fn: (w) => w.arrive(['Sweep', 'Eval', 'Training'][i % 3], i % 3 === 2 ? 2 : 1, 1 + (i % 3), 3 + (i % 4)) })),
      ],
    },
    idle: {
      len: 18,
      nodes: ['Cluster A', 'Cluster B'],
      setup(w) {
        w.run([['Training', 2, 2.5], ['Sweep', 1, 4], ['Eval', 1, 6], ['Training', 2, 8], ['Sweep', 1, 10], ['Eval', 1, 3.5]]);
        w.queue([['Sweep', 1, 2, 3], ['Eval', 1, 3, 3], ['Sweep', 1, 3, 2]]);
      },
      events: [
        { t: 1, fn: (w) => w.arrive('Pretraining', 8, 1, 6) },
        { t: 3, fn: (w) => w.arrive('Eval', 1, 2, 3) },
        { t: 5, fn: (w) => w.arrive('Sweep', 1, 3, 3) },
      ],
    },
    signal: {
      len: 18,
      nodes: ['On-demand, $3.10/hr', 'Spot, $1.20/hr'],
      spend: true,
      setup(w) {
        w.run([['Training', 2, 3], ['Sweep', 1, 2], ['Eval', 1, 4]]);
        w.queue([['Training', 2, 2, 6], ['Sweep', 1, 3, 4], ['Eval', 1, 2, 5], ['Sweep', 1, 3, 4]]);
      },
      events: [
        { t: 2.2, fn: (w) => w.chip('Spot price drops to $0.90/hr', 'price') },
        { t: 6.5, fn: (w) => w.chip('Budget 90% spent', 'budget') },
        { t: 10.5, fn: (w) => w.chip('New cluster: 4 more GPUs', 'cluster') },
        ...Array.from({ length: 9 }, (_, i) => ({ t: 1.5 + i * 1.6, fn: (w) => w.arrive(i % 2 ? 'Sweep' : 'Training', i % 2 ? 1 : 2, 2 + (i % 2), 4 + (i % 3)) })),
      ],
    },
    deadline: {
      len: 18,
      nodes: ['Cluster A', 'Cluster B'],
      setup(w) {
        w.run([['Training', 2, 6], ['Training', 2, 9], ['Sweep', 1, 4], ['Eval', 1, 7], ['Sweep', 1, 5], ['Eval', 1, 8]]);
        w.queue([['Training', 2, 1, 5], ['Sweep', 1, 2, 4]]);
        const d = w.queue([['Demo eval', 4, 3, 4]])[0];
        d.demo = true;
        d.due = 'due Mon';
      },
      events: [
        { t: 2.4, fn: (w) => { w.chip('Demo moved to Friday', 'deadline', w.jobs.find((j) => j.demo)); } },
        ...Array.from({ length: 15 }, (_, i) => ({ t: 1 + i * 1.1, fn: (w) => w.arrive(i % 2 ? 'Sweep' : 'Training', i % 2 ? 1 : 2, i % 3 === 0 ? 1 : 2, 4 + (i % 3)) })),
      ],
    },
  };

  const CAPTION = {
    normal: 'Jobs are small and arrive steadily, so the top job almost always fits. Utilization stays high and nobody notices the rule.',
    idle: 'An 8-GPU job reaches the top of the queue. The rule says wait until it fits, so running jobs finish and their GPUs sit empty, even though the small jobs behind it would fit right now.',
    signal: 'Spot gets cheaper, the budget runs low, and a new cluster comes online. None of those are inputs, so the rule keeps filling the first cluster listed, on-demand, until spend passes the budget.',
    deadline: 'The demo moves up to Friday. Its priority was set when it was submitted, so its score barely changes, and higher-priority work keeps passing it until the deadline goes by.',
  };
  const ORDER = ['normal', 'idle', 'signal', 'deadline'];

  /* ------------------------------------------------------------------ */
  class World {
    constructor(scene, key) {
      this.scene = scene;
      this.key = key;
      this.cfg = SCENARIOS[key];
      this.t = 0;
      this.jobs = [];
      this.slots = new Array(8).fill(null);
      this.nextId = 1;
      this.tick = 0;
      this.spend = 0.42;
      this.utilHist = [];
      this.fired = new Set();
      this.chips = [];
      this.ruleOn = 0;
      this.cfg.setup(this);
    }

    make(name, gpus, prio, dur) {
      const job = { id: this.nextId++, name, gpus, prio, dur, left: dur, wait: 0, status: 'queued', color: JOBC[(this.nextId + gpus) % JOBC.length], slots: [] };
      if (name === 'Pretraining') job.color = 'blue';
      this.jobs.push(job);
      return job;
    }
    run(list) {
      list.forEach(([name, gpus, left]) => {
        const j = this.make(name, gpus, 2, left + 2);
        j.left = left;
        const free = this.freeSlots();
        if (free.length >= gpus) this.startJob(j, free.slice(0, gpus));
      });
    }
    queue(list) {
      return list.map(([name, gpus, prio, dur]) => this.make(name, gpus, prio, dur));
    }
    arrive(name, gpus, prio, dur) {
      if (this.queued().length >= 7) return null;
      const j = this.make(name, gpus, prio, dur);
      this.scene.enterCard(j);
      return j;
    }
    chip(label, kind, target) {
      this.scene.flyChip(label, kind, target);
      if (kind === 'deadline' && target) {
        target.due = 'due Fri';
        target.urgent = true;
        target.deadlineAt = this.t + 9;
      }
    }

    queued() { return this.jobs.filter((j) => j.status === 'queued'); }
    score(j) { return 3 * PRIO_PTS[j.prio] + 2 * Math.floor(j.wait / 3) - j.gpus; }
    sorted() { return this.queued().sort((a, b) => this.score(b) - this.score(a) || a.id - b.id); }
    // "the first cluster it fits": cluster A's GPUs (0..3) are always tried first
    freeSlots() { return this.slots.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0); }
    startJob(j, slots) {
      j.status = 'running';
      j.slots = slots;
      slots.forEach((s) => { this.slots[s] = j; });
    }

    step(dt) {
      this.t += dt;
      for (const ev of this.cfg.events) {
        if (!this.fired.has(ev) && this.t >= ev.t) { this.fired.add(ev); ev.fn(this); }
      }
      for (const j of this.jobs) {
        if (j.status === 'running') {
          j.left -= dt;
          if (this.cfg.spend) this.spend += dt * j.gpus * (j.slots[0] < 4 ? 0.0105 : 0.004);
          if (j.left <= 0) {
            j.status = 'done';
            j.slots.forEach((s) => { this.slots[s] = null; });
            this.scene.popTick(j);
          }
        } else if (j.status === 'queued') {
          j.wait += dt;
        }
      }
      // The heuristic runs every half second, and it's strict: only the top job.
      this.tick -= dt;
      if (this.tick <= 0) {
        this.tick = 0.5;
        const top = this.sorted()[0];
        this.ruleOn = 1;
        if (top) {
          const free = this.freeSlots();
          if (free.length >= top.gpus) {
            this.startJob(top, free.slice(0, top.gpus));
            this.ruleOn = 2;
          } else {
            this.ruleOn = 3;
            top.blocked = true;
          }
        }
      }
      this.utilHist.push(this.slots.filter(Boolean).length / 8);
      if (this.utilHist.length > 40) this.utilHist.shift();
      const demo = this.jobs.find((j) => j.demo);
      if (demo && demo.deadlineAt && demo.status === 'queued' && this.t >= demo.deadlineAt) demo.missed = true;
      this.jobs = this.jobs.filter((j) => j.status !== 'done');
    }
  }

  /* ------------------------------------------------------------------ */
  class Scene {
    constructor(root) {
      this.root = root;
      this.stage = root.querySelector('.hx__stage');
      this.cap = doc.querySelector('[data-hx-caption]');
      const block = root.closest('.hx-block') || doc;
      this.tabs = Array.from(block.querySelectorAll('[data-scenario]'));
      this.runBtn = block.querySelector('[data-hx-run]');
      this.playing = !mqReduce.matches;
      this.auto = true;
      this.visible = true;
      this.raf = 0;
      this.last = 0;
      this.svg = el('svg', { class: 'hx__svg', viewBox: `0 0 ${VB[0]} ${VB[1]}`, role: 'presentation', focusable: 'false' }, this.stage);
      this.bind();
      this.load('normal');
      this.request();
    }

    load(key) {
      this.key = key;
      this.tabs.forEach((b) => {
        const on = b.dataset.scenario === key;
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
      });
      if (this.cap) this.cap.textContent = CAPTION[key];
      this.cards = null;
      this.world = new World(this, key);
      this.build();
      this.cards = new Map();
      this.world.queued().forEach((j) => this.enterCard(j, true));
      if (mqReduce.matches || !this.playing) {
        // A composed still: run the story most of the way through.
        const until = this.world.cfg.len * 0.72;
        while (this.world.t < until) this.world.step(1 / 20);
        this.world.chips = [];
        this.chipLayer.innerHTML = '';
        this.render(0);
      }
    }

    build() {
      const s = this.svg;
      s.innerHTML = '';
      const w = this.world;

      // The rule card: the whole algorithm, with its three fixed inputs.
      const card = el('g', { class: 'hx-card' }, s);
      el('rect', { class: 'hx-card__box', x: CARD.x, y: CARD.y, width: CARD.w, height: CARD.h, rx: 10 }, card);
      text(card, CARD.x + 16, CARD.y + 26, 'Heuristic scheduler', 'rig-h');
      text(card, CARD.x + 16, CARD.y + 50, 'score = 3 × priority + 2 × wait − GPUs', 'rig-meta hx-formula');
      this.rules = ['Sort the queue by score', 'Run the top job on the first cluster it fits', 'Otherwise, wait'].map((r, i) => {
        const y = CARD.y + 70 + i * 24;
        const g = el('g', { class: 'hx-rule' }, card);
        el('rect', { class: 'hx-rule__hl', x: CARD.x + 8, y: y - 2, width: CARD.w - 16, height: 21, rx: 5 }, g);
        text(g, CARD.x + 16, y + 13, `${i + 1}`, 'rig-meta hx-rule__n');
        text(g, CARD.x + 32, y + 13, r, 'rig-meta hx-rule__t');
        return g;
      });
      text(card, CARD.x + 16, CARD.y + CARD.h - 12, 'Inputs: priority, wait time, GPU count', 'rig-meta hx-inputs');

      // GPUs, two clusters of four
      this.gpus = [];
      w.cfg.nodes.forEach((label, ni) => {
        const y = GPU.rows[ni];
        text(s, GPU.x0, y - 12, label, 'rig-h rig-h--node hx-node');
        for (let i = 0; i < 4; i++) {
          const x = GPU.x0 + i * GPU.dx;
          const g = el('g', { class: 'gpu', 'data-job': 'idle' }, s);
          at(g, x, y, GPU.s);
          g.innerHTML = A.gpu;
          el('rect', { class: 'gpu-bar-bg', x: x + 4, y: y + GPU.bar, width: GPU.w, height: 3, rx: 1.5 }, s);
          const bar = el('rect', { class: 'gpu-bar', x: 0, y: 0, width: GPU.w, height: 3, rx: 1.5 }, s);
          const label2 = text(s, x + 4 + GPU.w / 2, y + GPU.label, '', 'rig-meta rig-meta--gpu', { 'text-anchor': 'middle' });
          this.gpus.push({ g, bar, label: label2, x, y, fans: Array.from(g.querySelectorAll('.gpu-fan')) });
        }
      });

      text(s, QUEUE.x, QUEUE.y - 14, 'Queue, by score', 'rig-h');
      const nt = text(s, QUEUE.x, QUEUE.y + QUEUE.max * QUEUE.dy + 4, '', 'rig-meta hx-chip__note');
      this.note = [el('tspan', { x: QUEUE.x }, nt), el('tspan', { x: QUEUE.x, dy: 14 }, nt)];

      const m = el('g', { class: 'hx-meters' }, s);
      this.util = this.meter(m, GPU.x0, METER.y, 'GPU utilization');
      this.spendM = w.cfg.spend ? this.meter(m, GPU.x0 + 232, METER.y, 'Spend vs budget', true) : null;
      this.cardLayer = el('g', {}, s);
      this.fx = el('g', {}, s);
      this.chipLayer = el('g', {}, s);
      this.fan = 0;
    }

    meter(parent, x, y, label, budget) {
      const g = el('g', {}, parent);
      text(g, x, y - 12, label, 'rig-meta hx-meter__l');
      el('rect', { class: 'hx-meter__bg', x, y: y - 6, width: 150, height: 8, rx: 4 }, g);
      const fill = el('rect', { class: 'hx-meter__fill', x, y: y - 6, width: 0, height: 8, rx: 4 }, g);
      const val = text(g, x + 158, y + 2, '', 'rig-meta hx-meter__v');
      if (budget) el('line', { class: 'hx-meter__budget', x1: x + 128, x2: x + 128, y1: y - 10, y2: y + 6 }, g);
      return { fill, val };
    }

    enterCard(job, instant) {
      if (!this.cards) return;
      const g = el('g', { class: 'job-card', 'data-job': job.color }, this.cardLayer);
      g.innerHTML = A.cardW[job.id % 3];
      text(g, 10, 17, job.name, 'rig-card');
      const sub = text(g, 10, 32, '', 'rig-meta rig-meta--card');
      const score = text(g, 127, 17, '', 'rig-meta hx-score', { 'text-anchor': 'end' });
      const tag = text(g, 128, 32, '', 'rig-meta hx-tag', { 'text-anchor': 'end' });
      this.cards.set(job.id, { g, sub, score, tag, y: QUEUE.y + (QUEUE.max - 1) * QUEUE.dy + (instant ? 0 : 18), o: instant ? 1 : 0 });
    }

    popTick(job) {
      const gp = this.gpus && this.gpus[job.slots[0]];
      if (!gp || !this.fx || !this.playing) return;
      const g = el('g', { class: 'rig-pop' }, this.fx);
      g.innerHTML = A.tick;
      at(g, gp.x + 27, gp.y + 14);
      setTimeout(() => g.remove(), 700);
    }

    flyChip(label, kind, target) {
      if (!this.chipLayer) return;
      const g = el('g', { class: `hx-chip hx-chip--${kind}` }, this.chipLayer);
      const w = 22 + label.length * 6.6;
      el('rect', { class: 'hx-chip__box', x: 0, y: 0, width: w, height: 24, rx: 12 }, g);
      text(g, 12, 16, label, 'rig-meta hx-chip__t');
      this.chipN = ((this.chipN || 0) + 1) % 3;
      this.world.chips.push({ g, w, born: this.world.t, target, toCard: !target, x0: 632 - w, y0: target ? 20 : 26 + this.chipN * 44 });
    }

    /* ------------------------------------------------------------------ */
    render(dt) {
      const w = this.world;
      this.rules.forEach((r, i) => r.classList.toggle('is-on', w.ruleOn === i + 1 || (i === 0 && w.ruleOn > 0)));
      this.rules[2].classList.toggle('is-wait', w.ruleOn === 3);

      // GPUs
      this.fan = (this.fan + dt * 420) % 360;
      this.gpus.forEach((gp, i) => {
        const j = w.slots[i];
        const job = j ? j.color : 'idle';
        if (gp.g.getAttribute('data-job') !== job) { gp.g.setAttribute('data-job', job); gp.bar.setAttribute('data-job', job); }
        const p = j ? clamp(1 - j.left / j.dur, 0, 1) : 0;
        gp.bar.setAttribute('transform', `translate(${gp.x + 4} ${gp.y + GPU.bar}) scale(${p.toFixed(3)} 1)`);
        const lab = j ? (i === j.slots[0] ? j.name.toLowerCase() : '') : 'idle';
        if (gp.label.textContent !== lab) gp.label.textContent = lab;
        gp.label.classList.toggle('is-idle', !j);
        if (j && dt > 0) gp.fans.forEach((f, k) => f.setAttribute('transform', `rotate(${(this.fan + k * 30).toFixed(1)})`));
      });

      // Queue cards, in score order. The top one says why it's waiting.
      const order = w.sorted();
      // Keep the demo job on screen: it's the one the scenario is about.
      const demo = order.find((j) => j.demo);
      let shown = order.slice(0, QUEUE.max);
      if (demo && !shown.includes(demo)) shown = [...order.slice(0, QUEUE.max - 1), demo];
      const k = dt > 0 ? 1 - Math.exp(-dt / 0.14) : 1;
      for (const [id, c] of this.cards) {
        const job = w.jobs.find((j) => j.id === id);
        if (!job || job.status !== 'queued') { c.g.remove(); this.cards.delete(id); continue; }
        const vis = shown.indexOf(job);
        const idx = vis >= 0 ? vis : QUEUE.max;
        const ty = QUEUE.y + Math.min(idx, QUEUE.max - 1) * QUEUE.dy;
        c.y += (ty - c.y) * k;
        c.o += ((vis >= 0 ? 1 : 0) - c.o) * k;
        c.g.setAttribute('transform', `translate(${QUEUE.x} ${c.y.toFixed(1)}) scale(${QUEUE.s})`);
        c.g.setAttribute('opacity', c.o.toFixed(2));
        const sub = `P${job.prio}, ${job.gpus} GPU${job.gpus > 1 ? 's' : ''}`;
        if (c.sub.textContent !== sub) c.sub.textContent = sub;
        const sc = `${w.score(job)}`;
        if (c.score.textContent !== sc) c.score.textContent = sc;
        let tag = '';
        if (job.missed) tag = 'missed';
        else if (job.due) tag = job.due;
        else if (vis === 0 && job.blocked && w.freeSlots().length < job.gpus) tag = 'can’t fit';
        if (c.tag.textContent !== tag) c.tag.textContent = tag;
        c.tag.classList.toggle('is-bad', !!(job.missed || job.urgent || tag === 'can’t fit'));
        c.g.classList.toggle('is-missed', !!job.missed);
      }

      if (this.note) {
        const d = w.jobs.find((j) => j.demo);
        let note = ['', ''];
        if (d && d.missed) note = ['Deadline passed.', 'It never reached the top.'];
        else if (d && d.urgent) note = ['Deadline moved to Friday.', `Score still ${w.score(d)}.`];
        if (this.note[0].textContent !== note[0]) this.note[0].textContent = note[0];
        if (this.note[1].textContent !== note[1]) this.note[1].textContent = note[1];
      }

      // Chips: new information flies in, and the formula has nowhere to put it.
      for (const c of w.chips.slice()) {
        const age = w.t - c.born;
        let x;
        let y = c.y0;
        let o = 1;
        if (c.toCard) {
          const hitX = CARD.x + CARD.w + 8;
          if (age < 1.1) x = c.x0 + (hitX - c.x0) * ease(age / 1.1);
          else x = hitX + Math.sin(Math.min(1, (age - 1.1) / 0.3) * Math.PI) * 10;
          if (age > 1.1 && !c.cross) {
            c.cross = el('g', { class: 'hx-reject' }, c.g);
            c.cross.innerHTML = A.cross;
            at(c.cross, c.w - 18, -18, 0.8);
            c.note = text(c.g, 4, 40, 'not an input', 'rig-meta hx-chip__note');
          }
          if (age > 3.6) o = clamp(1 - (age - 3.6) / 0.6, 0, 1);
        } else {
          const card = this.cards.get(c.target && c.target.id);
          const tx = QUEUE.x + 70;
          const ty = card ? card.y + 12 : QUEUE.y;
          const p = ease(clamp(age / 1.2, 0, 1));
          x = c.x0 + (tx - c.x0) * p;
          y = c.y0 + (ty - c.y0) * p;
          if (age > 1.2) o = clamp(1 - (age - 1.2) / 0.4, 0, 1);
        }
        c.g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
        c.g.setAttribute('opacity', o.toFixed(2));
        if (o <= 0) { c.g.remove(); w.chips.splice(w.chips.indexOf(c), 1); }
      }

      // Meters
      const util = w.utilHist.length ? w.utilHist.reduce((a, b) => a + b, 0) / w.utilHist.length : 0;
      this.util.fill.setAttribute('width', (150 * util).toFixed(1));
      this.util.fill.classList.toggle('is-bad', util < 0.55);
      this.util.val.textContent = `${Math.round(util * 100)}%`;
      if (this.spendM) {
        const sp = clamp(w.spend, 0, 1.2);
        this.spendM.fill.setAttribute('width', (150 * Math.min(sp, 1)).toFixed(1));
        this.spendM.fill.classList.toggle('is-bad', sp > 0.85);
        this.spendM.val.textContent = sp > 0.85 ? 'over' : `${Math.round((sp / 0.85) * 100)}%`;
      }
    }

    frame(now) {
      this.raf = 0;
      const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0;
      this.last = now;
      if (this.playing && dt > 0) {
        this.world.step(dt);
        if (this.world.t >= this.world.cfg.len) {
          const next = this.auto ? ORDER[(ORDER.indexOf(this.key) + 1) % ORDER.length] : this.key;
          this.load(next);
        }
      }
      this.render(this.playing ? dt : 0);
      this.request();
    }

    request() {
      if (this.raf) return;
      if (!this.playing || !this.visible || doc.hidden) { this.last = 0; return; }
      this.raf = requestAnimationFrame((n) => this.frame(n));
    }

    pause() {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.last = 0;
    }

    bind() {
      this.tabs.forEach((b, i) => {
        b.addEventListener('click', () => {
          this.auto = false;
          this.load(b.dataset.scenario);
          this.request();
        });
        b.addEventListener('keydown', (e) => {
          const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
          if (!dir) return;
          e.preventDefault();
          const nb = this.tabs[(i + dir + this.tabs.length) % this.tabs.length];
          nb.focus();
          nb.click();
        });
      });
      if (this.runBtn) {
        this.runBtn.dataset.state = this.playing ? 'running' : 'stopped';
        this.runBtn.addEventListener('click', () => {
          this.playing = !this.playing;
          this.runBtn.dataset.state = this.playing ? 'running' : 'stopped';
          if (this.playing) this.request(); else this.pause();
        });
      }
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(([en]) => {
          this.visible = en.isIntersecting;
          if (this.visible) this.request(); else this.pause();
        }).observe(this.root);
      }
      doc.addEventListener('visibilitychange', () => { if (doc.hidden) this.pause(); else this.request(); });
    }
  }

  function init() {
    doc.querySelectorAll('[data-heuristic]').forEach((r) => { if (!r.__hx) r.__hx = new Scene(r); });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})();
