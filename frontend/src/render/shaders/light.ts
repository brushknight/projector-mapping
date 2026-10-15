/**
 * The light model (protocol §15): a light lights the whole frame, attachments (gobos) block it.
 *
 *   COLOR_FS   the colour layer: the light's own colour, a gradient or an animated colour generator
 *   MASK_FS    one attachment's pass (1 = light passes), multiplied into the mask target
 *   LIGHT_FS   colour × blurred mask, with lens fringe and vignette, slid inside the frame
 *
 * Attachment space: frame position p (0..1, y down) → wall space w = (p − 0.5 − offset) × (aspect, 1), frame height = 1.
 * Throw and keystone unwarp w (the projection onto the wall), then the gobo's rotation and scale give its own space q,
 * where a window is about 0.6 high at scale 1.
 */
import { generatorsGlsl } from '../generators'
import { FULLSCREEN_VS, HEADER, NOISE } from './common'

export const LIGHT_VS = FULLSCREEN_VS

/**
 * Shape families. Since catalog 6 every attachment is a metal plate (its mask texture); the number stays 26 so the
 * mask shader's slots read as before. The engine maps a plate's params onto u_gp0 (render/attachments.ts).
 */
export const SHAPE = {
  plate: 26,
} as const

/** (plates) plate units per gobo unit at scale 1: a plate's round field of radius 0.84 is 0.9 of the frame height. */
export const PLATE_SCALE = 0.54

const KELVIN_GLSL = `
// blackbody colour (Tanner Helland's fit), brightest channel 1
vec3 kelvinRgb(float k) {
  float t = clamp(k, 1000.0, 40000.0) / 100.0;
  float r, g, b;
  if (t <= 66.0) { r = 255.0; g = 99.4708025861 * log(t) - 161.1195681661; }
  else { r = 329.698727446 * pow(t - 60.0, -0.1332047592); g = 288.1221695283 * pow(t - 60.0, -0.0755148492); }
  if (t >= 66.0) b = 255.0; else if (t <= 19.0) b = 0.0; else b = 138.5177312231 * log(t - 10.0) - 305.0447927307;
  vec3 c = clamp(vec3(r, g, b) / 255.0, 0.0, 1.0);
  return c / max(max(c.r, c.g), max(c.b, 1e-4));
}
`

// ── colour layer ──────────────────────────────────────────────────────────────

export const COLOR_FS = `${HEADER}
in vec2 v_uv;
out vec4 o_color;
uniform int u_ckind;          // 0 solid, 1 gradient, 2 generator
uniform vec3 u_solid;
uniform vec2 u_res;
uniform float u_clock;
uniform float u_opacity;
// gradient
uniform vec3 u_stopColor[8];
uniform float u_stopPos[8];
uniform int u_stopN;
uniform float u_gAngle;
uniform float u_gDrift;
uniform float u_gGrain;
uniform float u_gBright;
// generator
uniform int u_gen;
uniform vec4 g_a;
uniform vec4 g_b;
uniform vec3 g_c0;
uniform vec3 g_c1;
uniform vec3 g_c2;
${NOISE}
${KELVIN_GLSL}
${generatorsGlsl()}

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
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y);
  float aspect = u_res.x / u_res.y;
  vec3 c = u_solid;
  if (u_ckind == 1) {
    vec2 P = (p - 0.5) * u_res;
    float dt = u_clock * 0.035 * (0.2 + u_gDrift);
    vec2 warp = vec2(noise(p * 1.6 + vec2(dt, -dt * 0.7)), noise(p * 1.6 + vec2(-dt * 0.8, dt) + 5.3)) - 0.5;
    P += warp * u_gDrift * 0.9 * u_res.y;
    vec2 dir = vec2(sin(u_gAngle), -cos(u_gAngle));
    float L = abs(u_res.x * sin(u_gAngle)) + abs(u_res.y * cos(u_gAngle));
    float f = dot(P, dir) / max(L, 1.0) + 0.5;
    c = gradientAt(f) * u_gBright;
    float g = hash(floor(gl_FragCoord.xy) + fract(floor(u_clock * 24.0) * 0.618) * 97.0) - 0.5;
    c += g * u_gGrain * 0.22;
  } else if (u_ckind == 2) {
    c = generate(u_gen, p, aspect, u_clock);
  }
  o_color = vec4(clamp(c, 0.0, 1.0) * u_opacity, u_opacity);
}
`

