// Hero overlay: one agent loop running a small GPU fleet.
// Places jobs, gets every move checked, brings up cloud GPUs when the racks are
// full, moves work off a GPU that fails, and releases cloud GPUs it no longer needs.
// Illustrative only; the caption says the jobs are made up.

const JOBS = [
  ['finetune-esm', '8×H100'], ['embed-proteins', '1×L4'], ['eval-sweep', '2×H100'],
  ['train-vit', '4×A100'], ['fold-batch', '2×A100'], ['rl-rollouts', '4×H100'],
  ['sweep-lr', '1×A10G'], ['dock-screen', '2×L40S'], ['distill-7b', '8×A100'],
  ['bind-predict', '1×H100'], ['tokenize', '1×L4'],
];
const CHECKS = ['quota ok', 'budget ok', 'no preemption', 'priority ok'];
const BLOCKS = ['would preempt eval-sweep', 'over the team’s budget', 'node is draining'];

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => 1 - Math.pow(1 - t, 3);
const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function mountFleetAgents(root, fleet) {
  root.innerHTML = '';
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.classList.add('agents__svg');
  root.append(svg);

  const queueBox = el('div', 'agents__queue');
  const qHead = el('p', 'agents__head');
  const qList = el('ol', 'agents__chips');
  queueBox.append(qHead, qList);
  const log = el('ol', 'agents__log');
  const planner = el('div', 'reticle'); planner.append(el('span', 'reticle__tag', 'agent'));
  const verdict = el('div', 'verdict');
  const colLabels = fleet.cols.map((c) => { const n = el('p', `collabel${c.cloud ? ' collabel--cloud' : ''}`, c.label); root.append(n); return n; });
  root.append(queueBox, log, planner, verdict);

  // ---------- follow loop ----------
  const follow = new Set(); // { node, slot, at: 'top'|'center', dx, dy }
  const wires = new Set();  // { path, from(), to(), p, ride, packet, head }
  let plannerPos = { x: 60, y: 60 }, plannerGoal = null;

  const rel = (node) => {
    const a = node.getBoundingClientRect(), b = root.getBoundingClientRect();
    return { x: a.left - b.left + a.width / 2, y: a.bottom - b.top };
  };
  const curve = (a, b) => {
    const my = (a.y + b.y) / 2;
    return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} C${a.x.toFixed(1)} ${my.toFixed(1)}, ${b.x.toFixed(1)} ${my.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  };

  function tick() {
    const { W, H } = fleet.size();
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    colLabels.forEach((n, c) => { const p = fleet.colTop(c); n.style.transform = `translate(${p.x}px, ${p.y}px)`; });
    let head = null;
    wires.forEach((w) => {
      w.path.setAttribute('d', curve(w.from(), w.to()));
      const len = w.path.getTotalLength();
      w.path.style.strokeDasharray = `${len}`;
      w.path.style.strokeDashoffset = `${len * (1 - w.p)}`;
      if (w.packet) { const q = w.path.getPointAtLength(len * w.ride); w.packet.style.transform = `translate(${q.x}px, ${q.y}px)`; }
      if (w.head) head = w.path.getPointAtLength(len * w.p);
    });
    if (head) plannerPos = head;
    else if (plannerGoal) {
      const g = typeof plannerGoal === 'function' ? plannerGoal() : plannerGoal;
      plannerPos = { x: plannerPos.x + (g.x - plannerPos.x) * 0.14, y: plannerPos.y + (g.y - plannerPos.y) * 0.14 };
    }
    planner.style.transform = `translate(${plannerPos.x}px, ${plannerPos.y}px)`;
    follow.forEach((f) => {
      const p = f.at === 'center' ? fleet.center(f.slot) : fleet.top(f.slot);
      f.node.style.transform = `translate(${p.x + (f.dx || 0)}px, ${p.y + (f.dy || 0)}px)`;
    });
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  async function animate(ms, fn) {
    const s = performance.now();
    for (;;) {
      const t = Math.min(1, (performance.now() - s) / ms);
      fn(ease(t));
      if (t >= 1) return;
      await new Promise(requestAnimationFrame);
    }
  }

  // ---------- log ----------
  const t0 = performance.now();
  const stamp = () => { const s = Math.floor((performance.now() - t0) / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  function say(who, msg, kind = '') {
    const li = el('li', kind);
    li.append(el('span', 'log__t', stamp()), el('span', 'log__who', who), el('span', 'log__msg', msg));
    log.append(li);
    while (log.children.length > 3) log.firstElementChild.remove();
  }

  // ---------- queue ----------
  let nextJob = 0;
  const queue = [];
  function enqueue() {
    const [name, need] = JOBS[nextJob++ % JOBS.length];
    const li = el('li', 'chip');
    li.append(el('span', 'chip__name', name), el('span', 'chip__need', need));
    qList.append(li);
    queue.push({ name, need, node: li });
    requestAnimationFrame(() => li.classList.add('is-in'));
    qHead.textContent = `Queue · ${queue.length} waiting`;
  }
  const dequeue = (job) => { queue.splice(queue.indexOf(job), 1); job.node.remove(); qHead.textContent = `Queue · ${queue.length} waiting`; };

  // ---------- slot helpers ----------
  const S = fleet.slots;
  const free = (cloud) => S.filter((s) => s.cloud === cloud && s.state === 'idle');
  const absentCloud = () => S.filter((s) => s.cloud && s.state === 'absent');
  const runningOn = () => S.filter((s) => s.state === 'running');
  const tags = new Map(); // slot -> follow entry

  function tagSlot(s, text, hold = 1400) {
    untag(s);
    const n = el('div', 'running', text);
    root.append(n);
    const f = { node: n, slot: s, at: "top", dx: 0, dy: -17 };
    follow.add(f); tags.set(s, f);
    requestAnimationFrame(() => n.classList.add('is-on'));
    if (hold) setTimeout(() => { if (tags.get(s) === f) untag(s); }, hold);
  }
  function untag(s) {
    const f = tags.get(s); if (!f) return;
    tags.delete(s); f.node.classList.remove('is-on');
    setTimeout(() => { follow.delete(f); f.node.remove(); }, 400);
  }
  function showVerdict(s, ok, text) {
    verdict.className = `verdict ${ok ? 'is-ok' : 'is-no'}`;
    verdict.textContent = `${ok ? '✓' : '✕'} ${text}`;
    const f = { node: verdict, slot: s, at: 'center', dx: 18, dy: 4 };
    follow.add(f);
    requestAnimationFrame(() => verdict.classList.add('is-on'));
    return () => { verdict.classList.remove('is-on'); follow.delete(f); };
  }
  function wire(from, to) {
    const path = document.createElementNS(NS, 'path');
    path.classList.add('wire');
    svg.append(path);
    const w = { path, from, to, p: 0, ride: 0, packet: null, head: false };
    wires.add(w);
    return w;
  }
  const dropWire = (w, cls = 'is-done') => { w.path.classList.add(cls); setTimeout(() => { w.path.remove(); wires.delete(w); }, 500); };

  async function ride(w, label) {
    const packet = el('div', 'packet', label);
    root.append(packet);
    w.packet = packet;
    await animate(380, (t) => { w.ride = t; });
    packet.remove(); w.packet = null;
  }

  // ---------- behaviours ----------
  let round = 0;

  async function place(job, slot, blockFirst) {
    plannerGoal = () => { const p = rel(job.node); return { x: p.x - 20, y: p.y + 14 }; };
    job.node.classList.add('is-picked');
    say('agent', `read ${job.name} · needs ${job.need}`);
    await sleep(320);

    let w = wire(() => rel(job.node), () => fleet.top(slot));
    say('agent', `place on ${slot.id}`);
    w.head = true; await animate(460, (t) => { w.p = t; }); w.head = false;
    plannerGoal = () => fleet.center(slot);
    await sleep(80);

    if (blockFirst) {
      const why = pick(BLOCKS);
      const hide = showVerdict(slot, false, why);
      say('check', `blocked: ${why}`, 'is-no');
      await sleep(650);
      hide(); dropWire(w, 'is-dead');
      const alt = free(slot.cloud).filter((s) => s !== slot);
      if (alt.length) slot = pick(alt);
      say('agent', `re-plan → ${slot.id}`);
      w = wire(() => rel(job.node), () => fleet.top(slot));
      w.head = true; await animate(460, (t) => { w.p = t; }); w.head = false;
      plannerGoal = () => fleet.center(slot);
      await sleep(80);
    }

    const c = CHECKS[round % CHECKS.length];
    const hide = showVerdict(slot, true, c);
    say('check', `approved · ${c}`, 'is-ok');
    await sleep(280);
    job.node.classList.add('is-out');
    await ride(w, job.name);
    hide(); dropWire(w);
    fleet.set(slot, 'running'); slot.job = job.name; slot.ends = performance.now() + 7000 + Math.random() * 6000;
    fleet.pulse(slot);
    tagSlot(slot, job.name);
    say('agent', `${job.name} running on ${slot.id}`, 'is-run');
    dequeue(job); enqueue();
  }

  async function provision(slot) {
    plannerGoal = () => fleet.center(slot);
    say('agent', 'racks full · start a cloud GPU');
    await sleep(300);
    const hide = showVerdict(slot, true, 'under budget');
    say('check', 'approved · under budget', 'is-ok');
    fleet.set(slot, 'prov');
    tagSlot(slot, 'starting', 0);
    await sleep(900);
    hide();
    fleet.set(slot, 'idle'); untag(slot);
    fleet.pulse(slot);
    say('agent', `${slot.id} is up`, 'is-run');
    await sleep(120);
  }

  async function failAndMove() {
    const victims = runningOn().filter((s) => !s.cloud);
    if (!victims.length) return false;
    const bad = pick(victims);
    const job = bad.job;
    fleet.set(bad, 'failed');
    fleet.pulse(bad, true);
    tagSlot(bad, 'failed', 0);
    say('monitor', `${bad.id} failed a health check`, 'is-no');
    plannerGoal = () => fleet.center(bad);
    await sleep(500);

    let target = pick(free(false)) || pick(free(true));
    if (!target) {
      const spare = absentCloud()[0];
      if (!spare) return true;
      await provision(spare);
      target = spare;
    }
    const w = wire(() => fleet.center(bad), () => fleet.top(target));
    say('agent', `move ${job} → ${target.id}`);
    w.head = true; await animate(460, (t) => { w.p = t; }); w.head = false;
    plannerGoal = () => fleet.center(target);
    const hide = showVerdict(target, true, 'checkpoint found');
    say('check', 'approved · resumes from checkpoint', 'is-ok');
    await sleep(300);
    await ride(w, job);
    hide(); dropWire(w);
    fleet.set(target, 'running'); target.job = job; target.ends = performance.now() + 12000 + Math.random() * 8000;
    fleet.pulse(target);
    tagSlot(target, job);
    say('agent', `${job} resumed on ${target.id}`, 'is-run');
    untag(bad);
    bad.job = null; bad.repairAt = performance.now() + 5000;
    return true;
  }

  function housekeeping() {
    const now = performance.now();
    for (const s of S) {
      if (s.state === 'running' && s.ends && now > s.ends) {
        say('agent', `${s.job} finished on ${s.id}`);
        fleet.set(s, 'idle'); s.job = null; s.idleAt = now; untag(s);
        return true;
      }
      if (s.state === 'failed' && s.repairAt && now > s.repairAt) {
        say('monitor', `${s.id} repaired · back in the pool`);
        fleet.set(s, 'idle'); s.repairAt = null; s.idleAt = now; untag(s);
        return true;
      }
      if (s.cloud && s.state === 'idle' && now - (s.idleAt || now) > 3500 && free(false).length) {
        say('agent', `release ${s.id} · no longer needed`);
        fleet.set(s, 'absent'); s.idleAt = null;
        return true;
      }
    }
    return false;
  }

  async function step() {
    while (!fleet.visible) await sleep(400);
    if (housekeeping()) { await sleep(350); return; }

    if (round > 2 && round % 5 === 3 && runningOn().length >= 3) {
      round++;
      await failAndMove();
      await sleep(400);
      return;
    }

    const job = queue[0];
    let slot = pick(free(false));
    if (!slot) slot = pick(free(true));
    if (!slot) {
      const spare = absentCloud()[0];
      if (!spare) { say('agent', 'fleet is full · queue waits'); await sleep(2500); round++; return; }
      await provision(spare);
      slot = spare;
    }
    await place(job, slot, round % 4 === 1 && free(slot.cloud).length > 1);
    round++;
    plannerGoal = { x: 40 + Math.random() * 80, y: fleet.size().H * 0.22 };
    await sleep(250);
  }

  for (let i = 0; i < 3; i++) enqueue();

  if (reduce) {
    const s = S[1];
    fleet.set(s, 'running');
    fleet.set(S[4], 'running');
    say('agent', 'read finetune-esm · needs 8×H100');
    say('check', 'approved · quota ok', 'is-ok');
    say('agent', `finetune-esm running on ${s.id}`, 'is-run');
    planner.style.display = 'none';
    return;
  }

  // start with a few jobs already running so it reads as a fleet at work
  [1, 3].forEach((i, k) => {
    const s = S[i]; const [name] = JOBS[(k + 6) % JOBS.length];
    fleet.set(s, 'running'); s.job = name; s.ends = performance.now() + 5000 + k * 4000;
  });
  (async () => { await sleep(600); for (;;) { try { await step(); } catch (e) { console.error(e); await sleep(1000); } } })();
}
