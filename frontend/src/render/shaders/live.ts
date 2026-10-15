/**
 * (§16) What the live layers draw: a leaf canopy whose leaves flutter one by one, palm fronds that sway out of step,
 * and soft drifting clouds. Used by shaders/layer.ts (procedural tree sway, palm sway, clouds). Each function returns
 * how much light passes (1 = open sky, 0 = full shadow), so a multiply layer is a mask over the light.
 *
 * Needs NOISE (shaders/common.ts) before it.
 */
export const LIVE_GLSL = `
// a pointed leaf (vesica) of half length b along y
float sdLeaf(vec2 p, float r, float d) {
  p = abs(p);
  float b = sqrt(max(r * r - d * d, 1e-6));
  return ((p.y - b) * d > p.x * b) ? length(p - vec2(0.0, b)) : length(p - vec2(-d, 0.0)) - r;
}

// A leaf canopy: clusters of pointed leaves at three depths (near ones soft) with branches and twigs. Every leaf turns
// a little on its own stalk at its own pace (phase and rate from its cell), and narrows as it turns its edge to the
// light, so the canopy shimmers instead of wobbling as one sheet.
float liveLeaves(vec2 q, float density, float size, float seed, float t, float flutter) {
  vec2 p = q * 2.0 + seed * 3.17;
  float cl = fbm(p * 0.5 + 4.0) + 0.18 * (fbm(p * 1.4 + 9.0) - 0.5);
  float thr = mix(0.64, 0.34, density);
  float cluster = smoothstep(thr - 0.08, thr + 0.12, cl);
  float cover = 0.0;
  for (int oct = 0; oct < 3; oct++) {
    float fo = float(oct);
    float sc = mix(10.0, 5.0, size) * (oct == 0 ? 0.55 : oct == 1 ? 1.0 : 1.8);
    vec2 lp = p * sc + fo * 17.3;
    vec2 li = floor(lp);
    float w = max(length(fwidth(lp)), 1e-4);
    float soft = oct == 0 ? 0.16 : w;
    // small far leaves flutter faster, big near ones slower
    float rate = oct == 0 ? 0.7 : oct == 1 ? 1.0 : 1.35;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 c = li + vec2(float(x), float(y));
      vec2 hh = hash2(c + seed + fo * 3.0);
      float local = smoothstep(thr - 0.1, thr + 0.1, fbm((c + hh) / sc * 0.5 + 4.0 + seed * 3.17 * 0.5));
      if (hh.x > local * (oct == 0 ? 0.18 : oct == 1 ? 0.95 : 0.7) + density * 0.1) continue;
      float ph = hh.x * 6.2832 + hh.y * 13.1;
      float fl = flutter * (0.6 * sin(t * (2.3 + 1.7 * hh.x) * rate + ph) + 0.4 * sin(t * (4.1 + 2.1 * hh.y) * rate + ph * 1.7));
      // the leaf hangs from its stalk (at its base): turn about the stalk, not the centre
      vec2 d = lp - c - hh;
      d = rot(hh.y * 6.28) * d;
      float r = 0.5 + 0.35 * hash(c * 1.7 + seed);
      vec2 stalk = vec2(0.0, -r * 0.8);
      d = stalk + rot(fl * 0.55) * (d - stalk);
      d.x /= max(0.4, 1.0 - 0.5 * abs(fl));
      float e = sdLeaf(d, r, r * 0.6);
      cover = max(cover, (1.0 - smoothstep(-soft, soft, e)) * (oct == 0 ? 0.8 : 1.0));
    }
  }
  cover = max(cover, 0.85 * cluster * smoothstep(0.82, 1.0, density + cl * 0.25) * smoothstep(0.35, 0.65, noise(p * 6.0)));
  // boughs and twigs: the zero lines of two fbm fields, drawn at an even width (the field divided by its gradient is
  // about the distance to the line), so a bough never swells into a blob where the noise flattens out
  float px = max(length(vec2(dFdx(q.x), dFdy(q.x))), 1e-5);
  float f1 = fbm(p * 0.5 + vec2(2.3, 7.1)) - 0.5;
  float f2 = fbm(p * 1.2 + vec2(9.1, 1.3)) - 0.5;
  float d1 = abs(f1) * px / max(length(vec2(dFdx(f1), dFdy(f1))), 1e-6);
  float d2 = abs(f2) * px / max(length(vec2(dFdx(f2), dFdy(f2))), 1e-6);
  float trunk = smoothstep(0.7, -0.6, q.y);
  float br = (1.0 - smoothstep(0.004 + 0.006 * trunk, 0.004 + 0.006 * trunk + px * 1.5, d1)) * smoothstep(0.3, 0.55, cl + trunk * 0.25);
  float tw = (1.0 - smoothstep(0.0022, 0.0022 + px * 1.5, d2)) * smoothstep(0.35, 0.6, cl);
  cover = max(cover, max(br, tw * 0.9));
  return 1.0 - 0.94 * clamp(cover, 0.0, 1.0);
}

// Palm fronds arching out of a crown above the frame. Each frond sways with the wind out of step with the others,
// droops more in a gust, and its leaflets ripple along the rib.
float livePalm(vec2 q, float fronds, float seed, float t, float sway, float gust, float flutter) {
  vec2 crown = vec2(0.25, -0.75);
  float cover = 0.0;
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    if (fi >= fronds) break;
    float own = sin(t * (0.9 + 0.23 * fi) + fi * 2.1) * (0.02 + 0.03 * flutter);
    float ang = mix(0.25, 2.9, (fi + 0.5) / fronds) + (hash(vec2(fi, seed)) - 0.5) * 0.35 + sway * 0.05 * (0.8 + 0.4 * sin(fi * 1.7)) + own;
    float len = 0.75 + 0.45 * hash(vec2(fi, seed + 1.0));
    vec2 dir = vec2(cos(ang), sin(ang));
    float droop = 0.42 + 0.08 * gust;
    vec2 a = crown;
    float along0 = 0.0;
    for (int k = 0; k < 7; k++) {
      float t1 = float(k + 1) / 7.0;
      vec2 b = crown + dir * len * t1 + vec2(0.0, droop * len * t1 * t1);
      vec2 ba = b - a;
      float sl = length(ba);
      vec2 tt = ba / sl;
      vec2 n = vec2(-tt.y, tt.x);
      vec2 pa = q - a;
      float h = clamp(dot(pa, tt) / sl, 0.0, 1.0);
      float side = dot(pa, n);
      float along = (along0 + h * sl) / len;
      float perp = abs(dot(pa - tt * h * sl, n));
      float half_ = (0.03 + 0.17 * sin(3.14159 * clamp(along, 0.0, 1.0))) * (1.0 - 0.3 * along);
      if (h > 0.0 && h < 1.0 && perp < half_) {
        // leaflets: narrow blades angled back from the rib; a ripple runs along them in the wind
        float ripple = 0.07 * flutter * sin(t * 4.3 - along * 11.0 + fi * 1.9) * along;
        float lf = fract((along * len * 26.0) + perp * 26.0 * 0.9 + (side > 0.0 ? 0.37 : 0.0) + ripple);
        float blade = 1.0 - smoothstep(0.42, 0.62, abs(lf - 0.5) * 2.0 + perp / half_ * 0.35);
        float tip = smoothstep(half_, half_ * 0.7, perp);
        cover = max(cover, blade * tip);
      }
      cover = max(cover, 1.0 - smoothstep(0.004, 0.008, perp + (h <= 0.0 || h >= 1.0 ? 1.0 : 0.0)));
      along0 += sl;
      a = b;
    }
  }
  return 1.0 - 0.94 * clamp(cover, 0.0, 1.0);
}

// Cloud shadows: fbm warped by a second, slower fbm (so the shapes billow and evolve instead of sliding as a still
// texture), a big slow layer and a smaller faster one on top, soft edges and denser cores.
float liveClouds(vec2 q, float t, float speed, float density, float softness) {
  float sp = 0.012 + speed * 0.07;
  vec2 c = q * 1.15;
  vec2 drift = vec2(t * sp, t * sp * 0.22);
  vec2 warp = vec2(fbm(c * 0.7 + drift * 0.5 + vec2(0.0, t * 0.006)), fbm(c * 0.7 + drift * 0.5 + vec2(5.2, 1.3) - vec2(t * 0.005, 0.0))) - 0.5;
  float big = fbm(c + drift + 1.7 * warp);
  float small = fbm(c * 2.2 + drift * 1.8 + vec2(3.1, 7.7) + 0.9 * warp);
  // the sum of two fbm layers bunches round 0.5: stretch it back so there are clear gaps of sun between clouds
  float n = (big * 0.72 + small * 0.28 - 0.5) * 1.7 + 0.5;
  float th = 0.64 - density * 0.28;
  float w = 0.04 + softness * 0.22;
  float cover = smoothstep(th - w, th + w, n);
  float core = smoothstep(th, th + 0.22 + w, n);
  return 1.0 - cover * (0.5 + 0.38 * core);
}
`
