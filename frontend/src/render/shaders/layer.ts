/**
 * The backdrop layer shader. One program; the layer kind and catalog item are chosen by uniforms.
 * Output is premultiplied colour with the layer's opacity applied.
 *
 * Pattern space q: centred on the frame (plus offset), aspect-corrected (frame height = 1), rotated by the light
 * angle and divided by its scale.
 */
import { FULLSCREEN_VS, HEADER, NOISE } from './common'
import { SHAPES_GLSL } from './light'

export const GOBO_IDS = ['window', 'blinds', 'tree', 'palm', 'arch', 'lattice', 'dots', 'spot'] as const
export const PROCEDURAL_IDS = ['tree-sway', 'palm-sway', 'clouds', 'rain-glass', 'lightning', 'day-cycle', 'sun-drift', 'candle-flicker', 'caustics', 'dapple', 'film-grain', 'haze'] as const
/** video (§14) draws like a photo, from a video texture */
export const KIND_CODE = { gobo: 0, procedural: 1, gradient: 2, photo: 3, solid: 4, video: 3 } as const

export const LAYER_VS = FULLSCREEN_VS

export const LAYER_FS = `${HEADER}
in vec2 v_uv;
out vec4 o_color;

uniform int u_kind;          // 0 gobo 1 procedural 2 gradient 3 photo 4 solid
uniform int u_ref;           // index into GOBO_IDS or PROCEDURAL_IDS
uniform int u_blend;         // 0 normal 1 multiply 2 screen 3 add
uniform float u_opacity;
uniform vec2 u_res;          // scene px
uniform float u_clock;

// light
uniform vec3 u_light;        // colour × intensity × fx gain × fx rgb
uniform float u_angle;       // radians
uniform float u_scale;
uniform vec2 u_offset;       // fraction of frame
uniform float u_seed;

// procedural params (generic slots, see engine)
uniform vec4 u_pa;           // e.g. wind, gust, focus, seed
uniform vec4 u_pb;
uniform vec3 u_pcolor;       // day-cycle colour ratio
uniform float u_pgain;       // lightning / candle curve

// gradient
uniform vec3 u_stopColor[8];
uniform float u_stopPos[8];
uniform int u_stopN;
uniform float u_gAngle;      // radians, CSS convention
uniform float u_gDrift;
uniform float u_gGrain;
uniform float u_gBright;

// photo
uniform sampler2D u_tex;
uniform vec2 u_texSize;
uniform float u_pBright;
uniform float u_pWarm;
uniform float u_pDrift;
uniform vec2 u_pMove;        // (§15) motion offset, frame fractions
uniform float u_pScale;      // (§15) motion zoom

// solid
uniform vec3 u_solid;

// (§15) the attachment shapes, for tree and palm sway
uniform vec4 u_gp0;
uniform vec4 u_gp1;
uniform vec4 u_gp2;

${NOISE}
${SHAPES_GLSL}

// ── gobos: return light passing 0..1 ─────────────────────────────────────────

float boxMask(vec2 q, vec2 half_) {
  vec2 d = abs(q) - half_;
  float dist = max(d.x, d.y);
  return 1.0 - aastep(0.0, dist);
}

float softFalloff(vec2 q, float r) {
  return smoothstep(r, r * 0.25, length(q));
}

float goboWindow(vec2 q) {
  q.x += q.y * 0.42;                     // sunlight hits the wall at a slant
  vec2 half_ = vec2(0.3, 0.34);
  float inside = boxMask(q, half_);
  vec2 g = (q + half_) / (2.0 * half_) * vec2(2.0, 3.0);
  vec2 f = abs(fract(g) - 0.5);
  // distance to the nearest mullion in frame units
  float edgeX = (0.5 - f.x) / 2.0 * (2.0 * half_.x);
  float edgeY = (0.5 - f.y) / 3.0 * (2.0 * half_.y);
  float panes = aastep(0.012, min(edgeX, edgeY));
  return inside * panes * softFalloff(q, 1.3);
}

float goboBlinds(vec2 q) {
  float inside = boxMask(q, vec2(0.7, 0.55));
  float s = fract(q.y * 11.0);
  float slat = aastep(0.42, s);
  return inside * slat * softFalloff(q, 1.4);
}

float treeShadow(vec2 q, float seed) {
  vec2 p = q * 2.2 + seed * 3.17;
  // where the canopy is: big soft clusters
  float cluster = smoothstep(0.45, 0.6, fbm(p * 0.7 + 4.0));
  // individual leaves: small cells with a random ellipse each
  vec2 lp = p * 7.0;
  vec2 li = floor(lp);
  float leaf = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 c = li + vec2(float(x), float(y));
    vec2 h = hash2(c + seed);
    vec2 d = lp - c - h;
    d = rot(h.x * 6.28) * d;
    float e = length(d * vec2(1.0, 1.5)) - (0.3 + 0.35 * h.y);
    float w = max(length(fwidth(lp)), 1e-4);
    leaf = max(leaf, 1.0 - smoothstep(-w, w, e));
  }
  leaf *= cluster * step(0.25, hash(li * 0.37 + 2.0) + cluster * 0.6);
  // branches: thin ridges of a low-frequency field that thicken towards the trunk
  float r1 = abs(fbm(p * 0.55 + vec2(2.3, 7.1)) - 0.5);
  float r2 = abs(fbm(p * 1.3 + vec2(9.1, 1.3)) - 0.5);
  float trunk = smoothstep(0.6, -0.6, q.y);
  float br = (1.0 - aastep(0.005 + 0.008 * trunk, r1)) * smoothstep(0.25, 0.5, fbm(p * 0.7 + 4.0) + trunk * 0.3);
  float twig = (1.0 - aastep(0.004, r2)) * smoothstep(0.3, 0.55, fbm(p * 0.7 + 4.0));
  return clamp(max(leaf, max(br, twig * 0.9)), 0.0, 1.0);
}

float palmShadow(vec2 q, float seed, float sway) {
  vec2 c = vec2(0.15, -0.35);
  vec2 d = q - c;
  float r = length(d);
  float a = atan(d.y, d.x);
  float shadow = 0.0;
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    float base = fi / 9.0 * 6.2831 + seed + 0.35 * sin(fi * 1.7);
    base += sway * (0.6 + 0.4 * sin(fi * 2.1)) * smoothstep(0.0, 1.0, r);
    float bend = 0.25 * r * sin(fi * 3.1 + 1.0);
    float da = a - base - bend;
    da = mod(da + 3.14159, 6.28318) - 3.14159;
    float len = 0.8 + 0.4 * hash(vec2(fi, seed));
    float along = r / len;
    if (along > 1.0) continue;
    float w = 0.02 + 0.18 * sin(3.14159 * along);
    // leaflets
    float leaf = abs(fract(r * 38.0) - 0.5);
    float feather = smoothstep(w, w * 0.15, abs(da) * (0.6 + leaf));
    float rib = smoothstep(0.012, 0.004, abs(da) * r);
    shadow = max(shadow, max(feather, rib));
  }
  shadow = max(shadow, smoothstep(0.05, 0.03, r));
  return shadow;
}

float goboArch(vec2 q) {
  vec2 half_ = vec2(0.28, 0.42);
  float rect = boxMask(q - vec2(0.0, 0.08), vec2(half_.x, half_.y - 0.08));
  float top = 1.0 - aastep(half_.x, length(q - vec2(0.0, -0.26)));
  float topHalf = 1.0 - aastep(-0.26, q.y);
  float inside = max(rect, top * topHalf);
  float mull = min(abs(q.x), abs(q.y - 0.1));
  float panes = aastep(0.014, mull);
  return inside * panes * softFalloff(q, 1.2);
}

float goboLattice(vec2 q) {
  vec2 p = rot(0.7854) * q * 7.0;
  vec2 f = abs(fract(p) - 0.5);
  float d = 0.5 - max(f.x, f.y);
  return aastep(0.09, d) * softFalloff(q, 1.5);
}

float dots(vec2 q, float seed, float t, float density) {
  vec2 p = q * 6.0;
  vec2 i = floor(p);
  float best = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 cell = i + vec2(float(x), float(y));
    vec2 h = hash2(cell + seed);
    if (h.x > density) continue;
    vec2 c = cell + 0.5 + 0.35 * vec2(sin(t + h.x * 6.28), cos(t * 0.8 + h.y * 6.28));
    float r = 0.18 + 0.3 * h.y;
    float d = length(p - c) - r;
    float w = max(length(fwidth(p)), 1e-4);
    best = max(best, 1.0 - smoothstep(-w, w, d));
  }
  return best;
}

float goboSpot(vec2 q) {
  return 1.0 - aastep(0.32, length(q));
}

float gobo(int id, vec2 q) {
  if (id == 0) return goboWindow(q);
  if (id == 1) return goboBlinds(q);
  if (id == 2) return (1.0 - treeShadow(q, u_seed)) * softFalloff(q, 1.6);
  if (id == 3) return (1.0 - palmShadow(q, u_seed, 0.0)) * softFalloff(q, 1.6);
  if (id == 4) return goboArch(q);
  if (id == 5) return goboLattice(q);
  if (id == 6) return dots(q, u_seed, 0.0, 0.55) * softFalloff(q, 1.4);
  return goboSpot(q);
}

// ── procedural: return modulation m3 ─────────────────────────────────────────

vec3 procedural(int id, vec2 q, vec2 p) {
  float t = u_clock;
  if (id == 0) { // tree-sway: the leaf breakup on a tree that sways from a trunk far below the frame
    float wind = u_pa.x, gust = u_pa.y;
    float g = smoothstep(0.5, 0.9, noise(vec2(t * 0.25, u_pa.w)));
    float ang = (0.034 * sin(t * (0.55 + wind * 0.9)) + 0.016 * sin(t * (1.3 + wind) + 1.3)) * (0.25 + wind) + g * gust * 0.06 * sin(t * 2.1);
    vec2 pivot = vec2(0.1, 1.7);
    vec2 qq = pivot + rot(ang) * (q - pivot);
    // leaves flutter on their own
    qq += (vec2(noise(q * 5.0 + t * (0.5 + wind)), noise(q * 5.0 - t * (0.4 + wind) + 3.0)) - 0.5) * 0.01 * (wind + gust);
    return vec3(shapeLeaves(qq / 1.4));
  }
  if (id == 1) { // palm-sway: fronds bending from the crown
    float wind = u_pa.x, gust = u_pa.y;
    float g = smoothstep(0.5, 0.9, noise(vec2(t * 0.3, u_pa.w)));
    vec2 crown = vec2(0.25, -0.75);
    float r = length(q - crown);
    float ang = (0.06 * sin(t * (0.5 + wind * 1.1)) + 0.03 * sin(t * 1.7 + 0.7)) * (0.3 + wind) * (0.4 + r) + g * gust * 0.08 * sin(t * 1.9);
    vec2 qq = crown + rot(ang) * (q - crown);
    return vec3(shapePalm(qq / 1.2));
  }
  if (id == 2) { // clouds: speed, density, softness
    vec2 c = q * 1.3 + vec2(t * (0.01 + u_pa.x * 0.08), t * 0.004);
    float n = fbm(c);
    float w = 0.05 + u_pa.z * 0.3;
    float cover = smoothstep(0.62 - u_pa.y * 0.35 - w, 0.62 - u_pa.y * 0.35 + w, n);
    return vec3(1.0 - cover * 0.85);
  }
  if (id == 3) { // rain-glass: amount, speed, drops
    vec2 uv = q * vec2(1.0, 1.0);
    float m = 1.0;
    float sz = 0.6 + u_pa.z * 1.4;
    for (int l = 0; l < 2; l++) {
      float fl = float(l);
      vec2 grid = vec2(7.0, 3.5) / sz * (1.0 + fl * 0.8);
      vec2 g = uv * grid;
      g.y += t * (0.15 + u_pa.y * 0.9) * (1.0 + fl * 0.5);
      vec2 id2 = floor(g);
      vec2 f = fract(g) - 0.5;
      vec2 h = hash2(id2 + fl * 13.0);
      if (h.x > u_pa.x) continue;
      float wob = sin(t * 3.0 + h.y * 30.0) * 0.12;
      vec2 dp = f - vec2(wob, (h.y - 0.5) * 0.5);
      dp.x *= grid.y / grid.x * 2.0;
      float d = length(dp);
      float drop = smoothstep(0.16, 0.08, d);
      float rim = smoothstep(0.17, 0.12, d) - smoothstep(0.11, 0.06, d);
      float trail = smoothstep(0.05, 0.0, abs(f.x - wob)) * smoothstep(-0.5, 0.5, f.y - (h.y - 0.5) * 0.5) * 0.35;
      m -= rim * 0.55 + trail * 0.25;
      m += drop * 0.12;
    }
    float streaks = smoothstep(0.7, 1.0, noise(vec2(q.x * 40.0, q.y * 2.0 + t * 0.6))) * 0.15 * u_pa.x;
    return vec3(clamp(m - streaks, 0.0, 1.0));
  }
  if (id == 4) { // lightning: flash curve from the CPU
    float shape = 0.75 + 0.25 * fbm(q * 2.0 + floor(t * 0.3) * 7.0);
    return vec3(clamp(u_pgain * shape, 0.0, 1.0));
  }
  if (id == 5) { // day-cycle
    return clamp(u_pcolor, 0.0, 1.0);
  }
  if (id == 6) { // sun-drift: speed, travel
    float sp = t * (0.02 + u_pa.x * 0.2);
    vec2 c = vec2(sin(sp) * u_pa.y * 0.7, cos(sp * 0.7) * u_pa.y * 0.25);
    float d = length(q - c);
    return vec3(smoothstep(0.75, 0.0, d));
  }
  if (id == 7) { // candle-flicker
    float dx = (noise(vec2(t * 3.0, 1.0)) - 0.5) * 0.05 * u_pa.x;
    float glow = smoothstep(1.4, 0.0, length(q - vec2(dx, 0.2)));
    return vec3(clamp(u_pgain * mix(1.0, glow, 0.5), 0.0, 1.0));
  }
  if (id == 8) { // caustics: speed, scale, sharpness
    vec2 cp = mod(q * (0.6 + u_pa.y * 1.6) * 6.28318, 6.28318) - 250.0;
    float tt = t * (0.2 + u_pa.x * 1.2) + 23.0;
    vec2 i = cp;
    float c = 1.0;
    for (int n = 0; n < 4; n++) {
      float fn = float(n) + 1.0;
      float tn = tt * (1.0 - 3.5 / fn);
      i = cp + vec2(cos(tn - i.x) + sin(tn + i.y), sin(tn - i.y) + cos(tn + i.x));
      c += 1.0 / length(vec2(cp.x / (sin(i.x + tn) / 0.005), cp.y / (cos(i.y + tn) / 0.005)));
    }
    c /= 4.0;
    c = 1.17 - pow(c, 1.4);
    float v = pow(abs(c), 4.0 + u_pa.z * 8.0);
    return vec3(clamp(v, 0.0, 1.0));
  }
  if (id == 9) { // dapple: speed, density
    float tt = t * (0.1 + u_pa.x * 1.5);
    float d = dots(q * 1.2 + vec2(noise(vec2(tt * 0.3, 2.0)) * 0.1, 0.0), u_seed, tt, 0.25 + u_pa.y * 0.7);
    return vec3(d);
  }
  if (id == 10) { // film-grain: amount, size
    float px = mix(1.0, 4.0, u_pa.y);
    vec2 cell = floor(p * u_res / px);
    float h = hash(cell + floor(t * 24.0) * 1.37);
    return vec3(1.0 - u_pa.x * h);
  }
  // haze: amount, drift
  float n = fbm(q * 1.4 + vec2(t * (0.005 + u_pa.y * 0.05), t * 0.002));
  return vec3(1.0 - u_pa.x * (1.0 - n));
}

// ── gradient ────────────────────────────────────────────────────────────────

vec3 gradientAt(float f) {
  f = clamp(f, 0.0, 1.0);
  vec3 c = u_stopColor[0];
  for (int i = 1; i < 8; i++) {
    if (i >= u_stopN) break;
    float a = u_stopPos[i - 1], b = u_stopPos[i];
    if (f >= a) c = mix(u_stopColor[i - 1], u_stopColor[i], clamp((f - a) / max(b - a, 1e-5), 0.0, 1.0));
  }
  return c;
}

void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y); // scene position 0..1, y down
  float aspect = u_res.x / u_res.y;
  vec2 q = (p - 0.5 - u_offset) * vec2(aspect, 1.0);
  q = rot(-u_angle) * q / max(u_scale, 0.01);
  vec4 outc = vec4(0.0);

  if (u_kind == 0 || u_kind == 1) {
    vec3 m3 = u_kind == 0 ? vec3(gobo(u_ref, q)) : procedural(u_ref, q, p);
    if (u_blend == 1) outc = vec4(m3 * u_opacity, u_opacity);
    else outc = vec4(u_light * m3 * u_opacity, max(m3.r, max(m3.g, m3.b)) * u_opacity);
  } else if (u_kind == 2) {
    vec2 P = (p - 0.5) * u_res;
    float dt = u_clock * 0.035 * (0.2 + u_gDrift);
    vec2 warp = vec2(noise(p * 1.6 + vec2(dt, -dt * 0.7)), noise(p * 1.6 + vec2(-dt * 0.8, dt) + 5.3)) - 0.5;
    P += warp * u_gDrift * 0.9 * u_res.y;
    vec2 dir = vec2(sin(u_gAngle), -cos(u_gAngle));
    float L = abs(u_res.x * sin(u_gAngle)) + abs(u_res.y * cos(u_gAngle));
    float f = dot(P, dir) / max(L, 1.0) + 0.5;
    vec3 c = gradientAt(f) * u_gBright;
    float g = hash(floor(gl_FragCoord.xy) + fract(floor(u_clock * 24.0) * 0.618) * 97.0) - 0.5;
    c += g * u_gGrain * 0.22;
    outc = vec4(clamp(c, 0.0, 1.0) * u_opacity, u_opacity);
  } else if (u_kind == 3) {
    // cover-fit with a slow ken-burns drift; a motion moves the picture (it can leave the frame)
    vec2 mp = (p - 0.5 - u_pMove) / max(u_pScale, 0.05) + 0.5;
    float ta = u_texSize.x / max(u_texSize.y, 1.0);
    vec2 uv = mp - 0.5;
    if (ta > aspect) uv.x *= aspect / ta; else uv.y *= ta / aspect;
    float dt = u_clock * 0.02;
    float zoom = 1.0 + u_pDrift * (0.06 + 0.04 * sin(dt * 0.9));
    uv /= zoom;
    uv += u_pDrift * 0.03 * vec2(sin(dt), cos(dt * 0.7));
    vec3 c = texture(u_tex, uv + 0.5).rgb;
    c *= u_pBright * 1.4;
    c *= vec3(1.0 + 0.22 * u_pWarm, 1.0 + 0.04 * u_pWarm, 1.0 - 0.22 * u_pWarm);
    float inPic = step(0.0, mp.x) * step(mp.x, 1.0) * step(0.0, mp.y) * step(mp.y, 1.0);
    outc = vec4(clamp(c, 0.0, 1.0) * u_opacity, u_opacity) * inPic;
  } else {
    outc = vec4(u_solid * u_opacity, u_opacity);
  }
  o_color = outc;
}
`