// ── attachments ───────────────────────────────────────────────────────────────

export const SHAPES_GLSL = `
const float PI = 3.14159265;
uniform sampler2D u_plate;    // (plates) the bound plate's mask: openings white, plate space -1..1 across the square
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
// 1 inside (d < 0), anti-aliased over a pixel
float inside(float d) { float w = max(fwidth(d), 1e-4) * 0.8; return 1.0 - smoothstep(-w, w, d); }
// distance to the nearest line of a grid of n cells spanning -h..h (the outer edges count)
float gridDist(float x, float h, float n) { float c = (x + h) / (2.0 * h) * n; return (0.5 - abs(fract(c) - 0.5)) * 2.0 * h / n; }
// a pointed leaf (vesica) of half length b along y
float sdVesica(vec2 p, float r, float d) {
  p = abs(p);
  float b = sqrt(max(r * r - d * d, 1e-6));
  return ((p.y - b) * d > p.x * b) ? length(p - vec2(0.0, b)) : length(p - vec2(-d, 0.0)) - r;
}

// 26 metal plate: its rasterized mask. gp0 = (field: 0 round, 1 fill frame, 2 stretch, 3 tile; field radius; frame aspect)
// The mask is coverage (the canvas anti-aliases each edge over about one texel). Minified, mipmaps average it. Magnified
// (one texel over several output pixels), plain linear filtering would smear each edge over the whole texel and show its
// staircase; the edge is re-sharpened to one output pixel instead, using the texel footprint from the derivatives.
float shapePlate(vec2 q) {
  int mode = int(u_gp0.x + 0.5);
  float aspect = max(u_gp0.z, 0.01);
  vec2 u = q / ${PLATE_SCALE.toFixed(4)};
  if (mode == 1) u = q / (0.5 * max(aspect, 1.0));
  else if (mode == 2) u = vec2(q.x / (0.5 * aspect), q.y / 0.5);
  vec2 uv = u * 0.5 + 0.5;
  float v = texture(u_plate, uv).r;
  vec2 tx = fwidth(uv) * vec2(textureSize(u_plate, 0));
  float footprint = clamp(max(tx.x, tx.y), 1e-3, 1.0);
  float pass = clamp(0.5 + (v - 0.5) / footprint, 0.0, 1.0);
  if (mode == 0) pass *= inside(length(u) - u_gp0.y);
  return pass;
}

float goboShape(int s, vec2 q) {
  return shapePlate(q);
}
`

/**
 * Shapes the live layers draw (tree sway, palm sway): the leaf breakup and the palm fronds. They read u_gp0 like the
 * old gobo shapes did (density, size, seed and fronds, seed).
 */
