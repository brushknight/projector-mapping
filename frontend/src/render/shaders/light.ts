/**
 * The light model (protocol §15): a light lights the whole frame, attachments (gobos) block it.
 *
 *   COLOR_FS   the colour layer: the light's own colour, a gradient or an animated colour generator
 *   MASK_FS    one attachment's pass (1 = light passes), multiplied into the mask target
 *   LIGHT_FS   colour × blurred mask, with lens fringe, vignette, dust and haze, slid inside the frame
 *
 * Attachment space: frame position p (0..1, y down) → wall space w = (p − 0.5 − offset) × (aspect, 1), frame height = 1.
 * Throw and keystone unwarp w (the projection onto the wall), then the gobo's rotation and scale give its own space q,
 * where a window is about 0.6 high at scale 1.
 */
import { generatorsGlsl } from '../generators'
import { FULLSCREEN_VS, HEADER, NOISE } from './common'

export const LIGHT_VS = FULLSCREEN_VS

/** Shape families, by catalog gobo id. The engine maps each gobo's params onto u_gp0..u_gp2 (render/attachments.ts). */
export const SHAPE = {
  sash: 0, arch: 1, gothic: 2, porthole: 3, frenchDoors: 4, skylight: 5, barn: 6,
  venetian: 7, vertical: 8, shutters: 9,
  leaves: 10, palm: 11, branch: 12, ivy: 13, bamboo: 14,
  dots: 15, lattice: 16, moroccan: 17, honeycomb: 18, stripes: 19, grid: 20, stars: 21, water: 22,
  spot: 23, framing: 24, iris: 25,
} as const

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
// old glass: each pane a little brighter or darker, with a faint ripple
float glassTone(vec2 q, vec2 cell) {
  return 1.0 - 0.025 * noise(q * 9.0 + cell * 7.1) - 0.035 * hash(cell + u_seed);
}

// 0 sash window: cols × rows panes, a heavier meeting rail when rows is even
float shapeSash(vec2 q) {
  float cols = u_gp0.x, rows = u_gp0.y, mb = u_gp0.z;
  vec2 h = vec2(0.13 * cols + 0.02, 0.105 * rows + 0.02);
  h = min(h, vec2(0.5, 0.48));
  float open = inside(sdBox(q, h - mb * 0.6));
  float bars = min(gridDist(q.x, h.x, cols), gridDist(q.y, h.y, rows)) - mb * 0.5;
  if (mod(rows, 2.0) < 0.5) bars = min(bars, abs(q.y) - mb * 0.95);
  bars = min(bars, h.y - q.y - mb * 1.4); // the bottom rail
  vec2 cell = floor((q + h) / (2.0 * h) * vec2(cols, rows));
  return open * inside(-bars) * glassTone(q, cell);
}

// 1 arched window: a round head with a fan of glazing bars
float shapeArch(vec2 q) {
  float cols = u_gp0.x, rows = u_gp0.y, mb = u_gp0.z;
  float w = 0.25, yc = -0.12, bottom = 0.42;
  float dRect = sdBox(q - vec2(0.0, (yc + bottom) * 0.5), vec2(w, (bottom - yc) * 0.5));
  float dTop = max(length(q - vec2(0.0, yc)) - w, q.y - yc);
  float open = inside(min(dRect, dTop) + mb * 0.6);
  float bars = gridDist(q.x, w, cols);
  float span = bottom - yc;
  if (q.y > yc) {
    float c = (q.y - yc) / span * rows;
    bars = min(bars, (0.5 - abs(fract(c) - 0.5)) * span / rows);
  } else {
    vec2 a = q - vec2(0.0, yc);
    float ang = atan(a.x, -a.y);
    float nearest = floor(ang / (PI / 4.0) + 0.5) * (PI / 4.0);
    bars = min(bars, length(a) * abs(sin(ang - nearest)));
    bars = min(bars, abs(length(a) - 0.55 * w));
    bars = min(bars, abs(q.y - yc));
  }
  vec2 cell = floor(vec2((q.x + w) / (2.0 * w) * cols, (q.y - yc) / span * rows));
  return open * inside(-(bars - mb * 0.5)) * glassTone(q, cell);
}

