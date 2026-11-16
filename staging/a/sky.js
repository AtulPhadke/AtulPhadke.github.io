// Test: a 3D glyph object hung in the beach sky in place of the moon.
//   'gpu'   — one graphics card, slowly turning, fans spinning, light bar breathing blue
//   'agent' — the agent core (as on the Karma page) with three small GPUs orbiting it

import { createStage, bakeCard, THREE, reduceMotion } from '../stage.js';

function card(baked, light) {
  const g = new THREE.Group();
  const li = baked.mat.light.clone();
  li.color.set(light);
  // self-lit: a star's card glows from within instead of reflecting the room
  const glow = new THREE.Color('#d6dbe3'), white = new THREE.Color('#ffffff');
  const lit = [], cache = new Map();
  const pick = (k) => {
    if (k === 'light') return li;
    if (!cache.has(k)) {
      const m = baked.mat[k].clone();
      if (m.emissive) { m.emissive = glow.clone(); m.emissiveIntensity = 0.28; m.color.lerp(white, 0.35); lit.push(m); }
      cache.set(k, m);
    }
    return cache.get(k);
  };
  for (const k in baked.parts) g.add(new THREE.Mesh(baked.parts[k], pick(k)));
  const fans = baked.fanPos.map((p, j) => {
    const f = new THREE.Group(); f.position.copy(p); f.userData.dir = j ? -1 : 1;
    for (const k in baked.rotor) f.add(new THREE.Mesh(baked.rotor[k], pick(k)));
    g.add(f); return f;
  });
  return { g, li, fans, lit };
}

export async function mountSky(el, kind, colors) {
  const isGpu = kind === 'gpu';
  const stage = await createStage(el, {
    ...colors, ink: '#ffffff', accent: '#b4c2ff', cell: 5.5, gain: 2.2, fill: 0.6,
    fit: isGpu ? { w: 8.0, h: 5.8 } : { w: 11.5, h: 8.0 },
    yaw: 0, pitch: isGpu ? 0.22 : 0.42, swing: 0.06, spin: 0.1, parallax: 0.05,
    label: isGpu ? 'A graphics card drawn in zeros and ones, hanging in the night sky where the moon would be' : 'An agent core with small graphics cards orbiting it, hanging in the night sky where the moon would be',
  });
  stage.renderer.toneMappingExposure = 1.5;
  const baked = bakeCard(colors.accent);
  const twinkle = (t) => 0.85 + 0.15 * Math.sin(t * 1.7) * Math.sin(t * 0.63 + 1.0);
  const blue = new THREE.Color('#3d5fd0'), dim = new THREE.Color('#22305f');

  if (isGpu) {
    const c = card(baked, '#3d5fd0');
    stage.rig.add(c.g);
    stage.onFrame = (dt, t) => {
      c.g.rotation.y = reduceMotion ? -0.35 : Math.sin(t * 0.35) * 0.7;   // turns side to side, never edge-on
      c.g.rotation.x = Math.sin(t * 0.4) * 0.12;
      c.g.position.y = Math.sin(t * 0.8) * 0.06;
      c.li.color.copy(blue).lerp(new THREE.Color('#dfe6ff'), 0.4 + 0.3 * Math.sin(t * 1.6));
      for (const m of c.lit) m.emissiveIntensity = 0.28 * twinkle(t);
      for (const f of c.fans) f.rotation.z += dt * 9 * f.userData.dir;
    };
  } else {
    const core = new THREE.Group();
    stage.rig.add(core);
    const heart = new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 16), new THREE.MeshBasicMaterial({ color: '#4a6cff' }));
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 1), new THREE.MeshStandardMaterial({ color: '#d4d9e0', emissive: '#e4e8f0', emissiveIntensity: 0.45, roughness: 0.35, metalness: 0.4, flatShading: true, transparent: true, opacity: 0.55 }));
    const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(1.03, 1), new THREE.MeshBasicMaterial({ color: '#eef2ff', wireframe: true }));
    const band = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.03, 8, 96), new THREE.MeshBasicMaterial({ color: '#f2f4f8' }));
    band.rotation.x = Math.PI / 2 + 0.4;
    core.add(heart, shell, wire, band);
    const ring = new THREE.Group(); stage.rig.add(ring);
    const cards = [0, 1, 2].map((i) => {
      const c = card(baked, '#3d5fd0');
      c.g.scale.setScalar(0.4);
      const a = (i / 3) * Math.PI * 2;
      c.g.position.set(Math.cos(a) * 2.05, 0, Math.sin(a) * 2.05);
      ring.add(c.g); return c;
    });
    stage.onFrame = (dt, t) => {
      if (reduceMotion) return;
      shell.rotation.x += dt * 0.2; shell.rotation.y -= dt * 0.25; wire.rotation.copy(shell.rotation);
      band.rotation.z += dt * 0.5;
      ring.rotation.y += dt * 0.3;
      heart.material.color.set('#7f97ff').multiplyScalar(0.9 + 0.3 * twinkle(t));
      shell.material.emissiveIntensity = 0.3 * twinkle(t);
      cards.forEach((c, i) => { c.g.rotation.y = -ring.rotation.y - (i / 3) * Math.PI * 2 + Math.sin(t + i) * 0.5; for (const f of c.fans) f.rotation.z += dt * 10 * f.userData.dir; });
    };
  }
  stage.start();
}
