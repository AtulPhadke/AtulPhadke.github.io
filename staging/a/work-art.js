// Work-row animations, drawn in the same 0/1 glyph pass as the GPUs.
//   mountHelix  — CAP-GENIE: a spinning DNA double helix with a read window scanning along it
//   mountPeaks  — LC-MS featurization: an RT × m/z intensity map; a scan line picks each feature
//   mountCloud  — Devservers in Slack: a Slack command brings EC2 devservers up and down on shared EFS

import { createStage, THREE, reduceMotion } from '../stage.js';

const C = {
  ink: new THREE.Color('#c9ced4'),
  dim: new THREE.Color('#6a7078'),
  blue: new THREE.Color('#3d5fd0'),
  bright: new THREE.Color('#e8eef5'),
  dark: new THREE.Color('#2a2d33'),
};
const std = (c, r = 0.5, m = 0.25) => new THREE.MeshStandardMaterial({ color: c.clone ? c.clone() : new THREE.Color(c), roughness: r, metalness: m });

function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

function rod(a, b, r, mat) {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 10), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

/* ---------------- CAP-GENIE: DNA helix ---------------- */
export async function mountHelix(el, colors) {
  const stage = await createStage(el, {
    ...colors, cell: 4.6, fit: { w: 8.6, h: 3.6 }, yaw: 0.0, pitch: 0.12, swing: 0.14, spin: 0.25, parallax: 0.08,
    label: 'A DNA double helix drawn in zeros and ones, spinning, with a read window scanning along it',
  });
  const g = new THREE.Group();
  stage.rig.add(g);
  const R = 0.95, L = 6.6, TURNS = 2.4, GROOVE = Math.PI * 0.78;
  const at = (u, phase) => { const a = u * TURNS * Math.PI * 2 + phase; return new THREE.Vector3(-L / 2 + u * L, Math.cos(a) * R, Math.sin(a) * R); };
  const strand = (phase) => new THREE.CatmullRomCurve3(Array.from({ length: 161 }, (_, i) => at(i / 160, phase)));
  const back = std(C.ink, 0.4, 0.35);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(strand(0), 420, 0.12, 10), back));
  g.add(new THREE.Mesh(new THREE.TubeGeometry(strand(GROOVE), 420, 0.12, 10), back));

  const N = 30, rungs = [];
  const r = rng(11);
  for (let i = 0; i < N; i++) {
    const u = (i + 0.5) / N;
    const a = at(u, 0), b = at(u, GROOVE), mid = a.clone().lerp(b, 0.5);
    const blueFirst = r() < 0.5;
    const m1 = std(blueFirst ? C.blue : C.dim, 0.5, 0.1), m2 = std(blueFirst ? C.dim : C.blue, 0.5, 0.1);
    g.add(rod(a, mid, 0.06, m1), rod(mid, b, 0.06, m2));
    rungs.push({ x: a.x, mats: [m1, m2], base: [m1.color.clone(), m2.color.clone()] });
  }

  let scan = -L / 2;
  stage.onFrame = (dt) => {
    g.rotation.x += dt * (reduceMotion ? 0 : 0.55);
    scan += dt * 1.6;
    if (scan > L / 2 + 1.2) scan = -L / 2 - 1.2;
    for (const rg of rungs) {
      const k = Math.max(0, 1 - Math.abs(rg.x - scan) / 0.55);
      rg.mats.forEach((m, j) => m.color.copy(rg.base[j]).lerp(C.bright, k * 0.9));
    }
  };
  stage.start();
}

