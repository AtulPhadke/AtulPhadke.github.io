// Karma page hero: the agent team as a core in the middle, GPUs orbiting and
// spinning around it. The core hands jobs out along arcs; code checks each move;
// a GPU fails and its job moves; finished jobs release their GPU.
// Drawn through the same 0/1 glyph pass as everything else.

import { createStage, bakeCard, THREE, reduceMotion } from '../stage.js';

const C = {
  idle: new THREE.Color('#3a3d42'),
  run: new THREE.Color('#3d5fd0'),
  fail: new THREE.Color('#d0742c'),
  shell: new THREE.Color('#8a9098'),
  shellDim: new THREE.Color('#4a4e55'),
  packet: new THREE.Color('#e8eef5'),
};
const N = 6, R = 3.7;
const JOBS = ['finetune-esm', 'eval-sweep', 'train-vit', 'fold-batch', 'infer-llm', 'rl-rollout', 'embed-cells', 'tune-lr'];

export async function mountOrbit(el, logEl, opts) {
  const stage = await createStage(el, {
    ...opts,
    // generous fit: the ring rotates and the cards spin, so leave a margin all round
    fit: (W, H) => (W / H < 0.9 ? { w: 11.8, h: 9 } : { w: 13, h: 6.8 }),
    offset: { x: 0, y: 0.3 },
    yaw: 0, pitch: 0.4, swing: 0.05, spin: 0.12, parallax: 0.06,
  });
  const rig = stage.rig;
  const ring = new THREE.Group();
  rig.add(ring);

  /* ---- the agent core ---- */
  const core = new THREE.Group();
  ring.add(core);
  const shellMat = new THREE.MeshStandardMaterial({ color: '#9aa1aa', roughness: 0.35, metalness: 0.5, flatShading: true });
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 1), shellMat);
  const heartMat = new THREE.MeshStandardMaterial({ color: '#3d5fd0', emissive: '#22337a', emissiveIntensity: 0.6, roughness: 0.4 });
  const heart = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 16), heartMat);
  const shellWire = new THREE.Mesh(new THREE.IcosahedronGeometry(0.98, 1), new THREE.MeshBasicMaterial({ color: '#cfd6df', wireframe: true }));
  shell.material.transparent = true; shell.material.opacity = 0.55;
  core.add(heart, shell, shellWire);
  core.scale.setScalar(1.2);
  const bands = [0, 1].map((i) => {
    const b = new THREE.Mesh(new THREE.TorusGeometry(1.4 + i * 0.22, 0.03, 8, 96), new THREE.MeshStandardMaterial({ color: i ? '#6a7078' : '#b7bec7', roughness: 0.4, metalness: 0.4 }));
    b.rotation.x = Math.PI / 2 + (i ? -0.5 : 0.45); b.rotation.y = i ? 0.6 : -0.3;
    core.add(b); return b;
  });
  // orbit track: a dotted ellipse on the floor of the ring
  const track = new THREE.Group();
  const dotGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06), dotMat = new THREE.MeshBasicMaterial({ color: '#4a4e55' });
  for (let i = 0; i < 90; i++) { const a = (i / 90) * Math.PI * 2; const d = new THREE.Mesh(dotGeo, dotMat); d.position.set(Math.cos(a) * R, -0.85, Math.sin(a) * R); track.add(d); }
  ring.add(track);

  /* ---- GPUs ---- */
  const baked = bakeCard(opts.accent);
  const gpus = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const holder = new THREE.Group();
    holder.position.set(Math.cos(a) * R, 0, Math.sin(a) * R);
    const card = new THREE.Group();
    card.scale.setScalar(0.78);
    const sh = baked.mat.shell.clone(), light = baked.mat.light.clone(), hub = baked.mat.hub.clone();
    const pick = (k) => (k === 'shell' ? sh : k === 'light' ? light : k === 'hub' ? hub : baked.mat[k]);
    for (const k in baked.parts) card.add(new THREE.Mesh(baked.parts[k], pick(k)));
    const fans = baked.fanPos.map((p, j) => {
      const f = new THREE.Group(); f.position.copy(p); f.userData.dir = j ? -1 : 1;
      for (const k in baked.rotor) f.add(new THREE.Mesh(baked.rotor[k], pick(k)));
      card.add(f); return f;
    });
    holder.add(card);
    ring.add(holder);
    light.color.copy(C.idle);
    // a dotted link from the core to this GPU, lit while it runs a job
    const link = Array.from({ length: 9 }, (_, k) => {
      const d = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: '#3d5fd0' }));
      d.position.set(Math.cos(a) * R * (0.3 + k * 0.065), 0, Math.sin(a) * R * (0.3 + k * 0.065));
      d.visible = false; ring.add(d); return d;
    });
    gpus.push({ link, i, name: `gpu-${i + 1}`, holder, card, sh, light, hub, fans, state: 'idle', job: null, until: 0, phase: i * 1.1, spinV: 0.5 + (i % 3) * 0.12, fan: 0 });
  }

  /* ---- job packets travelling along arcs ---- */
  const packets = [];
  const pGeo = new THREE.BoxGeometry(0.24, 0.24, 0.24);
  const tGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  function launch(from, to, done, { back = false, warm = false } = {}) {
    const m = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({ color: warm ? '#e0954a' : C.packet }));
    const trail = Array.from({ length: 6 }, () => { const t = new THREE.Mesh(tGeo, new THREE.MeshBasicMaterial({ color: '#7d8aa8' })); ring.add(t); return t; });
    ring.add(m);
    packets.push({ m, trail, from, to, t: 0, dur: 1.05, done, back });
  }
  const posOf = (x) => (x === 'core' ? new THREE.Vector3(0, 0, 0) : x.holder.position.clone());
  const bez = (a, b, t) => {
    const mid = a.clone().lerp(b, 0.5); mid.y += 1.5;
    const u = 1 - t;
    return a.clone().multiplyScalar(u * u).add(mid.multiplyScalar(2 * u * t)).add(b.clone().multiplyScalar(t * t));
  };

  /* ---- the agent loop ---- */
  const lines = [];
  const say = (who, msg, kind = '') => {
    if (!logEl) return;
    lines.push({ who, msg, kind });
    while (lines.length > 3) lines.shift();
    logEl.innerHTML = lines.map((l) => `<li class="${l.kind}"><span>${l.who}</span>${l.msg}</li>`).join('');
  };
  let clock = 0, next = 1.2, jobN = 0, placed = 0;
  const flash = (g, warm) => { const p = stage.project(new THREE.Vector3().setFromMatrixPosition(g.holder.matrixWorld).applyMatrix4(new THREE.Matrix4().copy(rig.matrixWorld).invert())); stage.pulse(p.x, p.y, { warm, size: 0.8 }); };
  const setState = (g, s) => { g.state = s; };

  function step() {
    const idle = gpus.filter((g) => g.state === 'idle');
    const failed = gpus.find((g) => g.state === 'failed' && g.job);
    const running = gpus.filter((g) => g.state === 'running');
    if (failed && idle.length) {
      const to = idle[Math.floor(Math.random() * idle.length)];
      const job = failed.job; failed.job = null; to.state = 'incoming';
      say('planner', `${failed.name} failed · moving ${job} to ${to.name}`, 'is-no');
      launch(failed, to, () => { to.job = job; to.state = 'running'; to.until = clock + 5 + Math.random() * 4; flash(to); say('check', `${job} on ${to.name} · ok`, 'is-ok'); }, { warm: true });
      setTimeout(() => { if (failed.state === 'failed') failed.state = 'idle'; }, 3500);
      return;
    }
    if (running.length >= 3 && Math.random() < 0.18 && !gpus.some((g) => g.state === 'failed')) {
      const g = running[Math.floor(Math.random() * running.length)];
      g.state = 'failed'; flash(g, true);
      say(g.name, `stopped responding`, 'is-no');
      return;
    }
    if (idle.length && running.length < 5) {
      const to = idle[Math.floor(Math.random() * idle.length)];
      const job = JOBS[jobN++ % JOBS.length];
      placed++;
      const reject = placed % 5 === 3;
      to.state = 'incoming';
      say('planner', `place ${job} → ${to.name}`);
      launch('core', to, () => {
        if (reject) {
          to.state = 'idle'; flash(to, true);
          say('check', `${job} · over the team’s quota, sent back`, 'is-no');
          launch(to, 'core', () => say('planner', `defer ${job} until a GPU frees up`), { warm: true });
        } else {
          to.job = job; to.state = 'running'; to.until = clock + 6 + Math.random() * 5; flash(to);
          say('check', `${job} on ${to.name} · ok`, 'is-ok');
        }
      });
    }
  }

  // reduced motion: a still frame mid-story
  if (reduceMotion) { [0, 2, 3].forEach((i) => { gpus[i].state = 'running'; }); gpus[4].state = 'failed'; say('planner', 'place train-vit → gpu-3'); say('check', 'train-vit on gpu-3 · ok', 'is-ok'); }

  const tmp = new THREE.Color();
  stage.onFrame = (dt, t) => {
    clock += dt;
    ring.rotation.y += dt * 0.14;
    core.rotation.y -= dt * 0.25; shell.rotation.x += dt * 0.2; shellWire.rotation.copy(shell.rotation);
    bands[0].rotation.z += dt * 0.6; bands[1].rotation.z -= dt * 0.45;
    const busy = gpus.filter((g) => g.state === 'running').length;
    heartMat.emissiveIntensity = 0.45 + 0.35 * Math.sin(t * 3) * 0.5 + busy * 0.06;

    if (!reduceMotion) {
      next -= dt;
      if (next <= 0) { next = 1.5 + Math.random() * 0.9; step(); }
      for (const g of gpus) if (g.state === 'running' && clock > g.until) {
        say(g.name, `${g.job} done · released`); g.job = null; g.state = 'idle';
      }
    }

    for (const g of gpus) {
      g.card.rotation.y = g.phase + t * g.spinV;           // each card spins on its own axis
      g.card.position.y = Math.sin(t * 1.1 + g.phase) * 0.08;
      const target = g.state === 'running' ? C.run : g.state === 'failed' ? C.fail : C.idle;
      g.light.color.lerp(target, Math.min(1, dt * 6));
      g.hub.color.lerp(g.state === 'running' ? C.run : tmp.set('#2a2d33'), Math.min(1, dt * 6));
      g.sh.color.lerp(g.state === 'failed' ? C.shellDim : C.shell, Math.min(1, dt * 4));
      g.fan += ((g.state === 'running' ? 14 : g.state === 'failed' ? 0 : 3) - g.fan) * Math.min(1, dt * 2);
      for (const f of g.fans) f.rotation.z += dt * g.fan * f.userData.dir;
      g.link.forEach((d, k) => { d.visible = g.state === 'running' && ((t * 6 - k) % 9 + 9) % 9 > 2; });
    }

    for (let k = packets.length - 1; k >= 0; k--) {
      const p = packets[k];
      p.t = Math.min(1, p.t + dt / p.dur);
      const a = posOf(p.from), b = posOf(p.to);
      const e = p.t < 0.5 ? 2 * p.t * p.t : 1 - (-2 * p.t + 2) ** 2 / 2;
      p.m.position.copy(bez(a, b, e));
      p.m.rotation.x += dt * 4; p.m.rotation.y += dt * 3;
      p.trail.forEach((tr, j) => { tr.position.copy(bez(a, b, Math.max(0, e - (j + 1) * 0.045))); tr.visible = e - (j + 1) * 0.045 > 0; });
      if (p.t >= 1) { ring.remove(p.m, ...p.trail); packets.splice(k, 1); p.done?.(); }
    }
  };
  stage.start();
  return stage;
}
