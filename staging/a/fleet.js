// Hero fleet: two on-prem racks and a cloud rack of GPUs, drawn in 0/1 glyphs.
// The agent overlay (fleet-agents.js) drives slot states through this API.

import { createStage, bakeCard, THREE } from '../stage.js';

const C = {
  idle: new THREE.Color('#545454'),
  running: new THREE.Color('#3d5fd0'),
  failed: new THREE.Color('#d0742c'),
  prov: new THREE.Color('#dfe6ee'),
  lightOff: new THREE.Color('#1c1e22'),
  hubIdle: new THREE.Color('#2a2d33'),
  outline: new THREE.Color('#6d737b'),
};

export const COLS = [
  { id: 'rack-a', label: 'rack-a', cloud: false },
  { id: 'rack-b', label: 'rack-b', cloud: false },
  { id: 'cloud', label: 'cloud', cloud: true },
];
const ROWS = 3, PX = 3.4, PY = 1.6;

export async function mountFleet(el, opts) {
  const narrow = () => window.matchMedia('(max-width: 60rem)').matches;
  const stage = await createStage(el, {
    ...opts,
    fit: (W, H) => (W / H < 0.9 ? { w: 11.6, h: 1 } : { w: 10.8, h: 7.4 }),
    offset: (W, H) => ({ x: 0, y: W / H < 0.9 ? 0.0 : -0.3 }),
    yaw: -0.16, pitch: 0.2, swing: 0.08, spin: 0.18, parallax: 0.1,
  });
  const baked = bakeCard(opts.accent);
  const slots = [];

  // ghost panel for an empty cloud slot: renders as a field of faint dots with a dotted edge
  const ghostMat = new THREE.MeshBasicMaterial({ color: '#3a3a3a' });
  const ghostGeo = new THREE.BoxGeometry(2.8, 1.12, 0.02);
  const outline = () => new THREE.Mesh(ghostGeo, ghostMat);

  COLS.forEach((col, c) => {
    for (let r = 0; r < ROWS; r++) {
      const g = new THREE.Group();
      const pos = new THREE.Vector3((c - 1) * PX, (1 - r) * PY, 0);
      g.position.copy(pos);
      const shell = baked.mat.shell.clone();
      const light = baked.mat.light.clone();
      const hub = baked.mat.hub.clone();
      const pick = (k) => (k === 'shell' ? shell : k === 'light' ? light : k === 'hub' ? hub : baked.mat[k]);
      for (const k in baked.parts) g.add(new THREE.Mesh(baked.parts[k], pick(k)));
      const fans = baked.fanPos.map((p, i) => {
        const f = new THREE.Group(); f.position.copy(p); f.userData.dir = i ? -1 : 1;
        for (const k in baked.rotor) f.add(new THREE.Mesh(baked.rotor[k], pick(k)));
        g.add(f); return f;
      });
      stage.rig.add(g);
      let ol = null;
      if (col.cloud) { ol = outline(); ol.position.copy(pos); stage.rig.add(ol); }
      const s = {
        id: `${col.id}/${r}`, col: c, row: r, cloud: col.cloud, pos,
        group: g, shell, light, hub, fans, outline: ol,
        state: col.cloud ? 'absent' : 'idle', job: null, since: 0,
        speed: 1, appear: col.cloud ? 0 : 1,
      };
      g.visible = !col.cloud;
      slots.push(s);
    }
  });

  const top = (s) => stage.project(new THREE.Vector3(s.pos.x - 1.05, s.pos.y + 0.62, 0.15));
  const center = (s) => stage.project(new THREE.Vector3(s.pos.x, s.pos.y, 0.2));
  const colTop = (c) => stage.project(new THREE.Vector3((c - 1) * PX - 1.4, PY + 1.15, 0));

  let flickT = 0;
  stage.onFrame = (dt, t) => {
    flickT += dt;
    const flick = flickT > 0.09; if (flick) flickT = 0;
    for (const s of slots) {
      const st = s.state;
      // appearance (cloud slots materialise / dissolve)
      const want = st === 'absent' ? 0 : 1;
      s.appear += (want - s.appear) * Math.min(1, dt * 4);
      s.group.visible = s.appear > 0.02;
      s.group.scale.setScalar(0.6 + 0.4 * s.appear);
      if (s.outline) s.outline.visible = s.appear < 0.6;

      let target = C[st] || C.idle;
      if (st === 'failed' && flick) s.shell.color.copy(Math.random() < 0.35 ? C.idle : C.failed);
      else if (st === 'prov' && flick) s.shell.color.copy(Math.random() < 0.5 ? C.prov : C.idle);
      else if (st !== 'failed' && st !== 'prov') s.shell.color.lerp(target, Math.min(1, dt * 5));

      s.light.color.lerp(st === 'running' ? C.running : st === 'failed' ? C.failed : C.lightOff, Math.min(1, dt * 6));
      s.hub.emissiveIntensity = st === 'running' ? 0.8 : 0;
      s.hub.color.lerp(st === 'running' ? C.running : C.hubIdle, Math.min(1, dt * 6));

      const want_speed = st === 'running' ? 11 : st === 'prov' ? 5 : st === 'failed' ? 0 : 1.2;
      s.speed += (want_speed - s.speed) * Math.min(1, dt * 1.5);
      s.fans.forEach((f) => { f.rotation.z += dt * s.speed * f.userData.dir; });
    }
  };
  stage.start();

  return {
    stage, slots, cols: COLS, top, center, colTop,
    set(s, state) { s.state = state; s.since = performance.now(); },
    pulse(s, warm = false) { const p = center(s); stage.pulse(p.x, p.y, { warm, size: 0.8 }); },
    size: stage.size,
    get visible() { return stage.visible; },
  };
}
