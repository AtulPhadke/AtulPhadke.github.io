// Shared glyph stage: a three.js scene rendered through the 0/1 glyph pass,
// plus helpers to bake the procedural card into a handful of merged meshes.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildCard, materials, glyphAtlas, vert, frag } from './gpu.js';

export { THREE };
export const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Bake the detailed card into one geometry per material (static parts) and
 * one rotor geometry per material (a single fan, centred on its axis). */
export function bakeCard(accent) {
  const mat = materials('ascii', accent);
  for (const k in mat) mat[k].userData.key = k;
  const { card, fans } = buildCard(mat);
  card.updateMatrixWorld(true);
  const fanSet = new Set(fans);
  const fanOf = (o) => { while (o) { if (fanSet.has(o)) return o; o = o.parent; } return null; };
  const inv = new THREE.Matrix4().copy(fans[0].matrixWorld).invert();
  const parts = {}, rotor = {};
  card.traverse((m) => {
    if (!m.isMesh) return;
    const f = fanOf(m);
    if (f && f !== fans[0]) return;
    let g = m.geometry.clone();
    if (g.index) g = g.toNonIndexed();
    for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal') g.deleteAttribute(a);
    g.applyMatrix4(f ? new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld) : m.matrixWorld);
    const bucket = f ? rotor : parts;
    (bucket[m.material.userData.key] ??= []).push(g);
  });
  const merge = (b) => Object.fromEntries(Object.entries(b).map(([k, list]) => [k, mergeGeometries(list)]));
  return {
    mat,
    parts: merge(parts),
    rotor: merge(rotor),
    fanPos: fans.map((f) => new THREE.Vector3().setFromMatrixPosition(f.matrixWorld)),
  };
}

export async function createStage(el, opts = {}) {
  const o = Object.assign({ cell: 5.5, ink: '#dfece4', accent: '#5a6dff', warn: '#f0a54a', gain: 2.0, fov: 28, fit: { w: 4, h: 3 }, offset: { x: 0, y: 0 }, yaw: 0, pitch: 0.12, swing: 0.1, spin: 0.15, parallax: 0.2, label: '' }, opts);
  try { await document.fonts.load('600 40px "Geist Mono"'); } catch (_) { /* fallback ok */ }

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const canvas = renderer.domElement;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', o.label);
  el.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(3, 4, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(new THREE.Color(o.accent), 1.4); rim.position.set(-4, -1, -3); scene.add(rim);

  const camera = new THREE.PerspectiveCamera(o.fov, 1, 0.1, 200);
  const rig = new THREE.Group();
  scene.add(rig);

  const rt = new THREE.WebGLRenderTarget(2, 2, { samples: 4, type: THREE.HalfFloatType });
  const post = new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag, transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false,
    uniforms: {
      tScene: { value: rt.texture }, tGlyph: { value: null },
      uRes: { value: new THREE.Vector2(2, 2) }, uCell: { value: 8 }, uTime: { value: 0 },
      uSplit: { value: -1 }, uInvert: { value: 0 }, uFlat: { value: 1 }, uGain: { value: o.gain }, uFill: { value: o.fill ?? 0 },
      uInk: { value: new THREE.Color(o.ink) }, uAccent: { value: new THREE.Color(o.accent) }, uWarn: { value: new THREE.Color(o.warn) },
      uPulse: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) }, uPulseWarm: { value: [0, 0, 0, 0] },
    },
  });
  const postScene = new THREE.Scene();
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post));

  let W = 1, H = 1, dpr = 1, atlasSize = 0;
  function resize() {
    const r = el.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    camera.aspect = W / H;
    const fit = typeof o.fit === 'function' ? o.fit(W, H) : o.fit;
    const half = THREE.MathUtils.degToRad(camera.fov / 2);
    const dist = Math.max(fit.h / 2 / Math.tan(half), fit.w / 2 / (Math.tan(half) * camera.aspect));
    camera.position.set(0, fit.camY ?? 0, dist);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    const off = typeof o.offset === 'function' ? o.offset(W, H) : o.offset;
    rig.position.set(off.x, off.y, 0);
    rt.setSize(Math.round(W * dpr), Math.round(H * dpr));
    post.uniforms.uRes.value.set(W * dpr, H * dpr);
    const S = Math.max(4, Math.round(o.cell * dpr));
    if (S !== atlasSize) {
      atlasSize = S;
      post.uniforms.tGlyph.value?.dispose();
      post.uniforms.tGlyph.value = glyphAtlas(['·', ':', '0', '1'], '"Geist Mono", ui-monospace, monospace', S, 0.92);
    }
    post.uniforms.uCell.value = S;
  }
  new ResizeObserver(resize).observe(el);
  resize();

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener('pointermove', (e) => {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(el);

  const pulses = [0, 1, 2, 3].map(() => ({ x: 0, y: 0, life: 0, warm: 0, size: 1 }));
  const v3 = new THREE.Vector3();

  const stage = {
    THREE, scene, camera, rig, renderer, el,
    size: () => ({ W, H }),
    get visible() { return visible && !document.hidden; },
    /** rig-local point -> CSS px inside el */
    project(p) {
      v3.copy(p).applyMatrix4(rig.matrixWorld).project(camera);
      return { x: (v3.x + 1) / 2 * W, y: (1 - v3.y) / 2 * H };
    },
    pulse(x, y, { warm = false, size = 1 } = {}) {
      let i = pulses.findIndex((p) => p.life <= 0);
      if (i < 0) i = pulses.reduce((m, p, k) => (p.life < pulses[m].life ? k : m), 0);
      pulses[i] = { x: x / W, y: 1 - y / H, life: 1, warm: warm ? 1 : 0, size };
    },
    onFrame: null,
    resize,
  };

  const clock = new THREE.Clock();
  let sway = 0;
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    if (!visible) return;
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    sway += dt * o.spin;
    rig.rotation.y = o.yaw + Math.sin(sway) * o.swing + pointer.x * o.parallax;
    rig.rotation.x = o.pitch + pointer.y * o.parallax * 0.5;
    rig.updateMatrixWorld(true);
    stage.onFrame?.(dt, t);

    post.uniforms.uTime.value = t;
    pulses.forEach((p, i) => {
      p.life = Math.max(0, p.life - dt / 1.4);
      const age = 1 - p.life;
      post.uniforms.uPulse.value[i].set(p.x, p.y, (0.02 + age * 0.13) * p.size, p.life > 0 ? Math.pow(p.life, 0.7) : 0);
      post.uniforms.uPulseWarm.value[i] = p.warm;
    });
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(postScene, postCam);
  }
  stage.start = () => {
    if (reduceMotion) { frame(); setTimeout(frame, 60); setTimeout(frame, 400); }
    else renderer.setAnimationLoop(frame);
    el.dataset.ready = 'true';
  };
  stage.renderOnce = frame;
  return stage;
}