/* ---------------- LC-MS: peak picking ---------------- */
export async function mountPeaks(el, colors) {
  const stage = await createStage(el, {
    ...colors, cell: 4.6, fit: { w: 8.2, h: 4.1 }, offset: { x: 0, y: -0.6 }, yaw: -0.28, pitch: 0.36, swing: 0.08, spin: 0.15, parallax: 0.12,
    label: 'A liquid chromatography mass spectrometry map drawn in zeros and ones; a scan line passes over it and picks each peak',
  });
  const W = 6, D = 2.6, NX = 180, NZ = 90;
  const geo = new THREE.PlaneGeometry(W, D, NX, NZ);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colorsAttr = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3);
  geo.setAttribute('color', colorsAttr);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15, side: THREE.DoubleSide });
  const surf = new THREE.Mesh(geo, mat);
  stage.rig.add(surf);

  const axMat = std(C.ink, 0.5, 0.1);
  stage.rig.add(rod(new THREE.Vector3(-W / 2, 0, D / 2), new THREE.Vector3(W / 2, 0, D / 2), 0.02, axMat));
  stage.rig.add(rod(new THREE.Vector3(-W / 2, 0, D / 2), new THREE.Vector3(-W / 2, 0, -D / 2), 0.02, axMat));
  stage.rig.add(rod(new THREE.Vector3(-W / 2, 0, -D / 2), new THREE.Vector3(-W / 2, 1.5, -D / 2), 0.02, axMat));
  const scanMat = std(C.bright, 0.4, 0.1);
  const scanBar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.5, D), scanMat);
  stage.rig.add(scanBar);

  const markerGeo = new THREE.OctahedronGeometry(0.075);
  const markerMat = std(C.blue, 0.4, 0.2);
  let peaks = [], seed = 3;

  function build() {
    const r = rng(seed++ * 977 + 5);
    peaks.forEach((p) => p.marker && stage.rig.remove(p.marker, p.stem));
    peaks = [];
    for (let i = 0; i < 11; i++) {
      const p = { x: -W / 2 + 0.35 + r() * (W - 0.7), z: -D / 2 + 0.35 + r() * (D - 0.7), h: 0.45 + r() * 1.15, sx: 0.06 + r() * 0.07, sz: 0.04 + r() * 0.025, picked: 0 };
      peaks.push(p);
      // isotope envelope: two smaller peaks at higher m/z
      if (r() < 0.6) {
        peaks.push({ ...p, z: p.z + 0.16, h: p.h * 0.45, iso: true });
        peaks.push({ ...p, z: p.z + 0.32, h: p.h * 0.16, iso: true });
      }
    }
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      let y = (Math.sin(x * 9 + z * 5) * 0.5 + 0.5) * 0.015;
      for (const p of peaks) y += p.h * Math.exp(-((x - p.x) ** 2 / (2 * p.sx ** 2) + (z - p.z) ** 2 / (2 * p.sz ** 2)));
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    paint();
  }
  function paint() {
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      let k = 0;
      for (const p of peaks) if (p.picked) k = Math.max(k, p.picked * Math.exp(-((x - p.x) ** 2 / (2 * (p.sx * 1.6) ** 2) + (z - p.z) ** 2 / (2 * (p.sz * 1.6) ** 2))));
      const y = pos.getY(i);
      const grid = (Math.abs(((x + 3) / 0.5) % 1 - 0.5) > 0.47 || Math.abs(((z + 2) / 0.5) % 1 - 0.5) > 0.47) ? 0.35 : 0;
      const c = C.dark.clone().multiplyScalar(0.35).lerp(C.dim, grid).lerp(C.ink, Math.min(1, y * 4)).lerp(C.bright, Math.min(1, Math.max(0, y - 0.6))).lerp(C.blue, k);
      colorsAttr.setXYZ(i, c.r, c.g, c.b);
    }
    colorsAttr.needsUpdate = true;
  }
  build();

  const SWEEP = 6.5, HOLD = 1.6;
  let t0 = 0, dirty = false;
  stage.onFrame = (dt) => {
    t0 += reduceMotion ? 0 : dt;
    if (t0 > SWEEP + HOLD) { t0 = 0; build(); }
    const s = -W / 2 - 0.2 + (W + 0.4) * Math.min(1, t0 / SWEEP);
    scanBar.position.set(s, 0.72, 0);
    scanBar.visible = t0 < SWEEP;
    for (const p of peaks) {
      if (!p.iso && !p.picked && s >= p.x) {
        p.picked = 0.01;
        p.marker = new THREE.Mesh(markerGeo, markerMat);
        p.marker.position.set(p.x, p.h + 0.22, p.z);
        p.stem = rod(new THREE.Vector3(p.x, p.h + 0.02, p.z), new THREE.Vector3(p.x, p.h + 0.16, p.z), 0.012, markerMat);
        stage.rig.add(p.marker, p.stem);
        const c = stage.project(p.marker.position);
        stage.pulse(c.x, c.y, { size: 0.35 });
      }
      if (p.picked && p.picked < 1) { p.picked = Math.min(1, p.picked + dt * 3); dirty = true; }
      if (p.marker) p.marker.rotation.y += dt * 2;
    }
    // isotopes join their parent once it is picked
    for (let i = 0; i < peaks.length; i++) if (peaks[i].iso) peaks[i].picked = peaks[i - (peaks[i - 1].iso ? 2 : 1)].picked;
    if (dirty) { paint(); dirty = false; }
  };
  stage.start();
}