// 2 church window: a pointed lancet with tracery, an oculus and leaded diamond quarries
float shapeGothic(vec2 q) {
  float mb = u_gp0.x;
  float w = 0.21, yc = -0.04, bottom = 0.47;
  float R = 2.0 * w;
  float dHead = max(max(length(q - vec2(w, yc)) - R, length(q - vec2(-w, yc)) - R), q.y - yc);
  float dBody = sdBox(q - vec2(0.0, (yc + bottom) * 0.5), vec2(w, (bottom - yc) * 0.5));
  float open = inside(min(dHead, dBody) + mb * 0.7);
  float subApex = yc - 0.866 * w;
  float tr = 1e3;
  // centre mullion up to the two sub-lancets
  if (q.y > subApex) tr = min(tr, abs(q.x));
  // two sub-lancets
  float dl = max(max(length(q - vec2(0.0, yc)) - w, length(q - vec2(-w, yc)) - w), q.y - yc);
  float dr = max(max(length(q - vec2(0.0, yc)) - w, length(q - vec2(w, yc)) - w), q.y - yc);
  if (q.y < yc) tr = min(tr, min(abs(dl), abs(dr)));
  // the oculus with a quatrefoil
  vec2 oc = vec2(0.0, yc - 1.25 * w);
  float ro = 0.34 * w;
  tr = min(tr, abs(length(q - oc) - ro));
  float qf = 1e3;
  for (int i = 0; i < 4; i++) {
    float a = float(i) * PI * 0.5;
    qf = min(qf, length(q - oc - 0.15 * w * vec2(cos(a), sin(a))) - 0.15 * w);
  }
  tr = min(tr, abs(qf));
  // horizontal saddle bars in the body
  if (q.y > yc) tr = min(tr, (0.5 - abs(fract((q.y - yc) / 0.13) - 0.5)) * 0.13 + mb * 0.25);
  float bars = tr - mb * 0.45;
  // lead came: thin diamond quarries
  vec2 dq = vec2(q.x + q.y * 0.6, q.x - q.y * 0.6) * 16.0;
  float lead = min(0.5 - abs(fract(dq.x) - 0.5), 0.5 - abs(fract(dq.y) - 0.5)) / 16.0 - mb * 0.07;
  vec2 cell = floor(dq);
  return open * inside(-bars) * inside(-lead) * (1.0 - 0.1 * hash(cell + u_seed));
}

// 3 porthole: a round window with a thick rim and optional bars
float shapePorthole(vec2 q) {
  float mb = u_gp0.x, n = u_gp0.y;
  float r = length(q);
  float open = inside(r - 0.27);
  float bars = 1e3;
  if (n > 0.5) {
    float ang = atan(q.y, q.x);
    float step_ = 2.0 * PI / n;
    float nearest = floor(ang / step_ + 0.5) * step_;
    bars = r * abs(sin(ang - nearest)) - mb * 0.5;
  }
  float lens = 0.88 + 0.12 * (1.0 - r * r / 0.073);
  return open * inside(-bars) * lens;
}

// 4 french doors: two glazed doors with a heavy centre stile and solid kick panels
float shapeFrenchDoors(vec2 q) {
  float cols = max(2.0, u_gp0.x), rows = u_gp0.y, mb = u_gp0.z;
  vec2 h = vec2(0.36, 0.47);
  float open = inside(sdBox(q, h - mb * 0.7));
  float perDoor = max(1.0, floor(cols * 0.5 + 0.5));
  float kick = h.y - 0.2;
  float x = q.x < 0.0 ? q.x + h.x * 0.5 : q.x - h.x * 0.5; // each door's own centre
  float hy = (kick + h.y) * 0.5;
  float yy = q.y - (kick - h.y) * 0.5;
  float bars = min(gridDist(x, h.x * 0.5, perDoor), gridDist(yy, hy, rows)) - mb * 0.5;
  bars = min(bars, abs(q.x) - mb * 1.25);
  float panel = inside(q.y - kick + mb * 0.5);
  vec2 cell = floor(vec2((q.x + h.x) / (2.0 * h.x) * perDoor * 2.0, (yy + hy) / (2.0 * hy) * rows));
  return open * panel * inside(-bars) * glassTone(q, cell);
}

