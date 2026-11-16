// Karma section: a scroll-driven matrix of 32 on-prem GPUs (4 nodes × 8) plus
// a cloud block. Scrolling steps through: idle → jobs placed → node-3 fails and
// its jobs move → the cluster is full so cloud GPUs come up → node-3 repaired.
// Deterministic in scroll position, so scrolling back rewinds it.

import { createStage, bakeCard, THREE, reduceMotion } from '../stage.js';

const NODES = 3, PER = 5, CLOUD_COLS = 2;
const PX = 1.5, PY = 3.3, GAP = 1.4;
const FAIL_ROW = 1;

const COL = {
  idle: new THREE.Color('#525252'),
  running: new THREE.Color('#3d5fd0'),
  failed: new THREE.Color('#d0742c'),
  prov: new THREE.Color('#dfe6ee'),
  lightOff: new THREE.Color('#1c1e22'),
};

// seeded random so the story is the same every visit
function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

function plan() {
  const r = rng(7);
  const onprem = [];
  for (let n = 0; n < NODES; n++) for (let c = 0; c < PER; c++) onprem.push({ n, c });
  // 3 GPUs outside the failing node stay idle so there is somewhere to move to
  const others = onprem.filter((g) => g.n !== FAIL_ROW).sort(() => r() - 0.5);
  const idle = new Set(others.slice(0, 3));
  onprem.forEach((g) => {
    g.runAt = g.n === FAIL_ROW ? 0.1 + g.c * 0.03 : idle.has(g) ? Infinity : 0.08 + r() * 0.24;
    if (g.n === FAIL_ROW) { g.failAt = 0.42 + g.c * 0.008; g.repairAt = 0.9 + g.c * 0.006; }
  });
  const spare = [...idle];
  const cloud = [];
  for (let n = 0; n < NODES; n++) for (let c = 0; c < CLOUD_COLS; c++) cloud.push({ n, c, cloud: true, provAt: Infinity, runAt: Infinity });
  const moves = [];
  for (let c = 0; c < PER; c++) {
    const from = onprem.find((g) => g.n === FAIL_ROW && g.c === c);
    if (c < 3) {
      const to = spare[c]; to.runAt = 0.47 + c * 0.02; to.moved = true;
      moves.push({ from, to, at: to.runAt });
    } else {
      const to = cloud[c - 3]; to.provAt = 0.6 + (c - 3) * 0.025; to.runAt = to.provAt + 0.07; to.moved = true;
      moves.push({ from, to, at: to.runAt });
    }
  }
  // a burst of new work lands on more cloud GPUs
  for (let k = 2; k < 5; k++) { const g = cloud[k]; g.provAt = 0.66 + (k - 2) * 0.02; g.runAt = g.provAt + 0.08; }
  return { onprem, cloud, all: [...onprem, ...cloud], moves };
}

function stateAt(g, p) {
  if (g.cloud) return p < g.provAt ? 'absent' : p < g.runAt ? 'prov' : 'running';
  if (g.failAt != null) return p < g.runAt ? 'idle' : p < g.failAt ? 'running' : p < g.repairAt ? 'failed' : 'idle';
  return p < g.runAt ? 'idle' : 'running';
}

export const PHASES = [
  [0.0, 'A team’s GPUs, nothing running yet.'],
  [0.14, 'Jobs arrive. Agents place each one where it fits.'],
  [0.42, 'A node fails. Agents move its jobs.'],
  [0.58, 'The cluster is full. Agents bring up cloud GPUs.'],
  [0.88, 'The node is repaired and rejoins the pool.'],
];

