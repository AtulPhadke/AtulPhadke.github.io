// Landing scene: black sand beach at night. Moon over the sea, a glitter path
// on the water, waves breaking and running up the wet sand, and a man seen from
// behind looking at the moon (signed-distance silhouette with moonlit rim,
// reflection on the wet sand, footprints leading to him). All procedural.

import * as THREE from 'three';
import { glyphAtlas } from '../gpu.js';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const vert = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const frag = /* glsl */`
  precision highp float;
  uniform vec2 uRes;
  uniform float uTime, uHz, uShore, uMoonR, uSky;   // uSky 1: no moon disc (a 3D object hangs there instead)
  uniform vec2 uMoon, uPar;
  uniform vec3 uMan;          // x, feet y, height (all in screen-height units)
  uniform vec3 uPaper;
  varying vec2 vUv;

  const vec3 SKY_TOP = vec3(0.016, 0.018, 0.026);
  const vec3 STAR    = vec3(0.62, 0.7, 1.0);
const vec3 SKY_HZ  = vec3(0.06, 0.067, 0.09);
  const vec3 MOON    = vec3(0.88, 0.91, 0.97);
  const vec3 OCEAN_HZ   = vec3(0.066, 0.075, 0.10);
  const vec3 OCEAN_NEAR = vec3(0.03, 0.036, 0.05);
  const vec3 FOAM    = vec3(0.70, 0.74, 0.82);
  const vec3 SAND    = vec3(0.013, 0.013, 0.015);
  const vec3 SKIN    = vec3(0.010, 0.010, 0.012);   // silhouette
  const vec3 RIM     = vec3(0.62, 0.68, 0.84);

  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }

  // --- silhouette SDF (iq's uneven capsule + ellipse) ---
  float cro(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }
  float sdUC(vec2 p, vec2 pa, vec2 pb, float ra, float rb) {
    p -= pa; pb -= pa;
    float h = dot(pb, pb);
    vec2 q = vec2(dot(p, vec2(pb.y, -pb.x)), dot(p, pb)) / h;
    q.x = abs(q.x);
    float b = ra - rb;
    vec2 c = vec2(sqrt(h - b * b), b);
    float k = cro(c, q), m = dot(c, q), n = dot(q, q);
    if (k < 0.0) return sqrt(h * n) - ra;
    else if (k > c.x) return sqrt(h * (n + 1.0 - 2.0 * q.y)) - rb;
    return m - ra;
  }
  float sdEll(vec2 p, vec2 r) { float k0 = length(p / r), k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / k1; }
  float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

  // feet at y=0, height 1. Weight on his right leg, head tipped up toward the moon.
  float man(vec2 q, float t) {
    float br = sin(t * 1.25) * 0.002;                                   // breathing
    float gust = 0.55 + 0.45 * sin(t * 0.37) * sin(t * 0.23 + 1.0);      // wind comes and goes
    float flap = (noise(vec2(q.y * 14.0 - t * 3.4, t * 0.6)) - 0.5) * 0.034 * gust;
    // wind from the left: the right side of the hoodie and the hem ripple
    vec2 qt = q;
    qt.x -= flap * smoothstep(-0.02, 0.09, q.x) * smoothstep(0.42, 0.62, q.y);
    float d = sdUC(qt, vec2(0.0, 0.48), vec2(0.0, 0.745 + br), 0.097, 0.104);          // baggy body
    d = smin(d, sdUC(qt, vec2(-0.088, 0.468), vec2(0.092 + flap, 0.462), 0.03, 0.03), 0.03);   // hem band
    d = smin(d, sdUC(q, vec2(-0.1, 0.78 + br), vec2(0.1, 0.785 + br), 0.043, 0.043), 0.05);   // round shoulders
    // hood up: a dome a little bigger than the head, draping into the shoulders
    float hood = sdEll(q - vec2(0.006, 0.905), vec2(0.074, 0.084));
    hood = smin(hood, sdEll(q - vec2(-0.004, 0.972), vec2(0.034, 0.024)), 0.03);          // soft peak
    hood = smin(hood, sdUC(q, vec2(-0.055, 0.828), vec2(0.057, 0.83), 0.05, 0.05), 0.04);   // drape
    hood += (noise(vec2(q.y * 30.0 - t * 3.5, q.x * 10.0)) - 0.5) * 0.008 * gust * smoothstep(0.0, 0.07, q.x);
    d = smin(d, hood, 0.035);
    // jeans, weight on his right leg
    float l = sdUC(q, vec2(-0.046, 0.47), vec2(-0.056, 0.27), 0.05, 0.036);
    l = smin(l, sdUC(q, vec2(-0.056, 0.27), vec2(-0.066, 0.035), 0.036, 0.03), 0.02);
    float r = sdUC(q, vec2(0.046, 0.47), vec2(0.046, 0.27), 0.05, 0.036);
    r = smin(r, sdUC(q, vec2(0.046, 0.27), vec2(0.047, 0.035), 0.036, 0.03), 0.02);
    d = smin(d, min(l, r), 0.02);
    d = min(d, sdEll(q - vec2(-0.067, 0.017), vec2(0.033, 0.02)));                     // shoes
    d = min(d, sdEll(q - vec2(0.048, 0.017), vec2(0.033, 0.02)));
    // hands in the front pocket: elbows out, forearms tuck forward behind the body
    float a = sdUC(q, vec2(-0.12, 0.765 + br), vec2(-0.146, 0.6), 0.04, 0.035);
    a = smin(a, sdUC(q, vec2(-0.146, 0.6), vec2(-0.108, 0.49), 0.035, 0.03), 0.02);
    vec2 qs = q; qs.x -= flap * 0.6 * smoothstep(0.5, 0.75, q.y);
    float b = sdUC(qs, vec2(0.122, 0.767 + br), vec2(0.148, 0.6), 0.04, 0.035);
    b = smin(b, sdUC(qs, vec2(0.148, 0.6), vec2(0.11, 0.49), 0.035, 0.03), 0.02);
    return smin(d, min(a, b), 0.008);
  }

  float shoreAt(float x) {
    float asp = uRes.x / uRes.y;
    float u = x / asp;                                   // 0..1 across the screen
    return uShore + 0.032 * cos((u - 0.18) * 3.4) + (noise(vec2(x * 2.2, 4.0)) - 0.5) * 0.016 + (noise(vec2(x * 7.0, 9.0)) - 0.5) * 0.005;
  }

  // wave train k: (crest y, swash run 0..1, foam strength, set id)
  vec4 wave(float x, float k, float t) {
    float P = 6.5 + k * 2.7;
    float tk = t / P + k * 0.37;
    float n = floor(tk), ph = fract(tk);
    float big = 0.45 + 0.75 * hash(vec2(n, k * 3.1));
    float lat = noise(vec2(x * 2.2 + n * 7.3, k * 5.0));
    float yc = shoreAt(x) + (0.05 + 0.04 * big) * (1.0 - smoothstep(0.0, 0.62, ph)) + (noise(vec2(x * 4.0 + n * 3.0, k * 9.0)) - 0.5) * 0.02;
    float amp = smoothstep(0.02, 0.15, ph) * (1.0 - smoothstep(0.5, 0.68, ph)) * smoothstep(0.25, 0.6, lat) * big;
    float run = sin(clamp((ph - 0.55) / 0.45, 0.0, 1.0) * 3.14159) * big * (0.55 + 0.7 * lat);
    return vec4(yc, run, amp, n);
  }

  float sdBx(vec2 p, vec2 b) { vec2 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
  // one small GPU: a pale card with two dark fans and a blue light bar along the top
  vec3 agentCard(vec3 col, vec2 q, vec2 hs, float px, float lit) {
    float sd = sdBx(q, hs) - hs.y * 0.12;
    col += MOON * exp(-max(sd, 0.0) / (hs.y * 1.2)) * 0.14 * lit;                  // a little light around it
    float cov = 1.0 - smoothstep(-px, px, sd);
    vec3 c = MOON * 1.0 * lit;
    vec2 fq = vec2(abs(q.x) - hs.x * 0.46, q.y + hs.y * 0.08);
    float fan = 1.0 - smoothstep(hs.y * 0.5, hs.y * 0.5 + px, length(fq));
    c = mix(c, MOON * 0.32 * lit, fan * (1.0 - smoothstep(hs.y * 0.08, hs.y * 0.16, length(fq))) * 0.0 + fan * 0.85);
    c = mix(c, MOON * 0.9, (1.0 - smoothstep(hs.y * 0.1, hs.y * 0.16, length(fq))) * fan);   // hub
    c = mix(c, vec3(0.36, 0.48, 1.0) * lit, step(hs.y * 0.62, q.y));                         // light bar
    return mix(col, c, cov);
  }
  vec3 agentSky(vec3 col, vec2 d, float t, float px) {
    float R = uMoonR * 0.72;                                  // core radius: smaller than the moon
    float tilt = -0.2, cs = cos(tilt), sn = sin(tilt);
    vec2 e = vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y);  // ring frame
    float A = R * 2.5, B = R * 0.6;
    float ringD = abs(length(e / vec2(A, B)) - 1.0) * B * 1.25;
    float ringCov = 1.0 - smoothstep(R * 0.08, R * 0.08 + px, ringD);
    vec2 hs = vec2(R * 0.5, R * 0.3);
    // back half of the ring and the cards behind the core
    col = mix(col, MOON * 0.3, ringCov * step(0.0, e.y));
    for (int i = 0; i < 3; i++) {
      float th = t * 0.42 + float(i) * 2.0944;
      if (sin(th) > 0.0) col = agentCard(col, e - vec2(A * cos(th), B * sin(th)), hs * mix(1.0, 0.78, sin(th)), px, 0.8);
    }
    // the core: a faceted sphere lit like the moon, with a blue heart that breathes
    float r = length(d) / R;
    if (r < 1.05) {
      vec2 mq = d / R;
      float limb = sqrt(max(0.0, 1.0 - r * r));
      vec3 n = vec3(mq, limb);
      float a = t * 0.3; n.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * n.xz;
      vec3 fc = floor(n * 2.2);
      float facet = hash12(fc.xy * 3.1 + fc.z * 7.7);
      vec3 cc = MOON * (0.74 + 0.26 * facet) * (0.72 + 0.28 * limb);
      float beat = 0.75 + 0.25 * sin(t * 2.0);
      cc = mix(cc, vec3(0.42, 0.53, 1.0) * 0.95, (1.0 - smoothstep(0.0, 0.5, r)) * 0.7 * beat);
      col = mix(col, cc, 1.0 - smoothstep(1.0 - 1.5 * px / R, 1.0, r));
    }
    // front half of the ring and the cards in front
    col = mix(col, MOON * 0.45, ringCov * step(e.y, 0.0));
    for (int i = 0; i < 3; i++) {
      float th = t * 0.42 + float(i) * 2.0944;
      if (sin(th) <= 0.0) col = agentCard(col, e - vec2(A * cos(th), B * sin(th)), hs * mix(1.0, 1.15, -sin(th)), px, 1.0);
    }
    return col;
  }

  void main() {
    vec2 p = gl_FragCoord.xy / uRes.y;
    float x = p.x, y = p.y, t = uTime;
    float hz = uHz, sh = shoreAt(p.x);
    vec2 mp = uMoon;
    float px = 1.0 / uRes.y;
    float dm = length(p - mp);
    float glow = exp(-dm * 16.0) * 0.6 + exp(-dm * 5.5) * 0.07;
    vec3 col;

    // man's local frame (used by silhouette, reflection, shadow)
    vec2 feet = uMan.xy;
    float mh = uMan.z;
    vec2 q = (p - feet) / mh;

    if (y > hz) {
      // ---------- sky ----------
      float k = smoothstep(hz, 1.0, y);
      col = mix(SKY_HZ, SKY_TOP, pow(k, 0.55));
      col += MOON * glow * (uSky > 0.5 && uSky < 1.5 ? 0.16 : 0.24);
      if (uSky > 0.5 && uSky < 1.5) col += STAR * exp(-dm * 6.0) * 0.05;
      // agent: drawn like the moon (same light, same glyph pass), shaped as a core, a ring and three orbiting GPUs
      if (uSky > 1.5) col = agentSky(col, p - mp, t, px);
      // moon
      if (uSky < 0.5 && dm < uMoonR * 1.05) {
        vec2 mq = (p - mp) / uMoonR;
        float r = length(mq);
        float limb = sqrt(max(0.0, 1.0 - r * r));
        float maria = fbm(mq * 2.1 + 4.0);
        vec3 mc = MOON * (0.8 + 0.2 * smoothstep(0.6, 0.38, maria)) * (0.72 + 0.28 * limb);
        col = mix(col, mc, 1.0 - smoothstep(1.0 - 1.5 * px / uMoonR, 1.0, r));
      }
      // thin clouds drifting across the moon
      float c = fbm(vec2(x * 1.1 - t * 0.006, y * 7.0 + 2.0));
      float c2 = fbm(vec2(x * 0.7 + 3.0 - t * 0.004, y * 18.0));
      float cm = smoothstep(0.6, 0.8, c) * smoothstep(0.5, 0.7, c2) * (1.0 - smoothstep(0.0, 0.11, abs(y - mp.y + 0.02)));
      col = mix(col, mix(SKY_HZ, MOON * 0.22, clamp(glow * 1.6, 0.0, 1.0)), cm * 0.3);
      col += (SKY_HZ * 0.6 + MOON * 0.05 * exp(-abs(x - mp.x) * 3.0)) * exp(-(y - hz) * 60.0);
    } else if (y > sh) {
      // ---------- sea ----------
      float dh = hz - y;
      float z = 1.0 / (dh + 0.02);
      float u = (x - mp.x) * z;
      vec3 base = mix(OCEAN_HZ, OCEAN_NEAR, smoothstep(0.0, hz - sh, dh));
      float wv = noise(vec2(u * 2.0, z * 1.4 - t * 0.35)) * 0.6 + noise(vec2(u * 5.0 + t * 0.2, z * 3.2 - t * 0.55)) * 0.4;
      base *= 0.78 + wv * 0.48;
      base *= 0.8 + 0.4 * noise(vec2(u * 0.5 + t * 0.03, z * 0.6 - t * 0.12));          // long swells
      float w = 0.016 + dh * 0.55;
      float path = exp(-pow((x - mp.x) / w, 2.0));
      float broad = exp(-pow((x - mp.x) / (w * 2.8), 2.0));
      float sp = noise(vec2(u * 14.0 + t * 0.3, z * 5.0 - t * 1.1)) * noise(vec2(u * 9.0 - t * 0.25, z * 7.0 - t * 0.8));
      float glit = smoothstep(0.26, 0.58, sp) * smoothstep(0.0, 0.06, y - sh) * (0.35 + 0.95 * noise(vec2(u * 1.5, z * 0.8 - t * 0.4)));
      col = base + MOON * (broad * 0.09 + path * (0.14 + glit * 1.1)) * (0.45 + 0.55 * smoothstep(0.0, 0.08, dh));
      col += (SKY_HZ * 0.7 + MOON * 0.06 * exp(-abs(x - mp.x) * 3.0)) * exp(-dh * 60.0);
      float rip = noise(vec2(u * 1.1 + t * 0.05, z * 2.6 - t * 0.55)) * noise(vec2(u * 0.35 - t * 0.03, z * 0.9 - t * 0.2));
      float ripL = smoothstep(0.24, 0.46, rip) * (0.35 + 0.65 * smoothstep(0.0, 0.05, dh));
      col += MOON * ripL * mix(0.035, 0.16, broad) * smoothstep(0.0, 0.05, y - sh);
      // whitecaps that flare and fade out on the open water
      vec2 wc = vec2(u * 2.4, z * 0.9 - t * 0.12);
      float era = floor(t * 0.22);
      float wh = hash(floor(wc) + era * 1.7);
      if (wh > 0.965) {
        float life = sin(fract(t * 0.22) * 3.14159);
        float f = length((fract(wc) - 0.5) * vec2(1.0, 2.5));
        col = mix(col, FOAM * 0.55, smoothstep(0.3, 0.0, f) * life * 0.7 * smoothstep(0.02, 0.1, dh));
      }
      for (int i = 0; i < 3; i++) {
        vec4 W = wave(x, float(i), t);
        float d = y - W.x;
        float crest = exp(-pow(d / 0.0028, 2.0));
        float lace = smoothstep(0.5, 0.78, fbm(vec2(x * 38.0 + float(i) * 5.0 + W.w, d * 160.0 + t * 0.3))) * step(0.0, d) * smoothstep(0.045, 0.0, d);
        float foam = clamp(crest * 0.9 + lace * 0.6, 0.0, 1.0) * W.z;
        col = mix(col, FOAM * (0.3 + broad * 0.7), foam * 0.75);
      }
      // thin, glassy water right at the edge: glitter calms into a smooth streak
      float edgeZone = 1.0 - smoothstep(0.0, 0.04, y - sh);
      col = mix(col, OCEAN_NEAR * 1.15 + MOON * path * 0.32, edgeZone * 0.7);
    } else {
      // ---------- black sand ----------
      float dd = sh - y;
      float grain = hash12(floor(gl_FragCoord.xy));
      float dune = fbm(vec2(x * 3.0, y * 12.0));
      vec3 sand = SAND * (0.82 + dune * 0.36) * (0.88 + grain * 0.24);
      float wet = 1.0 - smoothstep(0.0, 0.15, dd);
      col = mix(sand, mix(sand, OCEAN_NEAR * 0.55, 0.5), wet);
      float film = 1.0 - smoothstep(0.0, 0.02, dd);
      col = mix(col, OCEAN_NEAR * 1.15, film * 0.7);

      // moon reflected in the wet sand, with the man's reflection cut out of it
      float wsh = 0.028 + dd * 0.3;
      float rip = (noise(vec2(y * 140.0, t * 0.4)) - 0.5) * 0.008;
      float streak = exp(-pow((x - mp.x + rip) / wsh, 2.0));
      float sheen = streak * mix(0.5, 0.32, film) + exp(-pow((x - mp.x) / (wsh * 3.0), 2.0)) * 0.07;
      vec2 rq = vec2((x + rip * 0.6 - feet.x) / mh, (feet.y - y) / mh * 1.05);
      if (rq.y > -0.02 && rq.y < 1.05 && abs(rq.x) < 0.3) {
        float rd = man(rq, t);
        sheen *= mix(1.0, 0.08, 1.0 - smoothstep(-0.01, 0.02, rd));
      }
      col += MOON * sheen * wet * (0.55 + 0.45 * smoothstep(0.0, 0.03, dd));

      // swash: thin sheets of water running up the sand
      for (int i = 0; i < 3; i++) {
        vec4 W = wave(x, float(i), t);
        float ys = sh - 0.08 * W.y * (0.6 + 0.8 * noise(vec2(x * 3.0 + float(i) * 4.0 + W.w * 2.3, 1.0)));
        if (W.y > 0.01 && y > ys) {
          col = mix(col, OCEAN_NEAR * 1.3 + MOON * streak * 0.35, 0.55 * smoothstep(0.0, 0.3, W.y));
        }
        float edge = exp(-pow((y - ys) / 0.0026, 2.0)) * smoothstep(0.02, 0.25, W.y);
        float lace = fbm(vec2(x * 9.0 + float(i) * 3.0, t * 0.2));
        col = mix(col, FOAM * (0.22 + streak * 0.7), edge * (0.55 + lace * 0.45) * 0.6);
      }

      // footprints leading to him
      vec2 A = vec2(feet.x - mh * 0.95, -0.03), B = feet;
      vec2 seg = B - A;
      float tt = clamp(dot(p - A, seg) / dot(seg, seg), 0.0, 1.0);
      vec2 dir = normalize(seg), nrm = vec2(-dir.y, dir.x);
      const float N = 11.0;
      float best = 10.0;
      for (int j = -1; j <= 1; j++) {
        float i = floor(tt * N) + float(j);
        if (i < 0.0 || i > N - 1.0) continue;
        vec2 c = A + seg * (i / N);
        float sc = mix(1.7, 0.75, clamp(c.y / feet.y, 0.0, 1.0)) * mh / 0.35;
        c += nrm * (mod(i, 2.0) < 1.0 ? -1.0 : 1.0) * 0.011 * sc;
        vec2 lq = vec2(dot(p - c, nrm), dot(p - c, dir));
        best = min(best, length(lq / (vec2(0.0068, 0.0145) * sc)) - 1.0);
      }
      col *= 1.0 - (1.0 - smoothstep(-0.25, 0.1, best)) * 0.45;

      // his shadow, cast toward us and a little left
      vec2 s = p - feet;
      if (s.y < 0.0) {
        float v = -s.y;
        vec2 sq = vec2((s.x + v * 0.35) / mh, v / (mh * 0.42));
        if (sq.y < 1.05 && abs(sq.x) < 0.3) col *= 1.0 - (1.0 - smoothstep(-0.02, 0.04, man(sq, t))) * 0.45 * smoothstep(1.0, 0.2, sq.y);
      }

      // a few volcanic grains catching the moon
      vec2 gc = floor(gl_FragCoord.xy / 2.0);
      float gh = hash12(gc + 17.0);
      if (gh > 0.9992) col += MOON * 0.22 * (0.5 + 0.5 * sin(t * 2.0 + gh * 90.0)) * (1.0 - wet);
    }

    // ---------- the man ----------
    if (abs(q.x) < 0.3 && q.y > -0.04 && q.y < 1.05) {
      float d = man(q, t);
      float e = px / mh;
      float m = 1.0 - smoothstep(-e, e, d);
      if (m > 0.0) {
        vec3 body = SKIN;
        if (d > -5.0 * e) {
          vec2 g = vec2(man(q + vec2(e, 0.0), t) - man(q - vec2(e, 0.0), t), man(q + vec2(0.0, e), t) - man(q - vec2(0.0, e), t));
          vec2 n = normalize(g + 1e-6);
          vec2 L = normalize(mp - (feet + vec2(0.0, mh * 0.7)));
          float rim = smoothstep(-4.0 * e, 0.0, d) * pow(max(0.0, dot(n, L)), 1.5);
          body += RIM * rim * 0.75;
        }
        col = mix(col, body, m);
      }
    }

    // vignette, grain, and melt into the page at the bottom
    vec2 vq = vUv - vec2(0.5, 0.55);
    col *= 1.0 - 0.45 * dot(vq, vq);
    gl_FragColor = vec4(max(col, 0.0), 1.0);
  }
`;

