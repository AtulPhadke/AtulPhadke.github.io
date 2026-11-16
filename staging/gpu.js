// Procedural 3D graphics card + render modes for the redesign drafts.
// No model files: every part is built from primitives so it loads instantly.
//
//   mountGPU(el, {
//     mode:   'ascii' | 'split' | 'toon',
//     cell:   9,                    // glyph cell size in CSS px (ascii/split)
//     ink:    '#e8eef5',            // glyph colour for dense areas
//     accent: '#4b63ff',            // fan hubs, light bar, accent glyphs
//     invert: false,                // light paper: darker surface = denser glyphs
//     explode:'scroll' | 'loop' | 'none',
//     tokens: false,                // toon mode: job tokens rain into the card
//     label:  'aria label',
//   })

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- glyph atlas: · : 0 1 ---------------- */
export function glyphAtlas(chars, font, S = 64, fill = 0.78) {
  const c = document.createElement('canvas');
  c.width = S * chars.length; c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `600 ${Math.round(S * fill)}px ${font}`;
  chars.forEach((ch, i) => g.fillText(ch, i * S + S / 2, S / 2 + S * 0.04));
  const t = new THREE.CanvasTexture(c);
  // atlas is built at the exact device-pixel cell size, so sample 1:1
  t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

/* ---------------- the card ---------------- */
export function buildCard(mat) {
  const card = new THREE.Group();
  const layers = {};           // name -> { obj, z0, dz } for the exploded view
  const fans = [];
  const add = (name, obj, z0, dz) => { obj.position.z = z0; card.add(obj); layers[name] = { obj, z0, dz }; return obj; };

  const L = 2.8, H = 1.12;

  // backplate with vent slots
  const back = new THREE.Group();
  back.add(new THREE.Mesh(new RoundedBoxGeometry(L, H, 0.035, 2, 0.02), mat.shell));
  for (let i = 0; i < 9; i++) {
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.5, 0.01), mat.dark);
    slot.position.set(0.55 + i * 0.075, 0.05, -0.02);
    back.add(slot);
  }
  add('back', back, -0.2, -0.55);

  // PCB + gold fingers + power connector
  const pcb = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(L - 0.1, H + 0.04, 0.03), mat.pcb);
  board.position.y = -0.03; pcb.add(board);
  for (let i = 0; i < 34; i++) {
    const pin = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.09, 0.034), mat.gold);
    pin.position.set(-0.75 + i * 0.034 + (i > 7 ? 0.05 : 0), -H / 2 - 0.07, 0);
    pcb.add(pin);
  }
  const tab = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.08, 0.03), mat.pcb);
  tab.position.set(-0.2, -H / 2 - 0.04, 0); pcb.add(tab);
  const power = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.14), mat.dark);
  power.position.set(0.85, H / 2 + 0.02, 0.06); pcb.add(power);
  // the die + memory, only really visible when exploded
  const die = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.03), mat.chip);
  die.position.set(-0.1, 0, 0.03); pcb.add(die);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.025), mat.dark);
    m.position.set(-0.1 + Math.cos(a) * 0.36, Math.sin(a) * 0.32, 0.03);
    pcb.add(m);
  }
  add('pcb', pcb, -0.15, -0.25);

  // heatsink fins
  const fins = new THREE.Group();
  const finGeo = new THREE.BoxGeometry(0.014, H - 0.14, 0.17);
  for (let i = 0; i < 52; i++) {
    const f = new THREE.Mesh(finGeo, mat.fin);
    f.position.x = -L / 2 + 0.16 + i * 0.049;
    fins.add(f);
  }
  // heat pipes
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, L - 0.3, 10), mat.copper);
    p.rotation.z = Math.PI / 2;
    p.position.set(0, -0.36 + i * 0.24, -0.02);
    fins.add(p);
  }
  add('fins', fins, -0.03, 0.05);

  // shroud
  const shroud = new THREE.Group();
  shroud.add(new THREE.Mesh(new RoundedBoxGeometry(L, H, 0.12, 3, 0.045), mat.shell));
  const bar = new THREE.Mesh(new THREE.BoxGeometry(L * 0.55, 0.025, 0.02), mat.light);
  bar.position.set(0.3, H / 2 - 0.006, 0.03); shroud.add(bar);
  const fanX = [-0.68, 0.68];
  fanX.forEach((x) => {
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.47, 48), mat.void);
    hole.position.set(x, 0, 0.0605); shroud.add(hole);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.475, 0.022, 10, 64), mat.trim);
    ring.position.set(x, 0, 0.062); shroud.add(ring);
  });
  add('shroud', shroud, 0.13, 0.35);

  // fans (separate layer so they float out furthest)
  const fanLayer = new THREE.Group();
  const bladeGeo = new THREE.BoxGeometry(0.33, 0.12, 0.008);
  bladeGeo.translate(0.25, 0, 0);
  fanX.forEach((x, k) => {
    const fan = new THREE.Group();
    fan.position.x = x;
    for (let i = 0; i < 11; i++) {
      const b = new THREE.Mesh(bladeGeo, mat.blade);
      const holder = new THREE.Group();
      holder.rotation.z = (i / 11) * Math.PI * 2;
      b.rotation.x = 0.55;
      holder.add(b);
      fan.add(holder);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 32), mat.hub);
    hub.rotation.x = Math.PI / 2; fan.add(hub);
    fan.userData.dir = k ? -1 : 1;
    fans.push(fan);
    fanLayer.add(fan);
  });
  add('fans', fanLayer, 0.2, 0.75);

  // IO bracket
  const io = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.03, H + 0.24, 0.5), mat.metal);
  plate.position.y = 0.02; io.add(plate);
  for (let i = 0; i < 4; i++) {
    const port = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.2), mat.void);
    port.position.set(-0.005, -0.33 + i * 0.2, 0.05);
    io.add(port);
  }
  io.position.x = -L / 2 - 0.03;
  card.add(io);
  layers.io = { obj: io, z0: 0, dz: 0 };

  return { card, layers, fans };
}