export const LIVE_SHAPES_GLSL = `
const float PI = 3.14159265;
float inside(float d) { float w = max(fwidth(d), 1e-4) * 0.8; return 1.0 - smoothstep(-w, w, d); }
// a pointed leaf (vesica) of half length b along y
float sdVesica(vec2 p, float r, float d) {
  p = abs(p);
  float b = sqrt(max(r * r - d * d, 1e-6));
  return ((p.y - b) * d > p.x * b) ? length(p - vec2(0.0, b)) : length(p - vec2(-d, 0.0)) - r;
}
// 10 leaf breakup: clusters of overlapping pointed leaves at two depths (near ones softer), with branches
float shapeLeaves(vec2 q) {
  float density = u_gp0.x, size = u_gp0.y, seed = u_gp0.z;
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
    // near leaves (the first octave) are out of focus
    float soft = oct == 0 ? 0.16 : w;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 c = li + vec2(float(x), float(y));
      vec2 hh = hash2(c + seed + fo * 3.0);
      float local = smoothstep(thr - 0.1, thr + 0.1, fbm((c + hh) / sc * 0.5 + 4.0 + seed * 3.17 * 0.5));
      if (hh.x > local * (oct == 0 ? 0.18 : oct == 1 ? 0.95 : 0.7) + density * 0.1) continue;
      vec2 d = lp - c - hh;
      d = rot(hh.y * 6.28) * d;
      float r = 0.5 + 0.35 * hash(c * 1.7 + seed);
      float e = sdVesica(d, r, r * 0.6);
      cover = max(cover, (1.0 - smoothstep(-soft, soft, e)) * (oct == 0 ? 0.8 : 1.0));
    }
  }
  cover = max(cover, 0.85 * cluster * smoothstep(0.82, 1.0, density + cl * 0.25) * smoothstep(0.35, 0.65, noise(p * 6.0)));
  float r1 = abs(fbm(p * 0.5 + vec2(2.3, 7.1)) - 0.5);
  float r2 = abs(fbm(p * 1.2 + vec2(9.1, 1.3)) - 0.5);
  float trunk = smoothstep(0.7, -0.6, q.y);
  float br = (1.0 - aastep(0.006 + 0.01 * trunk, r1)) * smoothstep(0.3, 0.55, cl + trunk * 0.25);
  float tw = (1.0 - aastep(0.0045, r2)) * smoothstep(0.35, 0.6, cl);
  cover = max(cover, max(br, tw * 0.9));
  return 1.0 - 0.94 * clamp(cover, 0.0, 1.0);
}

// 11 palm: fronds arching out of a crown above the frame, leaflets angled off each midrib, drooping at the tips
float shapePalm(vec2 q) {
  float fronds = u_gp0.x, seed = u_gp0.y;
  vec2 crown = vec2(0.25, -0.75);
  float cover = 0.0;
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    if (fi >= fronds) break;
    float ang = mix(0.25, 2.9, (fi + 0.5) / fronds) + (hash(vec2(fi, seed)) - 0.5) * 0.35;
    float len = 0.75 + 0.45 * hash(vec2(fi, seed + 1.0));
    vec2 dir = vec2(cos(ang), sin(ang));
    // the midrib: a curve that droops under its weight
    vec2 a = crown;
    float along0 = 0.0;
    for (int k = 0; k < 7; k++) {
      float t1 = float(k + 1) / 7.0;
      vec2 b = crown + dir * len * t1 + vec2(0.0, 0.42 * len * t1 * t1);
      vec2 ba = b - a;
      float sl = length(ba);
      vec2 t = ba / sl;
      vec2 n = vec2(-t.y, t.x);
      vec2 pa = q - a;
      float h = clamp(dot(pa, t) / sl, 0.0, 1.0);
      float side = dot(pa, n);
      float along = (along0 + h * sl) / len;
      float perp = abs(dot(pa - t * h * sl, n));
      float half_ = (0.03 + 0.17 * sin(3.14159 * clamp(along, 0.0, 1.0))) * (1.0 - 0.3 * along);
      if (h > 0.0 && h < 1.0 && perp < half_) {
        // leaflets: narrow blades angled back from the rib, with gaps of sun between them
        float lf = fract((along * len * 26.0) + perp * 26.0 * 0.9 + (side > 0.0 ? 0.37 : 0.0));
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
`