/* ---------------- Devservers: EC2 on shared EFS ---------------- */
export async function mountCloud(el, colors, log) {
  const stage = await createStage(el, {
    ...colors, cell: 4.6, fit: { w: 6.8, h: 4.6 }, offset: { x: 0, y: 0.15 }, yaw: -0.3, pitch: 0.3, swing: 0.15, spin: 0.15, parallax: 0.12,
    label: 'Cloud devservers drawn in zeros and ones: a Slack command starts and stops instances, all sharing one storage volume',
  });
  const rig = stage.rig;
  // EFS: a shared volume, drawn as a stack of three discs
  const efsMat = std(C.ink, 0.4, 0.4);
  const efs = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.15, 48), efsMat);
    d.position.y = i * 0.21; efs.add(d);
  }
  efs.position.set(0, -1.3, 0);
  rig.add(efs);

  const SLOTS = 4;
  const boxGeo = new THREE.BoxGeometry(0.9, 0.6, 0.7);
  const slotGeo = new THREE.BoxGeometry(0.5, 0.035, 0.02);
  const inst = [];
  for (let i = 0; i < SLOTS; i++) {
    const x = (i - (SLOTS - 1) / 2) * 1.25;
    const g = new THREE.Group();
    g.position.set(x, 0.35, 0);
    const body = std(C.dim, 0.45, 0.3);
    g.add(new THREE.Mesh(boxGeo, body));
    for (let k = 0; k < 3; k++) { const s = new THREE.Mesh(slotGeo, std(C.dark, 0.8, 0)); s.position.set(-0.07, 0.15 - k * 0.13, 0.355); g.add(s); }
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.02), std(C.dark, 0.5, 0));
    led.position.set(0.33, 0.16, 0.355); g.add(led);
    const barMat = std(C.blue, 0.5, 0.1);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1, 0.16), barMat);
    bar.position.set(0.0, 0.3, 0); g.add(bar);
    const linkMat = std(C.dim, 0.6, 0.1);
    const link = rod(new THREE.Vector3(x, 0.05, 0), new THREE.Vector3(x * 0.5, -0.86, 0), 0.02, linkMat);
    rig.add(g, link);
    const packet = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.11), std(C.bright, 0.4, 0.1));
    rig.add(packet);
    inst.push({ g, body, led, bar, barMat, link, packet, x, up: i % 2 === 0 ? 1 : 0, target: i % 2 === 0 ? 1 : 0, demand: 0.3 + Math.random() * 0.5, d: 0.5, pk: Math.random(), name: `dev-${i + 1}` });
  }

  const say = (txt) => { if (!log) return; log.textContent = txt; log.classList.remove('is-on'); void log.offsetWidth; log.classList.add('is-on'); };
  let next = 2.5, flick = 0;
  const r = rng(29);
  stage.onFrame = (dt) => {
    if (!reduceMotion) next -= dt;
    flick += dt;
    if (next <= 0) {
      next = 2.6 + r() * 1.6;
      const down = inst.filter((s) => s.target === 0), upNow = inst.filter((s) => s.target === 1);
      if (down.length && (upNow.length < 3 || r() < 0.55)) {
        const s = down[Math.floor(r() * down.length)];
        s.target = 1; s.demand = 0.4 + r() * 0.5;
        say(`/devserver up ${s.name} · g5.xlarge`);
      } else if (upNow.length > 1) {
        const s = upNow.reduce((a, b) => (a.demand < b.demand ? a : b));
        s.target = 0;
        say(`/devserver stop ${s.name} · idle`);
      }
    }
    for (const s of inst) {
      s.up += (s.target - s.up) * Math.min(1, dt * 3);
      const on = s.up > 0.5;
      s.g.scale.setScalar(0.62 + 0.38 * s.up);
      s.link.visible = s.up > 0.4;
      s.bar.visible = s.up > 0.3;
      // starting up: the shell flickers between dim and bright
      const starting = s.target === 1 && s.up < 0.95;
      if (starting && flick > 0.08) s.body.color.copy(Math.random() < 0.5 ? C.bright : C.dim);
      else if (!starting) s.body.color.lerp(on ? C.ink : C.dark, dt * 4);
      s.demand += (Math.sin(performance.now() / 900 + s.x) * 0.5 + 0.5 - s.demand) * dt * 0.15;
      s.d += ((on ? s.demand : 0) - s.d) * dt * 3;
      s.bar.scale.y = Math.max(0.001, s.d * 0.6);
      s.bar.position.y = 0.3 + s.d * 0.3;
      s.led.material.color.copy(on && s.d > 0.45 ? C.blue : C.dark);
      // data trickling between the instance and the shared volume
      s.pk = (s.pk + dt * (0.4 + s.d)) % 1;
      s.packet.visible = on;
      const a = new THREE.Vector3(s.x, 0.05, 0), b = new THREE.Vector3(s.x * 0.5, -0.86, 0);
      s.packet.position.copy(a).lerp(b, s.pk);
    }
    if (flick > 0.08) flick = 0;
  };
  stage.start();
  say('/devserver up dev-1 · g5.xlarge');
}