// 5 skylight: a roof window seen from below, slightly in perspective, with a deep frame
float shapeSkylight(vec2 q) {
  float cols = u_gp0.x, rows = u_gp0.y, mb = u_gp0.z;
  q.x *= 1.0 + 0.32 * (q.y + 0.3);
  vec2 h = vec2(0.32, 0.3);
  float open = inside(sdBox(q, h - mb * 1.4));
  float bars = min(gridDist(q.x, h.x, cols), gridDist(q.y, h.y, rows)) - mb * 0.5;
  vec2 cell = floor((q + h) / (2.0 * h) * vec2(cols, rows));
  return open * inside(-bars) * glassTone(q, cell);
}

// 6 barn window: rough wood, a cross brace and a centre bar
float shapeBarn(vec2 q) {
  float mb = u_gp0.x;
  q += (vec2(noise(q * 38.0 + 3.0), noise(q * 38.0 + 9.0)) - 0.5) * 0.006;
  vec2 h = vec2(0.3, 0.3);
  float open = inside(sdBox(q, h - mb * 1.2));
  float x = min(abs(q.x - q.y), abs(q.x + q.y)) * 0.7071;
  float bars = x - mb * 0.7;
  return open * inside(-bars) * (0.94 + 0.06 * noise(q * 9.0));
}

// 7 venetian blinds: slats with gaps set by the opening, bowed, each a little different, ladder strings
float shapeVenetian(vec2 q) {
  float n = u_gp0.x, tilt = u_gp0.y;
  vec2 h = vec2(0.46, 0.4);
  float box = inside(sdBox(q, h));
  float head = inside(-(q.y + h.y - 0.035));
  float P = 2.0 * h.y / n;
  float yy = q.y + h.y + 0.0035 * (q.x / h.x) * (q.x / h.x);
  float idx = floor(yy / P);
  float s = fract(yy / P);
  float gap = clamp((0.05 + tilt * 0.75) * (0.86 + 0.28 * hash(vec2(idx, u_seed))), 0.0, 0.97);
  // the light through a gap is brighter at the bottom: the slat below bounces it
  float d = (s - (1.0 - gap)) * P;
  float pass = inside(-d) * (0.72 + 0.28 * clamp((s - (1.0 - gap)) / max(gap, 1e-3), 0.0, 1.0));
  float ladder = min(abs(q.x - 0.55 * h.x), abs(q.x + 0.55 * h.x)) - 0.0018;
  return box * head * pass * inside(-ladder);
}

// 8 vertical blinds: louvres, a headrail and the bottom chain
float shapeVertical(vec2 q) {
  float n = u_gp0.x, tilt = u_gp0.y;
  vec2 h = vec2(0.48, 0.42);
  float box = inside(sdBox(q, h));
  float head = inside(-(q.y + h.y - 0.04));
  float P = 2.0 * h.x / n;
  float xx = q.x + h.x;
  float idx = floor(xx / P);
  float s = fract(xx / P);
  float gap = clamp((0.04 + tilt * 0.7) * (0.9 + 0.2 * hash(vec2(idx, u_seed))), 0.0, 0.97);
  float d = (s - (1.0 - gap)) * P;
  float pass = inside(-d) * (0.75 + 0.25 * clamp((s - (1.0 - gap)) / max(gap, 1e-3), 0.0, 1.0));
  float chainY = abs(q.y - (h.y - 0.035)) - 0.0022;
  // the bottom chain: a dotted line of links
  float chain = 1.0 - inside(chainY) * step(0.45, fract(q.x * 140.0));
  return box * head * pass * chain;
}