function layout(W, H, sky = 'moon') {
  const asp = W / H;
  if (asp >= 1.05) {
    if (sky === 'gpu') return { hz: 0.42, shore: 0.235, moon: [asp * 0.705, 0.69], moonR: 0.046, man: [asp * 0.69, 0.115, 0.34] };
    return { hz: 0.42, shore: 0.235, moon: [asp * 0.705, 0.73], moonR: 0.048, man: [asp * 0.69, 0.115, 0.34] };
  }
  // portrait: a low moon just over the sea, below the intro text
  // (a GPU / agent star is bigger than the moon disc, so it sits a little higher and more central, between the text and his head)
  if (sky === 'agent') return { hz: 0.263, shore: 0.175, moon: [asp * 0.76, 0.4], moonR: 0.036, man: [asp * 0.6, 0.07, 0.23] };
  if (sky === 'gpu') return { hz: 0.263, shore: 0.175, moon: [asp * 0.62, 0.392], moonR: 0.029, man: [asp * 0.6, 0.07, 0.23] };
  return { hz: 0.263, shore: 0.175, moon: [asp * 0.72, 0.335], moonR: 0.036, man: [asp * 0.6, 0.07, 0.23] };
}

// Glyph pass: every cell of the low-res scene becomes · : 0 1 (or + for a bright star),
// coloured by the scene, over a faint pixel mosaic of the scene itself.
const glyphFrag = /* glsl */`
  precision highp float;
  uniform sampler2D tScene, tGlyph;
  uniform vec2 uRes;          // device px
  uniform float uCell, uTime, uHz, uGain, uBase;
  uniform vec4 uQuiet;        // text box in uv (x0, y0, x1, y1): glyphs thin out behind the type
  uniform vec2 uMoon;
  uniform vec3 uInk, uAccent, uPaper;
  varying vec2 vUv;
  float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  void main() {
    vec2 fp = vUv * uRes;
    vec2 cell = floor(fp / uCell);
    vec2 local = fract(fp / uCell);
    vec2 cuv = (cell + 0.5) * uCell / uRes;
    vec3 sc = texture2D(tScene, cuv).rgb;
    float lum = dot(sc, vec3(0.299, 0.587, 0.114));
    float l = pow(clamp(lum * uGain, 0.0, 1.0), 0.72);
    vec2 qb = smoothstep(uQuiet.xy - 0.05, uQuiet.xy + 0.02, cuv) * (1.0 - smoothstep(uQuiet.zw - 0.02, uQuiet.zw + 0.05, cuv));
    l *= 1.0 - 0.6 * qb.x * qb.y;
    float h = h12(cell);
    float bit = step(0.5, h12(cell + floor(uTime * (0.25 + h * 1.3) + h * 9.0)));
    float dj = (h12(cell * 0.71 + 3.0) - 0.5) * 0.16;
    float ld = l + dj;
    float idx = ld < 0.19 ? -1.0 : ld < 0.3 ? 0.0 : ld < 0.44 ? 1.0 : 2.0 + bit;
    vec3 hue = clamp(sc / max(lum, 0.02), 0.0, 1.6);
    vec3 gcol = mix(uInk, uInk * 0.45 + hue * 0.55, 0.65) * (0.32 + 0.85 * l);

    // stars sit on cells so they stay crisp; a few are accent blue
    vec2 p = vec2(cuv.x * uRes.x / uRes.y, cuv.y);
    if (cuv.y > uHz + 0.04 && idx < 0.0) {
      float s = h12(cell * 1.37 + 5.0);
      float dm = length(p - uMoon);
      if (s > 0.987 && dm > 0.12) {
        float tw = 0.5 + 0.5 * sin(uTime * (0.6 + s * 30.0) + s * 300.0);
        idx = s > 0.9975 ? 4.0 : 0.0;
        gcol = mix(uInk, uAccent * 1.3, step(0.9955, s) * step(s, 0.9975)) * (0.35 + 0.65 * tw) * smoothstep(uHz + 0.04, uHz + 0.2, cuv.y);
      }
    }
    float g = idx < 0.0 ? 0.0 : texture2D(tGlyph, vec2((idx + local.x) / 5.0, local.y)).r;
    vec3 col = sc * uBase + gcol * g;
    col = mix(uPaper, col, smoothstep(0.0, 0.09, vUv.y));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export async function mountBeach(el, { paper = '#1a1b1a', ink = '#dfece4', accent = '#5a6dff', cell = 5.5, quiet = null, base = 0.55, sky = 'moon', onMoon = null } = {}) {
  try { await document.fonts.load('600 40px "Geist Mono"'); } catch (_) { /* fallback ok */ }
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  el.appendChild(canvas);

  // pass 1: the scene, rendered small (2x2 samples per glyph cell)
  const SS = 2;
  const rt = new THREE.WebGLRenderTarget(2, 2, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: THREE.HalfFloatType });
  const U = {
    uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uHz: { value: 0.43 }, uShore: { value: 0.21 }, uMoonR: { value: 0.05 }, uSky: { value: sky === 'moon' ? 0 : sky === 'gpu' ? 1 : 2 },
    uMoon: { value: new THREE.Vector2() }, uPar: { value: new THREE.Vector2() }, uMan: { value: new THREE.Vector3() },
    uPaper: { value: new THREE.Color(paper) },
  };
  const sceneMat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: U, depthTest: false });
  // pass 2: glyphs
  const G = {
    tScene: { value: rt.texture }, tGlyph: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uCell: { value: 11 },
    uTime: U.uTime, uHz: U.uHz, uMoon: U.uMoon, uGain: { value: 3.5 }, uBase: { value: base }, uQuiet: { value: new THREE.Vector4(-1, -1, -1, -1) },
    uInk: { value: new THREE.Color(ink) }, uAccent: { value: new THREE.Color(accent) }, uPaper: { value: new THREE.Color(paper) },
  };
  const glyphMat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: glyphFrag, uniforms: G, depthTest: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sceneMat);
  const scene = new THREE.Scene(); scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  let atlasSize = 0;
  function resize() {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(r.width, r.height, false);
    canvas.style.width = '100%'; canvas.style.height = '100%';
    const S = Math.max(4, Math.round(cell * dpr));
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    G.uRes.value.set(W, H); G.uCell.value = S;
    const cols = Math.ceil(W / S), rows = Math.ceil(H / S);
    rt.setSize(cols * SS, rows * SS);
    U.uRes.value.set(cols * SS, rows * SS);
    if (S !== atlasSize) {
      atlasSize = S;
      G.tGlyph.value?.dispose();
      G.tGlyph.value = glyphAtlas(['·', ':', '0', '1', '+'], '"Geist Mono", ui-monospace, monospace', S, 0.92);
    }
    // the scene is laid out on the glyph grid's aspect so cells and layout agree
    const L = layout(cols * S / dpr, rows * S / dpr, sky);
    U.uHz.value = L.hz; U.uShore.value = L.shore; U.uMoonR.value = L.moonR;
    U.uMoon.value.set(...L.moon); U.uMan.value.set(...L.man);
    // where the moon sits, in CSS px from the element's top-left (the scene grid starts at the bottom edge)
    const gH = rows * S / dpr;
    onMoon?.({ x: L.moon[0] * gH, y: r.height - L.moon[1] * gH, r: L.moonR * gH });
    draw();
  }

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener('pointermove', (e) => { pointer.tx = e.clientX / window.innerWidth - 0.5; pointer.ty = e.clientY / window.innerHeight - 0.5; }, { passive: true });

  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(el);

  const t0 = performance.now();
  function quietBox() {
    if (!quiet || !quiet.children.length) return;
    const c = canvas.getBoundingClientRect();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of quiet.children) { const r = n.getBoundingClientRect(); x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); }
    G.uQuiet.value.set((x0 - c.left) / c.width, 1 - (y1 - c.top) / c.height, (x1 - c.left) / c.width, 1 - (y0 - c.top) / c.height);
  }
  function draw() {
    quietBox();
    pointer.x += (pointer.tx - pointer.x) * 0.05; pointer.y += (pointer.ty - pointer.y) * 0.05;
    U.uPar.value.set(pointer.x, -pointer.y);
    U.uTime.value = reduce ? 3.5 : (performance.now() - t0) / 1000 + 3.5;
    quad.material = sceneMat;
    renderer.setRenderTarget(rt); renderer.render(scene, cam);
    quad.material = glyphMat;
    renderer.setRenderTarget(null); renderer.render(scene, cam);
  }
  new ResizeObserver(resize).observe(el);
  resize();

  let last = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    if (!visible || now - last < 33) return;
    last = now;
    draw();
  }
  if (!reduce) requestAnimationFrame(loop);
  el.dataset.ready = 'true';
}