export function materials(mode, accent) {
  const A = new THREE.Color(accent);
  if (mode === 'toon') {
    const grad = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
    grad.minFilter = grad.magFilter = THREE.NearestFilter; grad.needsUpdate = true;
    const T = (c) => new THREE.MeshToonMaterial({ color: c, gradientMap: grad });
    const deep = A.clone().multiplyScalar(0.45);
    return {
      shell: T(A), dark: T(deep), pcb: T(deep), gold: T(new THREE.Color('#f4c74a')),
      chip: T(deep), fin: T(A.clone().lerp(new THREE.Color('#fff'), 0.35)), copper: T(new THREE.Color('#f08a4b')),
      light: new THREE.MeshBasicMaterial({ color: '#ffffff' }), void: T(deep), trim: T(deep),
      blade: T(A.clone().lerp(new THREE.Color('#fff'), 0.2)), hub: T(new THREE.Color('#ffffff')), metal: T(A.clone().lerp(new THREE.Color('#fff'), 0.5)),
    };
  }
  const S = (c, m = 0.6, r = 0.35) => new THREE.MeshStandardMaterial({ color: c, metalness: m, roughness: r });
  return {
    shell: S('#4a5059', 0.6, 0.38),
    dark: S('#16181c', 0.3, 0.6),
    pcb: S('#1d2a24', 0.2, 0.7),
    gold: S('#b4b3ab', 1.0, 0.25),
    chip: S('#6a7078', 0.9, 0.2),
    fin: S('#b9c0c8', 0.9, 0.3),
    copper: S('#a59d95', 1.0, 0.3),
    light: new THREE.MeshBasicMaterial({ color: A }),
    void: S('#0b0c0e', 0.1, 0.9),
    trim: S('#e6e9ec', 0.6, 0.25),
    blade: S('#d4d9df', 0.5, 0.35),
    hub: new THREE.MeshStandardMaterial({ color: A, emissive: A, emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.3 }),
    metal: S('#c9ced4', 1.0, 0.22),
  };
}