// 9 plantation shutters: framed panels of louvres with a tilt rod and a divider rail
float shapeShutters(vec2 q) {
  float n = u_gp0.x, panels = max(1.0, u_gp0.y), tilt = u_gp0.z;
  float mb = 0.022;
  vec2 h = vec2(0.44, 0.42);
  float box = inside(sdBox(q, h - 0.012));
  float stiles = gridDist(q.x, h.x, panels) - mb * 0.6;
  float rails = min(abs(q.y) - mb * 0.8, h.y - abs(q.y) - mb * 1.2);
  float frame = min(stiles, rails);
  float P = 2.0 * h.y / n;
  float yy = q.y + h.y;
  float s = fract(yy / P);
  float gap = clamp(0.05 + tilt * 0.62, 0.0, 0.95);
  float d = (s - (1.0 - gap)) * P;
  float pass = inside(-d) * (0.7 + 0.3 * clamp((s - (1.0 - gap)) / max(gap, 1e-3), 0.0, 1.0));
  float pw = 2.0 * h.x / panels;
  float px = mod(q.x + h.x, pw) - pw * 0.5;
  float rod = abs(px) - 0.0035;
  return box * inside(-frame) * pass * inside(-rod);
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

// 12 one bare branch across the frame, with sub-branches and twigs
float shapeBranch(vec2 q) {
  float density = u_gp0.x, seed = u_gp0.y;
  float d = 1e3;
  vec2 a = vec2(-1.0, 0.2);
  vec2 dir = normalize(vec2(1.0, -0.35));
  float th = 0.034;
  for (int i = 0; i < 10; i++) {
    float fi = float(i);
    float t0 = th * (1.0 - fi / 12.0);
    vec2 b = a + dir * 0.2;
    d = min(d, sdSeg(q, a, b) - t0);
    for (int sb = 0; sb < 2; sb++) {
      float fs = float(sb);
      if (hash(vec2(fi * 2.0 + fs, seed + 1.0)) > 0.25 + density * 0.7) continue;
      float side = sb == 0 ? -1.0 : 1.0;
      vec2 sd = normalize(dir + side * vec2(-dir.y, dir.x) * (0.5 + 0.7 * hash(vec2(fi, seed + 3.0 + fs))));
      vec2 s0 = mix(a, b, 0.3 + 0.4 * hash(vec2(fi, fs + seed)));
      float sl = 0.1 + 0.08 * hash(vec2(fi + fs, seed + 9.0));
      for (int j = 0; j < 4; j++) {
        float fj = float(j);
        vec2 s1 = s0 + sd * sl * (1.0 - fj * 0.18);
        d = min(d, sdSeg(q, s0, s1) - t0 * 0.5 * (1.0 - fj / 4.5));
        for (int tw = 0; tw < 2; tw++) {
          float ft = float(tw);
          if (hash(vec2(fi * 7.0 + fj * 3.0 + ft, seed + 4.0 + fs)) > density + 0.2) continue;
          float ts = tw == 0 ? -0.8 : 0.85;
          vec2 tp = mix(s0, s1, 0.5 + 0.4 * ft);
          vec2 te = tp + rot(ts) * sd * (0.05 + 0.04 * hash(vec2(fj, fi + ft)));
          d = min(d, sdSeg(q, tp, te) - 0.0028);
        }
        s0 = s1;
        sd = normalize(sd + (hash2(vec2(fi + fs * 5.0, fj) + seed) - 0.5) * 0.6);
      }
    }
    a = b;
    dir = normalize(dir + (hash2(vec2(fi, seed)) - 0.5) * 0.45);
  }
  float bark = 0.9 + 0.1 * noise(q * 60.0);
  return 1.0 - 0.95 * inside(d) * bark;
}

// 13 ivy hanging from the top: wavy strands with three-lobed leaves and a dense mat above
float shapeIvy(vec2 q) {
  float density = u_gp0.x, seed = u_gp0.y;
  float cover = 0.0;
  float cw = mix(0.12, 0.06, density);
  float ci = floor(q.x / cw);
  for (int k = -1; k <= 1; k++) {
    float cx = ci + float(k);
    vec2 hh = hash2(vec2(cx, seed));
    float x0 = (cx + 0.2 + 0.6 * hh.x) * cw;
    float len = mix(0.25, 1.05, hash(vec2(cx, seed + 3.0)));
    float top = -0.62;
    if (q.y < top || q.y > top + len) continue;
    float sx = x0 + 0.018 * sin(q.y * 14.0 + hh.y * 6.28);
    cover = max(cover, inside(abs(q.x - sx) - 0.0025));
    float step_ = 0.042;
    float yi = floor((q.y - top) / step_);
    for (int m = -1; m <= 1; m++) {
      float yc = top + (yi + float(m) + 0.5) * step_;
      if (yc > top + len) continue;
      float side = mod(yi + float(m), 2.0) < 0.5 ? -1.0 : 1.0;
      float lx = x0 + 0.018 * sin(yc * 14.0 + hh.y * 6.28) + side * 0.02;
      vec2 lp = rot(side * 0.6 + (hash(vec2(yi + float(m), cx)) - 0.5)) * (q - vec2(lx, yc));
      float sz = 0.016 * (1.15 - 0.4 * (yc - top) / len);
      float leaf = min(length(lp - vec2(0.0, -0.6 * sz)) - sz, min(length(lp - vec2(-0.75 * sz, 0.25 * sz)) - 0.75 * sz, length(lp - vec2(0.75 * sz, 0.25 * sz)) - 0.75 * sz));
      cover = max(cover, inside(leaf));
    }
  }
  float mat = smoothstep(-0.38, -0.56, q.y + 0.08 * (fbm(vec2(q.x * 5.0, seed)) - 0.5)) * smoothstep(0.35, 0.55, fbm(q * 9.0 + seed));
  cover = max(cover, mat);
  return 1.0 - 0.94 * clamp(cover, 0.0, 1.0);
}

// 14 bamboo: slightly leaning stalks with nodes and slim drooping leaves
float shapeBamboo(vec2 q) {
  float density = u_gp0.x, seed = u_gp0.y;
  float cover = 0.0;
  float cw = mix(0.26, 0.12, density);
  float ci = floor(q.x / cw);
  for (int k = -1; k <= 1; k++) {
    float cx = ci + float(k);
    vec2 hh = hash2(vec2(cx, seed + 7.0));
    float x0 = (cx + 0.25 + 0.5 * hh.x) * cw;
    float lean = (hh.y - 0.5) * 0.12;
    float sx = x0 + lean * q.y;
    float wdt = 0.009 + 0.008 * hash(vec2(cx, seed));
    float stalk = abs(q.x - sx) - wdt;
    float node = abs(fract((q.y + hh.x) / 0.17) - 0.5);
    stalk -= 0.0025 * smoothstep(0.47, 0.5, node);
    cover = max(cover, inside(stalk));
    float ny = floor((q.y + hh.x) / 0.17);
    for (int m = 0; m <= 1; m++) {
      float nn = ny + float(m);
      if (hash(vec2(nn, cx + seed)) > 0.55 + 0.3 * density || q.y > 0.15 + 0.3 * density) continue;
      vec2 np = vec2(x0 + lean * (nn * 0.17 - hh.x), nn * 0.17 - hh.x);
      for (int l = 0; l < 3; l++) {
        float fl = float(l);
        float ang = (hash(vec2(nn, fl + cx)) - 0.5) * 2.4 + (fl - 1.0) * 0.9 + PI * 0.5;
        vec2 dir = vec2(cos(ang), sin(ang));
        dir = normalize(dir + vec2(0.0, 0.5));
        vec2 lp = q - np - dir * 0.1;
        lp = vec2(dot(lp, vec2(dir.y, -dir.x)), dot(lp, dir));
        cover = max(cover, inside(sdVesica(lp, 0.11, 0.1)));
      }
    }
  }
  return 1.0 - 0.94 * clamp(cover, 0.0, 1.0);
}

// 15 dappled dots
float shapeDots(vec2 q) {
  float density = u_gp0.x, size = u_gp0.y, seed = u_gp0.z;
  vec2 p = q * 6.0;
  vec2 i = floor(p);
  float best = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 cell = i + vec2(float(x), float(y));
    vec2 h = hash2(cell + seed);
    if (h.x > density) continue;
    vec2 c = cell + 0.5 + 0.35 * vec2(sin(h.x * 6.28), cos(h.y * 6.28));
    float r = (0.12 + 0.3 * h.y) * (0.5 + size);
    float w = max(length(fwidth(p)), 1e-4);
    best = max(best, (1.0 - smoothstep(-w, w, length(p - c) - r)) * (0.75 + 0.25 * h.y));
  }
  return best;
}

