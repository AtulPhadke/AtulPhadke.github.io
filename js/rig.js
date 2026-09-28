/* Atul Phadke · portfolio · the rig
 * A small animated diorama of MLbroker at work: jobs wait in a queue, the
 * agent (the robot from Atul's sketches) weighs spot price, deadlines, and
 * load, a safety check approves or rejects, and the job lands on GPUs.
 * Now and then a spot node is interrupted and its jobs checkpoint and requeue.
 * Everything is simulated and illustrative. Art: js/rig-art.js (rough.js,
 * pre-rendered). Colours: css/rig.css. No dependencies.
 *
 * Events on document:
 *   listens  scope:run      { running: boolean }
 *   emits    rig:decision   { text }
 */
(() => {
  'use strict';

  const ART = window.RigArt;
  if (!ART) return;
  const A = ART.art;
  const SIZE = ART.size;
  const NS = 'http://www.w3.org/2000/svg';
  const doc = document;
  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

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

  function el(name, attrs, parent) {
    const n = doc.createElementNS(NS, name);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function art(html, attrs, parent) {
    const g = el('g', attrs, parent);
    g.innerHTML = html;
    return g;
  }
  function text(parent, x, y, str, cls, attrs) {
    const t = el('text', { x, y, class: cls, ...(attrs || {}) }, parent);
    t.textContent = str;
    return t;
  }
  const at = (node, x, y, s = 1) => node.setAttribute('transform', s === 1 ? `translate(${x} ${y})` : `translate(${x} ${y}) scale(${s})`);

  /* ------------------------------------------------------------------ *
   * Layouts. Wide for the desktop hero column, narrow for phones.
   * ------------------------------------------------------------------ */
  const LAYOUTS = {
    wide: {
      vb: [700, 362],
      queue: { x: 6, y: 34, dx: 0, dy: 46, max: 5, card: 'cardW', title: [8, 22] },
      robot: { x: 170, y: 96, s: 1.18 },
      bubble: { x: 166, y: 8, art: 'bubbleW', puff: [226, 64], fs: 'rig-bubble', l1: 22, l2: 39 },
      inputs: { x: 8, y: 302, dx: [0, 132, 236], dy: 0, gap: 26, short: false, label: [8, 292] },
      shield: { x: 330, y: 148 },
      nodes: [{ x: 430, y: 30, art: 'nodeW' }, { x: 430, y: 132, art: 'nodeW' }, { x: 430, y: 234, art: 'nodeW' }],
      gpu: { s: 0.9, dx: 62, x0: 10, y0: 30, bar: 73, label: 86 },
      tally: { x: 562, y: 352, center: true },
    },
    narrow: {
      vb: [360, 578],
      queue: { x: 8, y: 34, dx: 116, dy: 0, max: 3, card: 'cardN', title: [10, 22] },
      robot: { x: 10, y: 96, s: 0.86 },
      bubble: { x: 136, y: 88, art: 'bubbleN', puff: [114, 118], fs: 'rig-bubble rig-bubble--sm' },
      inputs: { x: 138, y: 160, dx: [0, 74, 148], dy: 0, short: true },
      shield: { x: 164, y: 190 },
      nodes: [{ x: 12, y: 256, art: 'nodeN' }, { x: 12, y: 352, art: 'nodeN' }, { x: 12, y: 448, art: 'nodeN' }],
      gpu: { s: 1, dx: 76, x0: 24, y0: 28, bar: 76, label: null },
      tally: { x: 12, y: 562 },
    },
  };

  const TYPES = [
    { name: 'Pretraining', short: 'pretrain', job: 'blue', k: 4, dur: [30, 38], w: 0.8 },
    { name: 'Training', short: 'train', job: 'green', k: 2, dur: [20, 26], w: 2 },
    { name: 'Sweep', short: 'sweep', job: 'amber', k: 1, dur: [12, 16], w: 2 },
    { name: 'Inference', short: 'infer', job: 'pink', k: 1, dur: [9, 12], w: 1.6, prio: 0.55 },
    { name: 'Smoke test', short: 'smoke', job: 'grey', k: 1, dur: [6, 8], w: 1 },
  ];
  const DUE = ['due 6h', 'due today', 'due Fri', 'due Mon'];

  class Rig {
    constructor(mount) {
      this.mount = mount;
      this.rnd = mulberry32(20260925);
      this.t = 0;
      this.tweens = [];
      this.nextId = 17;
      this.queue = [];
      this.nodes = [
        { id: 'onprem', label: 'On-prem', icon: 'building', spot: false, gpus: [null, null, null, null] },
        { id: 'ondemand', label: 'Cloud on-demand', icon: 'cloud', spot: false, priced: true, gpus: [null, null, null, null] },
        { id: 'spot', label: 'Cloud spot', icon: 'cloudSpot', spot: true, priced: true, gpus: [null, null, null, null] },
      ];
      this.onDemand = 3.1;
      this.running = [];
      this.price = 1.24;
      this.spikeUntil = -1;
      this.nextPriceTick = 0;
      this.nextArrival = 0;
      this.nextInterrupt = 26;
      this.agent = { phase: 'idle', until: 1.2 };
      this.tally = { placed: 0, deferred: 0, rejected: 0, preempted: 0 };
      this.lastReject = -20;
      this.fanAngle = 0;
      this.look = { x: 0, y: 0, tx: 0, ty: 0 };
      this.playing = !mqReduce.matches;
      this.visible = true;
      this.raf = 0;
      this.last = 0;

      this.svg = el('svg', { class: 'rig__svg', role: 'presentation', focusable: 'false' }, mount);
      this.layoutName = '';
      this.relayout();

      for (let i = 0; i < 4; i++) this.arrive(true);
      if (mqReduce.matches) this.staticFrame(); else this.warm();

      this.bindEvents();
      this.request();
    }

    /* ---------- scene ---------- */
    relayout() {
      const w = this.mount.clientWidth || 700;
      const name = w < 520 ? 'narrow' : 'wide';
      if (name === this.layoutName) return;
      this.layoutName = name;
      this.L = LAYOUTS[name];
      this.build();
    }

    build() {
      const L = this.L;
      const svg = this.svg;
      svg.innerHTML = '';
      svg.setAttribute('viewBox', `0 0 ${L.vb[0]} ${L.vb[1]}`);
      this.layers = {
        base: el('g', { class: 'rig-base' }, svg),
        trail: el('g', { class: 'rig-trails' }, svg),
        cards: el('g', { class: 'rig-cards' }, svg),
        fx: el('g', { class: 'rig-fx' }, svg),
      };
      const base = this.layers.base;

      text(base, L.queue.title[0], L.queue.title[1], 'Queue', 'rig-h');

      // nodes + GPU icons
      this.nodes.forEach((node, ni) => {
        const p = L.nodes[ni];
        const g = el('g', { class: `rig-node rig-node--${node.id}` }, base);
        at(g, p.x, p.y);
        art(A[p.art], {}, g);
        const icon = art(A[node.icon], {}, g);
        at(icon, 10, 5, 0.78);
        text(g, 34, 20, node.label, 'rig-h rig-h--node');
        node.priceText = node.priced ? text(g, SIZE[p.art][0] - 12, 20, '', 'rig-meta', { 'text-anchor': 'end' }) : null;
        node.g = g;
        node.slots = [0, 1, 2, 3].map((si) => {
          const sg = el('g', { class: 'gpu', 'data-job': 'idle' }, g);
          const x = L.gpu.x0 + si * L.gpu.dx;
          at(sg, x, L.gpu.y0, L.gpu.s);
          sg.innerHTML = A.gpu;
          const bw = SIZE.gpu[0] * L.gpu.s - 6;
          el('rect', { class: 'gpu-bar-bg', x, y: L.gpu.bar, width: bw, height: 3, rx: 1.5 }, g);
          const bar = el('rect', { class: 'gpu-bar', x: 0, y: 0, width: bw, height: 3, rx: 1.5 }, g);
          bar.setAttribute('transform', `translate(${x} ${L.gpu.bar}) scale(0 1)`);
          const label = L.gpu.label ? text(g, x + bw / 2, L.gpu.label, '', 'rig-meta rig-meta--gpu', { 'text-anchor': 'middle' }) : null;
          return { g: sg, fans: Array.from(sg.querySelectorAll('.gpu-fan')), bar, label, x: p.x + x, y: p.y + L.gpu.y0, w: SIZE.gpu[0] * L.gpu.s, h: SIZE.gpu[1] * L.gpu.s, bx: x, by: L.gpu.bar };
        });
      });

      // robot + bubble
      this.robot = art(A.robot, { class: 'robot' }, base);
      at(this.robot, L.robot.x, L.robot.y, L.robot.s);
      this.robotHead = this.robot.querySelector('.robot-head');
      this.pupils = this.robot.querySelector('.robot-pupils');
      this.bubble = el('g', { class: 'rig-bubble-g', opacity: 0 }, base);
      at(this.bubble, L.bubble.x, L.bubble.y);
      art(A[L.bubble.art], {}, this.bubble);
      this.puff = art(A.puff, { opacity: 0 }, base);
      at(this.puff, L.bubble.puff[0], L.bubble.puff[1]);
      this.bubbleL1 = text(this.bubble, 14, L.bubble.l1 || 25, '', L.bubble.fs);
      this.bubbleL2 = text(this.bubble, 14, L.bubble.l2 || 44, '', `${L.bubble.fs} rig-bubble--2`);

      // inputs
      const I = L.inputs;
      this.inputs = ['tag', 'clock', 'gauge'].map((icon, i) => {
        const g = el('g', { class: 'rig-input' }, base);
        at(g, I.x + I.dx[i], I.y + i * I.dy);
        art(A[icon], {}, g);
        const t = text(g, 30, 17, '', 'rig-meta rig-meta--input');
        return { g, t, needle: g.querySelector('.gauge-needle') };
      });
      if (I.label) text(base, I.label[0], I.label[1], 'What the agent weighs', 'rig-meta rig-meta--label');

      // shield
      this.shield = el('g', { class: 'shield', 'data-state': 'idle' }, base);
      at(this.shield, L.shield.x, L.shield.y);
      art(A.shield, {}, this.shield);
      this.shieldMark = el('g', { class: 'shield-mark' }, this.shield);
      text(base, L.shield.x + 16, L.shield.y + 50, 'safety check', 'rig-meta', { 'text-anchor': 'middle' });

      // tally
      const tally = text(base, L.tally.x, L.tally.y, '', 'rig-meta rig-meta--tally', L.tally.center ? { 'text-anchor': 'middle' } : {});
      this.tallyText = [0, 1, 2, 3].map((i) => el('tspan', i ? { dx: 14 } : {}, tally));

      // re-attach cards
      this.queue.forEach((job, i) => this.makeCard(job, this.queueSlot(i), true));
      this.renderGpus();
      this.renderInputs();
      this.renderTally();
    }

    queueSlot(i) {
      const Q = this.L.queue;
      const j = Math.min(i, Q.max - 1);   // overflow cards wait behind the last visible one
      return { x: Q.x + j * Q.dx, y: Q.y + j * Q.dy };
    }

    makeCard(job, pos, instant) {
      if (job.card) job.card.remove();
      const Q = this.L.queue;
      const [w, h] = SIZE[Q.card];
      const g = el('g', { class: 'job-card', 'data-job': job.type.job }, this.layers.cards);
      art(A[Q.card][job.id % 3], {}, g);
      const narrow = this.layoutName === 'narrow';
      text(g, 10, narrow ? 15 : 17, job.type.name, 'rig-card');
      text(g, 10, narrow ? 29 : 32, `${job.type.k} GPU${job.type.k > 1 ? 's' : ''}`, 'rig-meta rig-meta--card');
      if (job.prio) el('rect', { class: 'prio-tab', x: w - 16, y: -3, width: 10, height: 12, rx: 2 }, g);
      job.deferTag = text(g, w - 9, narrow ? 29 : 32, job.requeued ? 'resumes' : '', 'rig-meta rig-meta--defer', { 'text-anchor': 'end' });
      job.card = g;
      job.cw = w;
      job.ch = h;
      job.pos = { x: pos.x, y: pos.y + (instant ? 0 : 14), s: 1, o: instant ? 1 : 0 };
      job.target = { x: pos.x, y: pos.y, s: 1, o: 1 };
      job.flying = false;
      this.placeCard(job);
    }

    placeCard(job) {
      if (!job.card) return;
      const p = job.pos;
      job.card.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) scale(${p.s.toFixed(3)})`);
      const hidden = this.layoutName === 'narrow' && !job.flying && this.queue.indexOf(job) >= this.L.queue.max;
      job.card.setAttribute('opacity', hidden ? 0 : p.o.toFixed(2));
    }

    /* ---------- simulation ---------- */
    pickType() {
      const total = TYPES.reduce((s, t) => s + t.w, 0);
      let r = this.rnd() * total;
      for (const t of TYPES) { if ((r -= t.w) <= 0) return t; }
      return TYPES[2];
    }

    arrive(instant) {
      if (this.queue.length >= 5) return;
      const type = this.pickType();
      const job = {
        id: this.nextId++, type, prio: this.rnd() < (type.prio || 0.06),
        dur: lerp(type.dur[0], type.dur[1], this.rnd()), done: 0,
        due: DUE[Math.floor(this.rnd() * DUE.length)], deferredUntil: -1, requeued: false,
      };
      if (job.prio) job.due = 'due 2h';
      this.queue.push(job);
      this.makeCard(job, this.queueSlot(this.queue.length - 1), instant);
    }

    freeSlots(node) { return node.gpus.map((j, i) => (j ? -1 : i)).filter((i) => i >= 0); }

    decide() {
      const now = this.t;
      const cands = this.queue.filter((j) => !j.flying && j.deferredUntil < now);
      if (!cands.length) return null;
      // urgent first, then checkpointed jobs waiting to resume, then first-come
      cands.sort((a, b) => (b.prio - a.prio) || (b.requeued - a.requeued) || (this.queue.indexOf(a) - this.queue.indexOf(b)));
      const [onprem, ondemand, spot] = this.nodes;
      const spiked = this.price > 1.9;
      const fits = (node, k) => this.freeSlots(node).length >= k;
      const place = (job, node, l2) => ({
        kind: 'place', job, node, slots: this.freeSlots(node).slice(0, job.type.k),
        l1: `${job.requeued ? 'Resume' : 'Place'} ${job.type.name}`, l2,
      });
      const gpus = (k) => `${k} GPU${k > 1 ? 's' : ''}`;
      const spotPrice = `$${this.price.toFixed(2)}/hr`;
      const odPrice = `$${this.onDemand.toFixed(2)}/hr`;

      for (const job of cands) {
        const k = job.type.k;
        // Owned hardware first: it's already paid for.
        if (fits(onprem, k)) return place(job, onprem, `on-prem, ${gpus(k)} free`);
        // Urgent work buys reliable capacity.
        if (job.prio && fits(ondemand, k)) return place(job, ondemand, `on-demand at ${odPrice}, it's ${job.due}`);
        if (job.prio) continue;
        // Everything else rides spot while the price is fair.
        if (fits(spot, k) && !spiked) return place(job, spot, `spot at ${spotPrice}`);
        if (spiked && fits(spot, k)) {
          if (k >= 2 && fits(ondemand, k)) return place(job, ondemand, `spot spiked, on-demand at ${odPrice}`);
          return { kind: 'defer', job, l1: `Defer ${job.type.name}`, l2: `spot spiked to ${spotPrice}, it can wait` };
        }
        // Spot is full: long jobs shouldn't sit in the queue.
        if (k >= 2 && fits(ondemand, k)) return place(job, ondemand, `spot is full, on-demand at ${odPrice}`);
      }
      const top = cands[0];
      if (top.prio) {
        const victim = this.running.filter((r) => !r.prio && r.slots.length >= top.type.k)
          .sort((a, b) => a.done / a.dur - b.done / b.dur)[0];
        if (victim) {
          return { kind: 'preempt', job: top, victim, node: victim.node, slots: victim.slots.slice(0, top.type.k), l1: `Preempt ${victim.type.name}`, l2: `for ${top.type.name}, it's ${top.due}` };
        }
      }
      return null;
    }

    step(dt) {
      this.t += dt;
      const t = this.t;

      // spot price drifts; sometimes it spikes
      if (t >= this.nextPriceTick) {
        this.nextPriceTick = t + 1;
        if (t < this.spikeUntil) this.price = lerp(this.price, 2.35, 0.35);
        else {
          this.price = clamp(this.price + (this.rnd() - 0.5) * 0.12, 0.92, 1.62);
          this.onDemand = clamp(this.onDemand + (this.rnd() - 0.5) * 0.04, 3.02, 3.24);
          if (this.rnd() < 0.02) this.spikeUntil = t + 5;
        }
        this.renderInputs();
      }

      if (t >= this.nextArrival) {
        this.arrive(false);
        this.nextArrival = t + 1.4 + this.rnd() * 1.0;
      }

      for (const r of this.running.slice()) {
        r.done += dt;
        if (r.done >= r.dur) this.finish(r);
      }

      if (t >= this.nextInterrupt && this.agent.phase === 'idle') {
        const hit = this.running.filter((r) => r.node.spot);
        if (hit.length) this.interrupt(hit);
        this.nextInterrupt = t + 24 + this.rnd() * 12;
      }

      const a = this.agent;
      if (a.phase === 'idle' && t >= a.until) {
        const d = this.decide();
        if (d) this.think(d);
        else a.until = t + 0.3;
      }

      for (const tw of this.tweens.slice()) {
        const p = clamp((t - tw.t0) / tw.dur, 0, 1);
        tw.fn(p);
        if (p >= 1) {
          this.tweens.splice(this.tweens.indexOf(tw), 1);
          if (tw.done) tw.done();
        }
      }

      // queue cards glide to their slots
      const k = 1 - Math.exp(-dt / 0.14);
      this.queue.forEach((job, i) => {
        if (job.flying || !job.card) return;
        const slot = this.queueSlot(i);
        const p = job.pos;
        p.x += (slot.x - p.x) * k;
        p.y += (slot.y - p.y) * k;
        p.o += (1 - p.o) * k;
        p.s += (1 - p.s) * k;
        this.placeCard(job);
        const tag = job.deferredUntil > t ? 'deferred' : job.requeued ? 'resumes' : '';
        if (job.deferTag.textContent !== tag) {
          job.deferTag.textContent = tag;
          job.deferTag.classList.toggle('is-resume', tag === 'resumes');
        }
      });

      // eyes follow what the agent is looking at
      const lk = this.look;
      const kl = 1 - Math.exp(-dt / 0.12);
      lk.x += (lk.tx - lk.x) * kl;
      lk.y += (lk.ty - lk.y) * kl;
      if (this.pupils) this.pupils.setAttribute('transform', `translate(${lk.x.toFixed(2)} ${lk.y.toFixed(2)})`);
      if (this.robotHead) this.robotHead.setAttribute('transform', `rotate(${(lk.x * 1.6).toFixed(2)} 48 40)`);

      const R = this.L.robot;
      at(this.robot, R.x, (R.y + Math.sin(t * 2.4) * 1.8).toFixed(2), R.s);

      this.spinFans(dt);
      this.renderGpus();
    }

    tween(dur, fn, done) { this.tweens.push({ t0: this.t, dur, fn, done }); }
    wait(dur, done) { this.tween(dur, () => {}, done); }

    say(l1, l2) {
      this.bubbleL1.textContent = l1;
      this.bubbleL2.textContent = l2;
      this.tween(0.25, (p) => { this.bubble.setAttribute('opacity', p); this.puff.setAttribute('opacity', p); });
      doc.dispatchEvent(new CustomEvent('rig:decision', { detail: { text: `${l1}: ${l2}` } }));
    }
    hush() {
      this.tween(0.3, (p) => { this.bubble.setAttribute('opacity', 1 - p); this.puff.setAttribute('opacity', 1 - p); });
    }

    think(d) {
      this.agent.phase = 'busy';
      const job = d.job;
      this.look.tx = -2.2;
      this.look.ty = 0.6;
      this.say(d.l1, d.l2);

      if (d.kind === 'defer') {
        this.wait(1.4, () => {
          job.deferredUntil = this.t + 6;
          this.tally.deferred += 1;
          this.renderTally();
          this.wait(0.6, () => this.rest());
        });
        return;
      }

      // Would the safety layer reject this one?
      const reject = this.t - this.lastReject > 14 && this.rnd() < 0.16;
      const reason = d.kind === 'preempt' ? 'cap: 3 preemptions/hr' : 'over team GPU quota';

      this.wait(0.55, () => {
        this.look.tx = 2.2;
        this.look.ty = 0.2;
        const S = this.L.shield;
        const shieldPt = { x: S.x + 16 - job.cw * 0.25, y: S.y + 18 - job.ch * 0.25 };
        this.fly(job, shieldPt, 0.42, 0.5, () => {
          this.stamp(!reject);
          if (reject) {
            this.lastReject = this.t;
            this.bubbleL2.textContent = `rejected: ${reason}`;
            doc.dispatchEvent(new CustomEvent('rig:decision', { detail: { text: `${d.l1}: rejected, ${reason}` } }));
            this.tally.rejected += 1;
            this.renderTally();
            this.wait(0.8, () => {
              job.flying = false;
              job.deferredUntil = this.t + 5;
              this.wait(0.6, () => this.rest());
            });
            return;
          }
          const go = () => {
            const first = d.node.slots[d.slots[0]];
            const target = { x: first.x - 2, y: first.y + 4 };
            this.fly(job, target, 0.5, 0.4, () => {
              this.start(job, d.node, d.slots);
              this.wait(0.25, () => this.rest());
            });
          };
          if (d.kind === 'preempt') {
            this.tally.preempted += 1;
            this.checkpoint([d.victim], go);
          } else go();
        });
      });
    }

    rest() {
      this.hush();
      this.stamp(null);
      this.look.tx = 0;
      this.look.ty = 0;
      this.agent.phase = 'idle';
      this.agent.until = this.t + 0.25 + this.rnd() * 0.25;
    }

    fly(job, to, dur, scale, done) {
      job.flying = true;
      const from = { ...job.pos };
      const cx = (from.x + to.x) / 2;
      const cy = Math.min(from.y, to.y) - 40;
      const hw = job.cw / 2;
      const hh = job.ch / 2;
      const trail = el('path', { class: 'rig-trail', d: `M${(from.x + hw * from.s).toFixed(1)} ${(from.y + hh * from.s).toFixed(1)} Q${(cx + hw).toFixed(1)} ${(cy + hh).toFixed(1)} ${(to.x + hw * scale).toFixed(1)} ${(to.y + hh * scale).toFixed(1)}` }, this.layers.trail);
      this.tween(dur, (p) => {
        const e = easeInOut(p);
        const u = 1 - e;
        job.pos.x = u * u * from.x + 2 * u * e * cx + e * e * to.x;
        job.pos.y = u * u * from.y + 2 * u * e * cy + e * e * to.y;
        job.pos.s = lerp(from.s, scale, e);
        job.pos.o = 1;
        this.placeCard(job);
        trail.setAttribute('opacity', (0.6 * (1 - p * 0.5)).toFixed(2));
      }, () => {
        this.tween(0.35, (p) => trail.setAttribute('opacity', (0.3 * (1 - p)).toFixed(2)), () => trail.remove());
        if (done) done();
      });
    }

    stamp(ok) {
      this.shield.setAttribute('data-state', ok === null ? 'idle' : ok ? 'pass' : 'fail');
      this.shieldMark.innerHTML = ok === null ? '' : ok ? A.check : A.cross;
    }

    start(job, node, slots) {
      const i = this.queue.indexOf(job);
      if (i >= 0) this.queue.splice(i, 1);
      if (job.card) { job.card.remove(); job.card = null; }
      const r = { ...job, card: null, node, slots, done: job.done || 0 };
      slots.forEach((s) => { node.gpus[s] = r; });
      this.running.push(r);
      this.tally.placed += 1;
      this.renderTally();
      this.renderInputs();
    }

    finish(r) {
      r.slots.forEach((s) => { r.node.gpus[s] = null; });
      this.running.splice(this.running.indexOf(r), 1);
      const slot = r.node.slots[r.slots[0]];
      this.pop(A.tick, slot.x + slot.w / 2 - 10, slot.y + slot.h / 2 - 12);
      this.renderInputs();
    }

    pop(html, x, y, hold = 0.7) {
      const g = art(html, { class: 'rig-pop', opacity: 0 }, this.layers.fx);
      this.tween(0.25, (p) => { g.setAttribute('transform', `translate(${x} ${(y - 6 * easeOut(p)).toFixed(1)})`); g.setAttribute('opacity', p.toFixed(2)); }, () => {
        this.wait(hold, () => this.tween(0.3, (p) => g.setAttribute('opacity', (1 - p).toFixed(2)), () => g.remove()));
      });
    }

    /* Victims save a checkpoint, then go back to the queue to be resumed later. */
    checkpoint(victims, done) {
      victims.forEach((r) => {
        const slot = r.node.slots[r.slots[0]];
        this.pop(A.save, slot.x + slot.w / 2 - 12, slot.y + slot.h / 2 - 14, 0.5);
      });
      this.wait(0.7, () => {
        victims.forEach((r) => {
          r.slots.forEach((s) => { r.node.gpus[s] = null; });
          const idx = this.running.indexOf(r);
          if (idx >= 0) this.running.splice(idx, 1);
          const slot = r.node.slots[r.slots[0]];
          const job = { id: r.id, type: r.type, prio: false, dur: r.dur, done: r.done, due: r.due, deferredUntil: this.t + 2.5, requeued: true };
          if (this.queue.length < 6) {
            this.queue.push(job);
            this.makeCard(job, { x: slot.x, y: slot.y }, true);
            job.pos = { x: slot.x - 2, y: slot.y + 4, s: 0.4, o: 1 };
            this.placeCard(job);
          }
        });
        this.renderInputs();
        if (done) done();
      });
    }

    interrupt(hits) {
      const node = this.nodes[2];
      const p = this.L.nodes[2];
      const w = SIZE[p.art][0];
      node.alert = true;
      const bolt = art(A.bolt, { class: 'rig-pop' }, node.g);
      at(bolt, w - 146, 4, 0.7);
      if (node.priceText) {
        node.priceText.textContent = 'spot interruption';
        node.priceText.classList.add('rig-meta--alert');
      }
      this.tween(0.6, (q) => {
        const j = Math.sin(q * Math.PI * 10) * 2 * (1 - q);
        at(node.g, p.x + j, p.y);
      });
      doc.dispatchEvent(new CustomEvent('rig:decision', { detail: { text: 'Spot interruption: checkpoint and requeue' } }));
      this.checkpoint(hits, () => {
        this.wait(1.6, () => this.tween(0.3, (q) => bolt.setAttribute('opacity', 1 - q), () => {
          bolt.remove();
          node.alert = false;
          if (node.priceText) node.priceText.classList.remove('rig-meta--alert');
          this.renderInputs();
        }));
      });
    }

    spinFans(dt) {
      this.fanAngle = (this.fanAngle + dt * 420) % 360;
      this.nodes.forEach((node) => node.slots.forEach((slot, i) => {
        if (!node.gpus[i] && dt > 0) return;
        slot.fans.forEach((f, fi) => f.setAttribute('transform', `rotate(${(this.fanAngle + fi * 30).toFixed(1)})`));
      }));
    }

    renderGpus() {
      this.nodes.forEach((node) => node.slots.forEach((slot, i) => {
        const r = node.gpus[i];
        const job = r ? r.type.job : 'idle';
        if (slot.g.getAttribute('data-job') !== job) {
          slot.g.setAttribute('data-job', job);
          slot.bar.setAttribute('data-job', job);
        }
        const p = r ? clamp(r.done / r.dur, 0, 1) : 0;
        slot.bar.setAttribute('transform', `translate(${slot.bx} ${slot.by}) scale(${p.toFixed(3)} 1)`);
        if (slot.label) {
          const want = r ? (i === r.slots[0] ? r.type.short : '') : 'idle';
          if (slot.label.textContent !== want) slot.label.textContent = want;
        }
      }));
    }

    renderInputs() {
      if (!this.inputs) return;
      const short = this.L.inputs.short;
      const busy = this.nodes.reduce((s, n) => s + n.gpus.filter(Boolean).length, 0);
      const total = this.nodes.length * 4;
      const load = Math.round((busy / total) * 100);
      const next = this.queue.find((j) => j.prio) || this.queue[0];
      this.inputs[0].t.textContent = `$${this.price.toFixed(2)}${short ? '' : '/hr spot'}`;
      this.inputs[1].t.textContent = next ? next.due : 'no deadlines';
      this.inputs[2].t.textContent = short ? `${load}%` : `${load}% GPUs busy`;
      if (this.inputs[2].needle) this.inputs[2].needle.setAttribute('transform', `translate(13 20) rotate(${(-80 + (160 * busy) / total).toFixed(1)})`);
      this.inputs[0].g.classList.toggle('is-alert', this.price > 1.9);
      const I = this.L.inputs;
      if (I.gap) {
        let x = I.x;
        this.inputs.forEach((inp) => {
          at(inp.g, x, I.y);
          let tw = 0;
          try { tw = inp.t.getComputedTextLength(); } catch (e) { tw = 0; }
          if (!tw) tw = inp.t.textContent.length * 6.6;
          x += 30 + tw + I.gap;
        });
      }
      if (this.nodes[1].priceText) this.nodes[1].priceText.textContent = `$${this.onDemand.toFixed(2)}/hr`;
      if (this.nodes[2].priceText && !this.nodes[2].alert) this.nodes[2].priceText.textContent = `$${this.price.toFixed(2)}/hr`;
    }

    renderTally() {
      if (!this.tallyText) return;
      const T = this.tally;
      [['Placed', T.placed], ['Deferred', T.deferred], ['Rejected', T.rejected], ['Preempted', T.preempted]]
        .forEach(([l, v], i) => { this.tallyText[i].textContent = `${l} ${v}`; });
    }

    /* ---------- time ---------- */
    warm() {
      // Start mid-story: a few jobs already running, the agent about to act.
      for (let i = 0; i < 45 * 30; i++) this.step(1 / 30);
      this.tally = { placed: 0, deferred: 0, rejected: 0, preempted: 0 };
      this.renderTally();
    }

    staticFrame() {
      // Reduced motion: one composed frame, no movement.
      for (let i = 0; i < 22 * 30; i++) this.step(1 / 30);
      this.tweens.slice().forEach((tw) => tw.fn(1));
      this.tweens = [];
      this.queue.forEach((job) => { job.flying = false; });
      this.step(0.5);
      this.tweens = [];
      this.bubbleL1.textContent = 'Place Training';
      this.bubbleL2.textContent = `spot at $${this.price.toFixed(2)}/hr`;
      this.bubble.setAttribute('opacity', 1);
      this.puff.setAttribute('opacity', 1);
      this.stamp(true);
      this.layers.trail.innerHTML = '';
      this.layers.fx.innerHTML = '';
      this.playing = false;
    }

    frame(now) {
      this.raf = 0;
      const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0;
      this.last = now;
      if (this.playing && dt > 0) this.step(dt);
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

    bindEvents() {
      doc.addEventListener('scope:run', (e) => {
        if (mqReduce.matches) return;
        this.playing = !!(e.detail && e.detail.running);
        this.mount.classList.toggle('is-stopped', !this.playing);
        if (this.playing) this.request(); else this.pause();
      });
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(([en]) => {
          this.visible = en.isIntersecting;
          if (this.visible) this.request(); else this.pause();
        }).observe(this.mount);
      }
      doc.addEventListener('visibilitychange', () => { if (doc.hidden) this.pause(); else this.request(); });
      if ('ResizeObserver' in window) {
        let timer = 0;
        new ResizeObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(() => this.relayout(), 150);
        }).observe(this.mount);
      }
      mqReduce.addEventListener('change', () => {
        if (mqReduce.matches) { this.pause(); this.playing = false; }
      });
    }
  }

  function init() {
    doc.querySelectorAll('[data-rig]').forEach((m) => {
      if (!m.__rig) m.__rig = new Rig(m);
    });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})();