export async function mountMatrix(el, overlay, track, opts) {
  const P = plan();
  // narrow screens stack the cloud block under the racks instead of beside them
  const r0 = el.getBoundingClientRect();
  const narrow = r0.width < 640 || r0.width / Math.max(1, r0.height) < 1;
  const totalW = narrow ? PER * PX : PER * PX + GAP + CLOUD_COLS * PX;
  const totalH = narrow ? (NODES + 2) * PY + GAP : NODES * PY;
  const x0 = -totalW / 2 + PX / 2;
  const yTop = totalH / 2 - PY / 2;
  const cloudIdx = (g) => g.n * CLOUD_COLS + g.c; // 0..15
  const xOf = (g) => {
    if (!g.cloud) return x0 + g.c * PX;
    return narrow ? x0 + (cloudIdx(g) % PER) * PX : x0 + g.c * PX + PER * PX + GAP;
  };
  const yOf = (g) => {
    if (!g.cloud || !narrow) return yTop - g.n * PY;
    return yTop - (NODES + Math.floor(cloudIdx(g) / PER)) * PY - GAP;
  };

  const stage = await createStage(el, {
    ...opts,
    fit: () => (narrow ? { w: totalW + 0.6, h: totalH + 0.9 } : { w: totalW + 0.5, h: totalH + 1.0 }),
    offset: () => (narrow ? { x: 0, y: -0.2 } : { x: 0, y: -0.25 }),
    yaw: -0.04, pitch: 0.14, swing: 0.025, spin: 0.12, parallax: 0.03,
  });

  const baked = bakeCard(opts.accent);
  const N = P.all.length;
  const upright = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
  const tinted = { shell: true, light: true, hub: true };
  const inst = {};
  for (const k in baked.parts) {
    const m = tinted[k] ? baked.mat[k].clone() : baked.mat[k];
    if (tinted[k]) m.color.set('#ffffff');
    if (k === 'hub') { m.emissive.set('#000000'); }
    const im = new THREE.InstancedMesh(baked.parts[k], m, N);
    if (tinted[k]) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
    stage.rig.add(im); inst[k] = im;
  }
  const rot = {};
  for (const k in baked.rotor) {
    const m = k === 'hub' ? baked.mat[k].clone() : baked.mat[k];
    if (k === 'hub') { m.color.set('#ffffff'); m.emissive.set('#000000'); }
    const im = new THREE.InstancedMesh(baked.rotor[k], m, N * 2);
    if (k === 'hub') im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 2 * 3), 3);
    stage.rig.add(im); rot[k] = im;
  }
  // ghost panels for cloud slots that do not exist yet
  const ghostMat = new THREE.MeshBasicMaterial({ color: '#3a3a3a' });
  const ghostGeo = new THREE.BoxGeometry(2.8, 1.12, 0.02);
  const outlines = new THREE.Group();
  P.cloud.forEach((g) => { const m = new THREE.Mesh(ghostGeo, ghostMat); m.position.set(xOf(g), yOf(g), 0); m.rotation.z = Math.PI / 2; m.userData.g = g; outlines.add(m); });
  stage.rig.add(outlines);

  P.all.forEach((g, i) => {
    g.i = i; g.x = xOf(g); g.y = yOf(g);
    g.col = COL.idle.clone(); g.light = COL.lightOff.clone(); g.appear = g.cloud ? 0 : 1;
    g.fan = Math.random() * 6; g.speed = 1; g.state = 'idle';
  });

  // ---------- overlay ----------
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg'); svg.classList.add('agents__svg'); overlay.append(svg);
  const mk = (tag, cls, txt) => { const n = document.createElement(tag); n.className = cls; if (txt != null) n.textContent = txt; overlay.append(n); return n; };
  const grpOn = mk('p', 'mx__grp', 'on-prem');
  const grpCloud = mk('p', 'mx__grp mx__grp--cloud', 'cloud');
  const host = overlay.closest('.mx__sticky');
  const status = host.querySelector('[data-mx-status]');
  const moveWires = P.moves.map((m) => { const path = document.createElementNS(NS, 'path'); path.classList.add('wire', 'wire--move'); svg.append(path); return { ...m, path }; });

  // ---------- scroll progress ----------
  // ---------- time-driven loop (no scrolling): plays while on screen ----------
  // 0..1 runs the story over LOOP seconds, holds the last state, then rewinds to idle.
  const LOOP = 22, HOLD = 3, REWIND = 2.5;
  let clock = 0, p = reduceMotion ? 0.62 : 0;
  // the story starts once most of the grid is on screen
  let inView = false;
  new IntersectionObserver(([e]) => { inView = e.intersectionRatio > 0.45; }, { threshold: [0, 0.45, 0.6] }).observe(el);
  const progress = () => {
    const c = clock % (LOOP + HOLD + REWIND);
    if (c < LOOP) return c / LOOP;
    if (c < LOOP + HOLD) return 1;
    return 0;
  };

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), tmp = new THREE.Matrix4();
  const at = (x, y, z = 0) => stage.project(v.set(x, y, z));
  let lastPhase = -1, lastCounts = '';
  let flickT = 0;

  stage.onFrame = (dt) => {
    const prev = p;
    if (!reduceMotion && inView) { clock += dt; p = progress(); }
    const forward = p > prev + 1e-5;
    flickT += dt; const flick = flickT > 0.09; if (flick) flickT = 0;
    const tally = { running: 0, idle: 0, failed: 0, prov: 0 };

    for (const g of P.all) {
      const st = stateAt(g, p);
      if (st !== g.state) {
        if (forward && st === 'running' && g.moved) { const c = at(g.x, g.y, 0.2); stage.pulse(c.x, c.y, { size: 0.5 }); }
        if (forward && st === 'failed' && g.c === 0) { const c = at(x0 + 2 * PX, g.y, 0.2); stage.pulse(c.x, c.y, { warm: true, size: 1.6 }); }
        g.state = st;
      }
      if (st !== 'absent') tally[st]++;
      const k = Math.min(1, dt * 6);
      if (st === 'failed' && flick) g.col.copy(Math.random() < 0.3 ? COL.idle : COL.failed);
      else if (st === 'prov' && flick) g.col.copy(Math.random() < 0.5 ? COL.prov : COL.idle);
      else if (st !== 'failed' && st !== 'prov') g.col.lerp(COL[st] || COL.idle, k);
      g.light.lerp(st === 'running' ? COL.running : st === 'failed' ? COL.failed : COL.lightOff, k);
      g.appear += ((st === 'absent' ? 0 : 1) - g.appear) * Math.min(1, dt * 5);
      const wantSpeed = st === 'running' ? 11 : st === 'prov' ? 5 : st === 'failed' ? 0 : 1;
      g.speed += (wantSpeed - g.speed) * Math.min(1, dt * 1.5);
      g.fan += dt * g.speed;

      const s = g.appear < 0.02 ? 0.0001 : 0.6 + 0.4 * g.appear;
      m4.compose(v.set(g.x, g.y, 0), q.identity(), sc.set(s, s, s)).multiply(upright);
      for (const k2 in inst) inst[k2].setMatrixAt(g.i, m4);
      inst.shell.setColorAt(g.i, g.col);
      inst.light.setColorAt(g.i, g.light);
      baked.fanPos.forEach((fp, j) => {
        tmp.copy(m4).multiply(new THREE.Matrix4().makeTranslation(fp.x, fp.y, fp.z)).multiply(new THREE.Matrix4().makeRotationZ(g.fan * (j ? -1 : 1)));
        for (const k2 in rot) rot[k2].setMatrixAt(g.i * 2 + j, tmp);
        rot.hub.setColorAt(g.i * 2 + j, st === 'running' ? COL.running : COL.lightOff);
      });
    }
    for (const k2 in inst) { inst[k2].instanceMatrix.needsUpdate = true; if (inst[k2].instanceColor) inst[k2].instanceColor.needsUpdate = true; }
    for (const k2 in rot) { rot[k2].instanceMatrix.needsUpdate = true; if (rot[k2].instanceColor) rot[k2].instanceColor.needsUpdate = true; }
    outlines.children.forEach((m) => { m.visible = m.userData.g.appear < 0.5; });

    // overlay
    const { W, H } = stage.size();
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    { const a = at(x0 - 0.6, yTop + (narrow ? 1.75 : 1.9)); grpOn.style.transform = `translate(${a.x}px, ${a.y}px)`; }
    { const a = narrow ? at(x0 - 0.6, yTop - NODES * PY - GAP + 1.7) : at(x0 + PER * PX + GAP - 0.6, yTop + 1.9); grpCloud.style.transform = `translate(${a.x}px, ${a.y}px)`; }
    moveWires.forEach((w) => {
      const t = (p - (w.at - 0.035)) / 0.035;
      if (t <= 0 || t >= 1.6) { w.path.style.opacity = '0'; return; }
      const a = at(w.from.x, w.from.y, 0.2), b = at(w.to.x, w.to.y, 0.2);
      const my = Math.min(a.y, b.y) - 40;
      w.path.setAttribute('d', `M${a.x} ${a.y} C${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y}`);
      const len = w.path.getTotalLength();
      w.path.style.strokeDasharray = `${len}`;
      w.path.style.strokeDashoffset = `${len * (1 - Math.min(1, t))}`;
      w.path.style.opacity = t > 1 ? String(Math.max(0, 1 - (t - 1) / 0.6)) : '1';
    });

    let ph = 0; PHASES.forEach(([s0], i) => { if (p >= s0) ph = i; });
    if (ph !== lastPhase && status) { status.textContent = PHASES[ph][1]; status.dataset.phase = String(ph); lastPhase = ph; }
  };
  stage.start();
  return stage;
}