// 16 diamond trellis of wooden laths
float shapeLattice(vec2 q) {
  float cells = u_gp0.x, mb = u_gp0.y;
  vec2 p = rot(0.7854) * q * cells;
  vec2 f = 0.5 - abs(fract(p) - 0.5);
  float d = min(f.x, f.y) / cells - mb * 0.5;
  return inside(-d) * (0.93 + 0.07 * noise(q * 20.0));
}

// 17 moroccan screen: quatrefoils at the cells, four point stars at the corners
float shapeMoroccan(vec2 q) {
  float cells = u_gp0.x, mb = u_gp0.y;
  vec2 p = q * cells;
  vec2 c = fract(p) - 0.5;
  float qf = 1e3;
  for (int i = 0; i < 4; i++) {
    float a = float(i) * PI * 0.5;
    qf = min(qf, length(c - 0.16 * vec2(cos(a), sin(a))) - 0.17);
  }
  qf = min(qf, length(c) - 0.2);
  vec2 k = fract(p + 0.5) - 0.5;
  float star = (abs(k.x) + abs(k.y)) - 0.1 - 0.04 * (1.0 - min(abs(k.x), abs(k.y)) * 6.0);
  float open = min(qf, star) + mb * 0.18;
  return inside(open / cells);
}

// 18 honeycomb: hexagonal cells
float shapeHoneycomb(vec2 q) {
  float cells = u_gp0.x, mb = u_gp0.y;
  vec2 p = q * cells;
  const vec2 s = vec2(1.0, 1.7320508);
  vec4 hc = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
  vec4 h = vec4(p - hc.xy * s, p - (hc.zw + 0.5) * s);
  vec2 g = dot(h.xy, h.xy) < dot(h.zw, h.zw) ? h.xy : h.zw;
  vec2 a = abs(g);
  float edge = 0.5 - max(dot(a, s * 0.5), a.x);
  return inside(-(edge / cells - mb * 0.5));
}

