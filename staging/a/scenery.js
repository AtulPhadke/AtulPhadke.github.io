// Scenery: a procedural ink-wash mountain range with drifting mist and grain.
// Two passes so it stays cheap:
//   1. the range (ridges, rock texture, valley haze) is painted once per resize
//      into a texture; alpha stores where mist likes to sit;
//   2. every frame only the drifting mist, valley fog and grain are added.
// mode 'range' = full scene, mode 'fog' = a low mist band (footer).

import * as THREE from 'three';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const vert = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const lib = /* glsl */`
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
`;

const rangeFrag = /* glsl */`
  precision highp float;
  uniform vec2 uRes;
  uniform float uFog;
  uniform vec3 uInk, uMist, uSky, uGlow;
  varying vec2 vUv;
  ${lib}
  float ridge(float x, float seed) {
    float v = 0.0, a = 0.6, f = 1.0;
    for (int i = 0; i < 5; i++) {
      float n = noise(vec2(x * f, seed + float(i) * 7.13));
      n = 1.0 - abs(n * 2.0 - 1.0);
      v += a * n * n; f *= 2.07; a *= 0.47;
    }
    return v;
  }
  void main() {
    vec2 uv = vUv;
    float asp = uRes.x / uRes.y;
    vec2 p = vec2(uv.x * asp, uv.y);
    vec3 col = mix(mix(uSky, uMist, 0.35), uSky * 0.6, smoothstep(0.2, 1.0, uv.y));
    vec2 gp = (p - vec2(asp * 0.7, 0.6)) * vec2(1.0, 1.6);
    col += uGlow * 0.22 * exp(-dot(gp, gp) * 2.2);
    float mistA = 0.0;

    for (int i = 0; i < 5; i++) {
      float fi = float(i) / 4.0;                // 0 far .. 1 near
      if (uFog > 0.5) break;
      float x = p.x * (0.8 + fi * 1.5) + fi * 13.7;
      // broad massif + steep rounded pillars (Huangshan) + bristly tree line on near ridges
      float broad = fbm(vec2(x * 0.9, fi * 3.1));
      float pillars = pow(noise(vec2(x * 3.2, 9.0 + fi * 5.0)), 3.0);
      float h = mix(0.5, 0.06, fi) + broad * mix(0.18, 0.3, fi) + pillars * mix(0.1, 0.42, fi);
      h += (noise(vec2(x * 22.0, fi * 2.0)) - 0.5) * 0.02 * (0.3 + fi);
      h += fi > 0.6 ? pow(noise(vec2(x * 90.0, 3.0)), 2.0) * 0.022 : 0.0;
      if (uv.y < h) {
        float depth = h - uv.y;
        vec3 tone = mix(mix(uMist, uSky, 0.25 + 0.35 * (1.0 - fi) * (1.0 - fi)), uInk, pow(fi, 1.2));
        float tex = fbm(vec2(x * 9.0, uv.y * 9.0 + fi * 3.0));
        tone *= 0.82 + tex * 0.34;
        float fade = smoothstep(0.0, mix(0.05, 0.3, fi), depth);
        col = mix(tone, mix(tone, uMist, 0.75 - fi * 0.45), fade);
        mistA = 0.0;
      }
      float band = 1.0 - smoothstep(0.0, 0.08 + fi * 0.06, abs(uv.y - (h - 0.07)));
      mistA = max(mistA, band * (0.85 - fi * 0.35));
    }
    gl_FragColor = vec4(col, mistA);
  }
`;

const mistFrag = /* glsl */`
  precision highp float;
  uniform sampler2D tRange;
  uniform vec2 uRes;
  uniform float uTime, uFog;
  uniform vec3 uMist, uSky;
  varying vec2 vUv;
  ${lib}
  void main() {
    vec2 uv = vUv;
    float asp = uRes.x / uRes.y;
    vec2 p = vec2(uv.x * asp, uv.y);
    float t = uTime;
    vec4 base = texture2D(tRange, uv);
    vec3 col = uFog > 0.5 ? uSky * 0.7 : base.rgb;

    float m = fbm(vec2(p.x * 1.3 - t * 0.016, uv.y * 3.0 + t * 0.004));
    col = mix(col, uMist * 1.05, base.a * smoothstep(0.32, 0.7, m));

    float vf = fbm(vec2(p.x * 0.9 - t * 0.022 + 7.0, uv.y * 3.2 - t * 0.008));
    float fogAmt = (1.0 - smoothstep(0.0, uFog > 0.5 ? 0.8 : 0.4, uv.y)) * smoothstep(0.28, 0.78, vf);
    col = mix(col, uMist, fogAmt * (uFog > 0.5 ? 0.9 : 0.55));

    col += (fract(sin(dot(gl_FragCoord.xy + floor(t * 24.0) * 3.17, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.05;

    float a = uFog > 0.5
      ? smoothstep(0.0, 0.05, uv.y) * (1.0 - smoothstep(0.1, 0.95, uv.y))
      : smoothstep(0.0, 0.1, uv.y) * (1.0 - smoothstep(0.82, 1.0, uv.y));
    gl_FragColor = vec4(col * a, a);
  }
`;

export function mountScenery(el, { mode = 'range', ink, mist, sky, glow } = {}) {
  const fog = mode === 'fog' ? 1 : 0;
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  el.appendChild(canvas);

  const C = (c) => new THREE.Color(c);
  const rt = new THREE.WebGLRenderTarget(2, 2);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  const scene = new THREE.Scene(); scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const res = new THREE.Vector2(1, 1);
  const rangeMat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: rangeFrag, depthTest: false,
    uniforms: { uRes: { value: res }, uFog: { value: fog }, uInk: { value: C(ink) }, uMist: { value: C(mist) }, uSky: { value: C(sky) }, uGlow: { value: C(glow) } } });
  const mistMat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: mistFrag, transparent: true, premultipliedAlpha: true, depthTest: false,
    uniforms: { tRange: { value: rt.texture }, uRes: { value: res }, uTime: { value: 0 }, uFog: { value: fog }, uMist: { value: C(mist) }, uSky: { value: C(sky) } } });

  // render at reduced resolution; grain and mist hide the upscale
  const SCALE = 0.6;
  function paintRange() {
    quad.material = rangeMat;
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.setRenderTarget(null);
  }
  function resize() {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setPixelRatio(SCALE);
    renderer.setSize(r.width, r.height, false);
    canvas.style.width = '100%'; canvas.style.height = '100%';
    res.set(r.width, r.height);
    rt.setSize(Math.round(r.width * SCALE), Math.round(r.height * SCALE));
    paintRange();
    draw();
  }

  let visible = false;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { rootMargin: '100px' }).observe(el);

  // gentle parallax on the canvas itself (no re-render needed)
  const readScroll = () => {
    if (fog) return;
    const r = el.getBoundingClientRect();
    const k = (r.top + r.height / 2 - window.innerHeight / 2) / window.innerHeight;
    canvas.style.transform = `translateY(${(k * 6).toFixed(2)}%) scale(1.14)`;
  };
  window.addEventListener('scroll', readScroll, { passive: true });

  const t0 = performance.now();
  function draw() {
    mistMat.uniforms.uTime.value = reduce ? 6 : (performance.now() - t0) / 1000 + 6;
    quad.material = mistMat;
    renderer.render(scene, cam);
  }
  new ResizeObserver(resize).observe(el);
  readScroll(); resize();

  let last = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    if (!visible || document.hidden || now - last < 40) return;
    last = now;
    draw();
  }
  if (!reduce) requestAnimationFrame(loop);
}