/* ---------------- post: scene -> 0/1 glyphs ---------------- */
export const vert = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
export const frag = /* glsl */`
  uniform sampler2D tScene;
  uniform sampler2D tGlyph;
  uniform vec2  uRes;
  uniform float uCell;
  uniform float uTime;
  uniform float uSplit;    // < 0: all glyphs. 0..1: solid left of this x
  uniform float uInvert;
  uniform float uFlat;     // 1: flat ink/accent glyphs, 0: take scene colour
  uniform float uGain;
  uniform float uFill;     // > 0: a lit body of the scene's own colour under the glyphs (stars, not objects)
  uniform vec3  uInk;
  uniform vec3  uAccent;
  uniform vec4  uPulse[4];   // xy: uv centre, z: radius (fraction of width), w: strength
  uniform float uPulseWarm[4];
  uniform vec3  uWarn;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec2 frag = vUv * uRes;
    vec2 cell = floor(frag / uCell);
    vec2 local = fract(frag / uCell);
    vec4 s = texture2D(tScene, (cell + 0.5) * uCell / uRes);
    vec4 direct = texture2D(tScene, vUv);

    float lum = dot(s.rgb / max(s.a, 0.001), vec3(0.299, 0.587, 0.114));
    lum = pow(clamp(lum * uGain, 0.0, 1.0), 0.75);
    // silhouette + crease edges read as the brightest glyphs
    vec4 sx = texture2D(tScene, (cell + vec2(1.5, 0.5)) * uCell / uRes);
    vec4 sy = texture2D(tScene, (cell + vec2(0.5, 1.5)) * uCell / uRes);
    float lx = pow(clamp(dot(sx.rgb, vec3(0.299, 0.587, 0.114)) * uGain, 0.0, 1.0), 0.75);
    float ly = pow(clamp(dot(sy.rgb, vec3(0.299, 0.587, 0.114)) * uGain, 0.0, 1.0), 0.75);
    float edge = clamp(abs(s.a - sx.a) + abs(s.a - sy.a) + (abs(lum - lx) + abs(lum - ly)) * 0.8, 0.0, 1.0);
    lum = max(lum, step(0.35, edge));
    float d = mix(lum, 1.0 - lum, uInvert);

    // job-landing pulses: an expanding ring of accent bits
    float boost = 0.0;
    float boostWarm = 0.0;
    vec2 cuv = (cell + 0.5) * uCell / uRes;
    for (int i = 0; i < 4; i++) {
      vec4 P = uPulse[i];
      if (P.w <= 0.0) continue;
      float dd = length((cuv - P.xy) * uRes) / (P.z * uRes.x);
      float ring = 1.0 - smoothstep(0.0, 0.22, abs(dd - 1.0));
      float fill = (1.0 - smoothstep(0.0, 1.0, dd)) * 0.55;
      float b = P.w * max(ring, fill);
      if (b > boost) { boost = b; boostWarm = uPulseWarm[i]; }
    }

    float h = hash(cell);
    float bit = step(0.5, hash(cell + floor(uTime * (0.4 + h * 1.6 + boost * 10.0) + h * 9.0)));
    float idx = d < 0.30 && boost < 0.3 ? 0.0 : d < 0.48 && boost < 0.3 ? 1.0 : 2.0 + bit;
    float g = texture2D(tGlyph, vec2((idx + local.x) / 4.0, local.y)).r;
    float a = g * smoothstep(0.08, 0.35, s.a) * max(step(0.13, d), step(0.25, boost));

    vec3 sc = s.rgb / max(s.a, 0.001);
    float accentness = clamp((sc.b - sc.r) * 3.0, 0.0, 1.0);
    float warm = clamp((sc.r - sc.b) * 3.0, 0.0, 1.0);
    vec3 hue = mix(mix(uInk, uAccent, accentness), uWarn, warm);
    vec3 flatCol = hue * mix(clamp(0.4 + d * 1.2, 0.0, 1.0), 1.0, max(accentness, warm));
    vec3 col = mix(clamp(sc * 1.5 + 0.06, 0.0, 1.0), flatCol, uFlat);
    col = mix(col, mix(uAccent * 1.25, uWarn * 1.15, boostWarm), clamp(boost * 1.4, 0.0, 1.0));

    vec4 glyph = vec4(col * a, a);

    if (uSplit >= 0.0) {
      float edge = uSplit * uRes.x;
      if (frag.x < edge) { gl_FragColor = direct; }
      else { gl_FragColor = glyph; }
      float line = 1.0 - smoothstep(0.0, 1.5, abs(frag.x - edge));
      gl_FragColor = mix(gl_FragColor, vec4(uAccent, 1.0), line * 0.9);
      return;
    }
    if (uFill > 0.0) {
      float inside = smoothstep(0.08, 0.35, s.a);
      float body = inside * uFill * (0.1 + 0.9 * lum * lum);   // darks stay dark, so detail survives
      vec3 bc = clamp(mix(sc, vec3(1.0), 0.35) * 1.25, 0.0, 1.0) * body;
      glyph = vec4(col * a + bc * (1.0 - a), a + body * (1.0 - a));

      // starlight shaped like the body: the silhouette, blurred outward, drawn as glyphs that thin with distance
      float gA = 0.0, gW = 0.0;
      for (int r = 1; r <= 5; r++) {
        float rad = float(r) * float(r) * 1.25 + 0.8;
        float w = 1.0 / (0.6 + float(r));
        for (int k = 0; k < 10; k++) {
          float an = float(k) * 0.6283 + float(r) * 0.37;
          vec2 o = vec2(cos(an), sin(an)) * rad;
          gA += texture2D(tScene, (cell + 0.5 + o) * uCell / uRes).a * w;
          gW += w;
        }
      }
      float tw = 0.85 + 0.15 * sin(uTime * 1.7) * sin(uTime * 0.63 + 1.0);
      float halo = pow(clamp(gA / gW * 7.0, 0.0, 1.0), 0.6) * (1.0 - inside) * tw;
      halo *= 0.75 + 0.25 * hash(cell * 1.7 + floor(uTime * 3.0));           // a little shimmer
      vec2 ed = min(cell, uRes / uCell - cell);
      halo *= smoothstep(1.0, 9.0, min(ed.x, ed.y));                              // never reaches the box edge
      float hi = halo > 0.66 ? 2.0 + bit : halo > 0.4 ? 1.0 : halo > 0.16 ? 0.0 : -1.0;
      float hg = hi < 0.0 ? 0.0 : texture2D(tGlyph, vec2((hi + local.x) / 4.0, local.y)).r;
      vec3 hc = mix(vec3(1.0), uAccent, 0.45) * (0.45 + 0.55 * halo);
      float ha = clamp(hg * (0.4 + 0.6 * halo) + halo * halo * 0.22, 0.0, 1.0);
      glyph = vec4(glyph.rgb + hc * ha * (1.0 - glyph.a), glyph.a + ha * (1.0 - glyph.a));
    }
    gl_FragColor = glyph;
  }
`;