// 19 stripes: parallel bars
float shapeStripes(vec2 q) {
  float n = u_gp0.x, w = u_gp0.y;
  float P = 1.8 / n;
  float s = fract((q.x + 0.9) / P);
  return inside((abs(s - 0.5) - w * 0.5) * P);
}

// 20 grid: a steel warehouse window
float shapeGrid(vec2 q) {
  float cells = u_gp0.x, mb = u_gp0.y;
  vec2 h = vec2(0.46, 0.36);
  float open = inside(sdBox(q, h - mb * 0.8));
  float n = cells;
  float rows = max(1.0, floor(n * h.y / h.x + 0.5));
  float bars = min(gridDist(q.x, h.x, n), gridDist(q.y, h.y, rows)) - mb * 0.5;
  vec2 cell = floor((q + h) / (2.0 * h) * vec2(n, rows));
  float frosted = 1.0 - 0.18 * step(0.82, hash(cell + u_seed));
  return open * inside(-bars) * frosted * glassTone(q, cell);
}

// 21 star field: pin holes of different sizes
float shapeStars(vec2 q) {
  float density = u_gp0.x, size = u_gp0.y, seed = u_gp0.z;
  float sc = mix(14.0, 34.0, density);
  vec2 p = q * sc;
  vec2 i = floor(p);
  float v = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 cell = i + vec2(float(x), float(y));
    vec2 h = hash2(cell + seed * 1.3);
    if (h.x > 0.35 + density * 0.5) continue;
    vec2 c = cell + 0.2 + 0.6 * h;
    float big = step(0.93, hash(cell * 1.7 + seed));
    float r = (0.035 + 0.05 * h.y + big * 0.06) * (0.4 + size * 1.6);
    float d = length(p - c);
    v = max(v, (1.0 - smoothstep(r * 0.6, r, d)) * (0.45 + 0.55 * h.y + big * 0.4));
  }
  return clamp(v, 0.0, 1.0);
}