export const MASK_FS = `${HEADER}
in vec2 v_uv;
out vec4 o_color;
uniform vec2 u_res;
uniform int u_shape;
uniform vec2 u_center;     // frame fractions from the frame centre
uniform float u_rot;       // radians
uniform float u_scale;
uniform float u_throw;
uniform float u_skew;
uniform float u_depth;
uniform float u_opacity;
uniform float u_seed;
uniform vec4 u_gp0;
uniform vec4 u_gp1;
uniform vec4 u_gp2;
${NOISE}
${SHAPES_GLSL}

// wall space → the gobo's own space: undo the throw (stretch and perspective) and the keystone, then rotate and scale
vec2 toGobo(vec2 w) {
  float s = 1.0 + 1.1 * u_throw;
  w.y /= s;
  w.x /= max(0.25, 1.0 + 0.7 * u_throw * w.y);
  w.y -= u_skew * 0.55 * w.x;
  w.x /= max(0.25, 1.0 + 0.3 * u_skew * w.x);
  return rot(-u_rot) * w / max(u_scale, 0.01);
}

void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y);
  float aspect = u_res.x / u_res.y;
  vec2 w = (p - 0.5 - u_center) * vec2(aspect, 1.0);
  float pass = goboShape(u_shape, toGobo(w));
  if (u_depth > 0.005) {
    // a deep frame and a large source cast a second, softer edge: the frame's inner face shades a band
    vec2 dir = vec2(0.36, 0.93) * (1.0 + u_throw);
    float off = u_depth * 0.06;
    float far = 0.0;
    for (int i = 0; i < 3; i++) {
      float k = (float(i) + 0.5) / 3.0;
      far += goboShape(u_shape, toGobo(w - dir * off * (0.55 + 0.9 * k)));
    }
    far /= 3.0;
    pass *= 1.0 - 0.5 * min(1.0, u_depth * 3.0) * (1.0 - far);
  }
  pass = clamp(pass, 0.0, 1.0);
  // multiplied into the mask: dst × (pass × o + 1 − o)
  o_color = vec4(vec3(pass) * u_opacity, u_opacity);
}
`

// ── the light ─────────────────────────────────────────────────────────────────

export const LIGHT_FS = `${HEADER}
in vec2 v_uv;
out vec4 o_color;
uniform sampler2D u_mask;     // the focused mask (rgb)
uniform sampler2D u_color;    // the colour layer
uniform vec2 u_res;
uniform vec2 u_slide;         // frame fractions
uniform float u_slideSoft;    // frame fractions: the slid image's edge softness
uniform vec3 u_gain;          // intensity × fx gain × fx tint
uniform float u_fringe;
uniform float u_vignette;
uniform float u_opacity;

void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y);
  vec2 s = p - u_slide;
  float aspect = u_res.x / u_res.y;
  float sw = max(u_slideSoft, 1.0 / u_res.y);
  float inFrame = smoothstep(-sw, sw, s.x) * smoothstep(-sw, sw, 1.0 - s.x) * smoothstep(-sw, sw, s.y) * smoothstep(-sw, sw, 1.0 - s.y);
  if (inFrame <= 0.0) { o_color = vec4(0.0, 0.0, 0.0, u_opacity); return; }
  vec2 tuv = vec2(s.x, 1.0 - s.y);
  // lateral colour: red lands a touch further out than blue, most at the frame edges (samples stay inside the mask)
  vec2 d = tuv - 0.5;
  float k = u_fringe * 0.0065;
  vec3 m;
  m.r = texture(u_mask, clamp(0.5 + d * (1.0 + k), 0.0, 1.0)).r;
  m.g = texture(u_mask, tuv).g;
  m.b = texture(u_mask, clamp(0.5 + d * (1.0 - k), 0.0, 1.0)).b;
  vec3 col = texture(u_color, tuv).rgb;
  // the beam's falloff (roughly cos^4 away from the axis)
  vec2 vq = (s - 0.5) * vec2(aspect, 1.0);
  float r = length(vq) / (0.5 * length(vec2(aspect, 1.0)));
  float c4 = pow(cos(atan(r * 1.05)), 4.0);
  float vig = mix(1.0, c4, u_vignette);
  vec3 light = col * u_gain * clamp(m, 0.0, 1.0) * vig * inFrame;
  o_color = vec4(light * u_opacity, u_opacity);
}
`