export async function mountGPU(el, opts = {}) {
  const o = Object.assign({ mode: 'ascii', cell: 9, ink: '#e8eef5', accent: '#4b63ff', invert: false, flat: 0, explode: 'none', tokens: false, label: 'A 3D graphics card' }, opts);

  try { await document.fonts.load('600 40px "Geist Mono"'); } catch (_) { /* fallback font is fine */ }

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = o.mode === 'toon' ? 1.0 : 1.15;
  const canvas = renderer.domElement;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', o.label);
  el.appendChild(canvas);

  const scene = new THREE.Scene();
  if (o.mode !== 'toon') {
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  }
  scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, o.mode === 'toon' ? 1.2 : 0.6));
  const key = new THREE.DirectionalLight(0xffffff, o.mode === 'toon' ? 2.2 : 2.4);
  key.position.set(3, 4, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(new THREE.Color(o.accent), 1.6);
  rim.position.set(-4, -1, -3); scene.add(rim);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  const mat = materials(o.mode, o.accent);
  const { card, layers, fans } = buildCard(mat);
  const rig = new THREE.Group();
  rig.add(card);
  scene.add(rig);

  // toon outlines (inverted hull) on the big parts
  if (o.mode === 'toon') {
    const ink = new THREE.MeshBasicMaterial({ color: new THREE.Color(o.ink), side: THREE.BackSide });
    const meshes = [];
    card.traverse((m) => { if (m.isMesh) meshes.push(m); });
    meshes.forEach((m) => {
      if (m.material === mat.light) return;
      const p = m.geometry.parameters || {};
      if ((p.width || 0) < 0.2 && (p.radius || 0) < 0.2 && !p.tube) return;
      const hull = new THREE.Mesh(m.geometry, ink);
      hull.scale.setScalar(1.025);
      m.add(hull);
    });
  }

  // job tokens raining into the card (toon)
  const tokens = [];
  if (o.tokens) {
    const tgeo = new RoundedBoxGeometry(0.2, 0.2, 0.07, 2, 0.03);
    const colors = [new THREE.Color(o.accent).lerp(new THREE.Color('#fff'), 0.45), new THREE.Color(o.accent).multiplyScalar(0.55), new THREE.Color('#f4c74a')];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(tgeo, new THREE.MeshToonMaterial({ color: colors[i % 3], gradientMap: mat.shell.gradientMap }));
      const hull = new THREE.Mesh(tgeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(o.ink), side: THREE.BackSide }));
      hull.scale.setScalar(1.08); m.add(hull);
      m.userData = { t: Math.random(), speed: 0.12 + Math.random() * 0.1, x: (Math.random() - 0.5) * 2.2, spin: new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(3) };
      tokens.push(m); scene.add(m);
    }
  }

  // post-processing target
  let rt = null, post = null, postScene = null, postCam = null;
  if (o.mode !== 'toon') {
    rt = new THREE.WebGLRenderTarget(2, 2, { samples: 4, type: THREE.HalfFloatType });
    post = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, premultipliedAlpha: true,
      uniforms: {
        tScene: { value: rt.texture }, tGlyph: { value: null },
        uRes: { value: new THREE.Vector2(2, 2) }, uCell: { value: o.cell }, uTime: { value: 0 },
        uSplit: { value: o.mode === 'split' ? 0.5 : -1 }, uInvert: { value: o.invert ? 1 : 0 }, uFlat: { value: o.flat }, uGain: { value: o.gain ?? 2.0 },
        uInk: { value: new THREE.Color(o.ink) }, uAccent: { value: new THREE.Color(o.accent) },
        uPulse: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0)) },
        uPulseWarm: { value: [0, 0, 0, 0] }, uWarn: { value: new THREE.Color(o.warn || '#f0a54a') },
      },
      depthTest: false, depthWrite: false,
    });
    postScene = new THREE.Scene();
    postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post));
  }

  /* sizing: fit the card to the container */
  let W = 1, Hh = 1, dpr = 1, atlasSize = 0;
  function resize() {
    const r = el.getBoundingClientRect();
    W = Math.max(1, r.width); Hh = Math.max(1, r.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, Hh, false);
    canvas.style.width = W + 'px'; canvas.style.height = Hh + 'px';
    camera.aspect = W / Hh;
    const half = THREE.MathUtils.degToRad(camera.fov / 2);
    const needW = (o.fitWidth || 3.6) / 2, needH = (o.fitHeight || 2.6) / 2;
    const dist = Math.max(needH / Math.tan(half), needW / (Math.tan(half) * camera.aspect));
    camera.position.set(0, 0.25, dist);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    if (rt) {
      rt.setSize(Math.round(W * dpr), Math.round(Hh * dpr));
      post.uniforms.uRes.value.set(W * dpr, Hh * dpr);
      const S = Math.max(4, Math.round(o.cell * dpr));
      if (S !== atlasSize) {
        atlasSize = S;
        post.uniforms.tGlyph.value?.dispose();
        post.uniforms.tGlyph.value = glyphAtlas(['·', ':', '0', '1'], '"Geist Mono", ui-monospace, monospace', S, o.glyphFill ?? 0.92);
      }
      post.uniforms.uCell.value = S;
    }
  }
  new ResizeObserver(resize).observe(el);
  resize();

  /* interaction */
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener('pointermove', (e) => {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  let explodeT = 0, explodeTarget = 0, split = 0.5, splitTarget = null;
  if (o.mode === 'split') {
    el.addEventListener('pointermove', (e) => { const r = el.getBoundingClientRect(); splitTarget = (e.clientX - r.left) / r.width; });
    el.addEventListener('pointerleave', () => { splitTarget = null; });
  }
  const api = {
    setExplode(v) { explodeTarget = THREE.MathUtils.clamp(v, 0, 1); },
    setSplit(v) { split = v; },
    /** card-local point -> CSS px inside el */
    project(local) {
      const w = local.clone();
      rig.updateMatrixWorld(true);
      card.localToWorld(w);
      w.project(camera);
      return { x: (w.x + 1) / 2 * W, y: (1 - w.y) / 2 * Hh, z: w.z };
    },
    /** burst of accent bits at CSS px x,y */
    pulse(x, y) {
      let slot = pulses.findIndex((p) => p.life <= 0);
      if (slot < 0) slot = pulses.reduce((m, p, i) => (p.life < pulses[m].life ? i : m), 0);
      pulses[slot] = { x: x / W, y: 1 - y / Hh, life: 1 };
    },
    size() { return { W, H: Hh }; },
    Vector3: THREE.Vector3,
  };
  const pulses = [0, 1, 2, 3].map(() => ({ x: 0, y: 0, life: 0 }));
  if (o.explode === 'scroll') {
    const onScroll = () => {
      const r = el.getBoundingClientRect();
      const p = THREE.MathUtils.clamp((window.innerHeight * 0.5 - r.top) / (r.height * 0.9), 0, 1);
      api.setExplode(p);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 }).observe(el);

  const clock = new THREE.Clock();
  let spinAngle = 0;
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    if (!visible) return;

    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    spinAngle += dt * (o.spin ?? 0.25);
    rig.rotation.y = (o.yaw ?? -0.55) + Math.sin(spinAngle) * (o.swing ?? 0.55) + pointer.x * 0.35;
    rig.rotation.x = (o.pitch ?? 0.22) + pointer.y * 0.18;
    rig.position.y = (o.offsetY ?? 0) + Math.sin(t * 0.8) * 0.04;
    rig.position.x = o.offsetX ?? 0;

    fans.forEach((f) => { f.rotation.z += dt * 9 * f.userData.dir; });

    if (o.explode === 'loop') explodeTarget = (Math.sin(t * 0.45) * 0.5 + 0.5) ** 2;
    explodeT += (explodeTarget - explodeT) * 0.08;
    for (const k in layers) {
      const L = layers[k];
      L.obj.position.z = L.z0 + L.dz * explodeT * (o.explodeScale ?? 1);
    }

    tokens.forEach((m) => {
      const u = m.userData;
      u.t += dt * u.speed;
      if (u.t > 1) { u.t = 0; u.x = (Math.random() - 0.5) * 2.2; }
      const y = THREE.MathUtils.lerp(2.4, 0.35, u.t);
      m.position.set(u.x * (1 - u.t * 0.4), y, 0.35 + Math.sin(u.t * 6 + u.x) * 0.2);
      m.rotation.x += dt * u.spin.x; m.rotation.y += dt * u.spin.y;
      m.scale.setScalar(u.t > 0.85 ? (1 - u.t) / 0.15 : Math.min(1, u.t * 8));
    });

    if (rt) {
      post.uniforms.uTime.value = t;
      pulses.forEach((p, i) => {
        p.life = Math.max(0, p.life - dt / 1.4);
        const age = 1 - p.life;
        post.uniforms.uPulse.value[i].set(p.x, p.y, 0.02 + age * 0.15, p.life > 0 ? Math.pow(p.life, 0.7) : 0);
      });
      if (o.mode === 'split') {
        const goal = splitTarget ?? (0.5 + Math.sin(t * 0.35) * 0.3);
        split += (goal - split) * 0.06;
        post.uniforms.uSplit.value = split;
      }
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(postScene, postCam);
    } else {
      renderer.render(scene, camera);
    }
  }

  if (reduceMotion) {
    frame();
    setTimeout(frame, 50);
  } else {
    renderer.setAnimationLoop(frame);
  }
  el.dataset.ready = 'true';
  return api;
}