// 22 water ripple: a frozen caustic network
float shapeWater(vec2 q) {
  float sc = u_gp0.x, sharp = u_gp0.y, seed = u_gp0.z;
  vec2 cp = mod(q * (0.7 + sc * 1.6) * 6.28318, 6.28318) - 250.0;
  float tt = 23.0 + seed * 1.7;
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
  float v = pow(abs(c), 3.0 + sharp * 9.0);
  return clamp(0.22 + 0.9 * v, 0.0, 1.0);
}

// 23 round or oval spot with an adjustable edge, a faint lens ring
float shapeSpot(vec2 q) {
  float edge = u_gp0.x, aspect = u_gp0.y;
  vec2 e = vec2(q.x, q.y / max(aspect, 0.05));
  float r = length(e);
  float R = 0.36;
  float w = 0.004 + edge * 0.16;
  float beam = 1.0 - smoothstep(R - w, R + w * 0.25, r);
  float ring = 1.0 - 0.05 * smoothstep(0.08, 0.0, abs(r - R * 0.86));
  return beam * ring * (0.94 + 0.06 * (1.0 - r / R));
}

// 24 framing shutters: the beam cut by four blades, each pushed in and angled
float blade(vec2 q, float ang, float into, vec2 n) {
  // n: the blade's direction from the centre (up, down, left, right); into: 0..0.95 of the radius
  vec2 qq = rot(-ang) * q;
  float R = 0.4;
  float edge = R - into * R;
  float d = dot(qq, n) - edge;
  return 1.0 - smoothstep(-0.003, 0.006, d);
}
float shapeFraming(vec2 q) {
  float R = 0.4;
  float r = length(q);
  float beam = 1.0 - smoothstep(R - 0.006, R + 0.004, r);
  float a = PI / 180.0;
  float pass = beam;
  pass *= blade(q, u_gp1.x * a, u_gp0.x, vec2(0.0, -1.0));
  pass *= blade(q, u_gp1.y * a, u_gp0.y, vec2(0.0, 1.0));
  pass *= blade(q, u_gp1.z * a, u_gp0.z, vec2(-1.0, 0.0));
  pass *= blade(q, u_gp1.w * a, u_gp0.w, vec2(1.0, 0.0));
  return pass * (0.94 + 0.06 * (1.0 - r / R));
}

// 25 iris: the beam closed down by twelve leaves
float shapeIris(vec2 q) {
  float iris = u_gp0.x, edge = u_gp0.y;
  float R = 0.4 * clamp(iris, 0.03, 1.0);
  float n = 12.0;
  float ang = atan(q.y, q.x) + 0.13;
  float seg = 2.0 * PI / n;
  float k = cos(PI / n) / cos(mod(ang, seg) - seg * 0.5);
  float rr = R * mix(k, 1.0, smoothstep(0.2, 1.0, iris));
  float w = 0.003 + edge * 0.12;
  float r = length(q);
  return (1.0 - smoothstep(rr - w, rr + w * 0.25, r)) * (0.94 + 0.06 * (1.0 - r / max(R, 1e-3)));
}

float goboShape(int s, vec2 q) {
  if (s == 0) return shapeSash(q);
  if (s == 1) return shapeArch(q);
  if (s == 2) return shapeGothic(q);
  if (s == 3) return shapePorthole(q);
  if (s == 4) return shapeFrenchDoors(q);
  if (s == 5) return shapeSkylight(q);
  if (s == 6) return shapeBarn(q);
  if (s == 7) return shapeVenetian(q);
  if (s == 8) return shapeVertical(q);
  if (s == 9) return shapeShutters(q);
  if (s == 10) return shapeLeaves(q);
  if (s == 11) return shapePalm(q);
  if (s == 12) return shapeBranch(q);
  if (s == 13) return shapeIvy(q);
  if (s == 14) return shapeBamboo(q);
  if (s == 15) return shapeDots(q);
  if (s == 16) return shapeLattice(q);
  if (s == 17) return shapeMoroccan(q);
  if (s == 18) return shapeHoneycomb(q);
  if (s == 19) return shapeStripes(q);
  if (s == 20) return shapeGrid(q);
  if (s == 21) return shapeStars(q);
  if (s == 22) return shapeWater(q);
  if (s == 23) return shapeSpot(q);
  if (s == 24) return shapeFraming(q);
  return shapeIris(q);
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
uniform sampler2D u_scatter;  // the mask blurred wide, for haze
uniform sampler2D u_color;    // the colour layer
uniform vec2 u_res;
uniform vec2 u_slide;         // frame fractions
uniform float u_slideSoft;    // frame fractions: the slid image's edge softness
uniform vec3 u_gain;          // intensity × fx gain × fx tint
uniform float u_fringe;
uniform float u_vignette;
uniform float u_haze;
uniform float u_clock;
uniform float u_seed;
uniform float u_opacity;
${NOISE}

void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y);
  vec2 s = p - u_slide;
  float aspect = u_res.x / u_res.y;
  float sw = max(u_slideSoft, 1.0 / u_res.y);
  float inFrame = smoothstep(-sw, sw, s.x) * smoothstep(-sw, sw, 1.0 - s.x) * smoothstep(-sw, sw, s.y) * smoothstep(-sw, sw, 1.0 - s.y);
  if (inFrame <= 0.0) { o_color = vec4(0.0, 0.0, 0.0, u_opacity); return; }
  vec2 tuv = vec2(s.x, 1.0 - s.y);
  // lateral colour: red lands a touch further out than blue, most at the frame edges
  vec2 d = tuv - 0.5;
  float k = u_fringe * 0.0065;
  vec3 m;
  m.r = texture(u_mask, 0.5 + d * (1.0 + k)).r;
  m.g = texture(u_mask, tuv).g;
  m.b = texture(u_mask, 0.5 + d * (1.0 - k)).b;
  // longitudinal colour: at soft edges the blue focuses a little differently
  vec3 wide = texture(u_scatter, tuv).rgb;
  m.b = mix(m.b, mix(m.b, wide.b, 0.25), u_fringe * 0.35);
  vec3 col = texture(u_color, tuv).rgb;
  // the beam's falloff (roughly cos^4 away from the axis)
  vec2 vq = (s - 0.5) * vec2(aspect, 1.0);
  float r = length(vq) / (0.5 * length(vec2(aspect, 1.0)));
  float c4 = pow(cos(atan(r * 1.05)), 4.0);
  float vig = mix(1.0, c4, u_vignette);
  // dust and haze: blotches on the lens, fine grain in the air, and light scattered around bright areas
  float dust = 1.0;
  float glow = 0.0;
  if (u_haze > 0.001) {
    float blot = fbm(vq * 4.0 + u_seed * 3.1);
    float grain = fbm(vq * 26.0 + vec2(u_clock * 0.015, -u_clock * 0.01));
    // a few soft motes of dust on the lens, out of focus
    vec2 mc = vq * 26.0;
    vec2 mi = floor(mc);
    vec2 mh = hash2(mi + floor(u_seed * 10.0));
    float speck = step(0.8, mh.x) * smoothstep(0.32, 0.05, length(fract(mc) - 0.25 - 0.5 * mh));
    dust = 1.0 - u_haze * (0.28 * smoothstep(0.35, 0.8, blot) + 0.16 * grain + 0.18 * speck);
    glow = u_haze * 0.16 * max(max(wide.r, wide.g), wide.b);
  }
  vec3 light = col * u_gain * (m * vig * dust + glow * vig) * inFrame;
  o_color = vec4(light * u_opacity, u_opacity);
}
`
