/**
 * Animated colour generators (protocol §15 `colorGenerators`): what colours a light's colour layer or a `generator`
 * backdrop layer. Each one is a GLSL function plus a mapping from its params to uniform slots. To add one:
 *
 *   1. add an entry here (id, glsl, slots),
 *   2. add the same id with its params schema to `colorGenerators` in contract/catalog.json,
 *   3. nothing else: the colour shader is built from this list (docs/effects.md, "Colour generators").
 *
 * The GLSL body defines `vec3 <fn>(vec2 p, float aspect, float t)` where p is the frame position 0..1 (y down),
 * aspect the frame's width / height and t the ambient clock in seconds. It reads its numbers from `g_a` and `g_b`
 * (two vec4) and its colours from `g_c0`, `g_c1`, `g_c2` (linear-ish RGB 0..1), and may use the shared noise
 * helpers (hash, noise, fbm, rot) and `kelvinRgb(k)`. Return RGB 0..1; the light's intensity and fx scale it after.
 */
import type { RGB } from './math/color'
import { hexToRgb } from './math/color'

export interface GeneratorSlots {
  a?: [number, number, number, number]
  b?: [number, number, number, number]
  colors?: RGB[]
}

export interface ColorGenerator {
  id: string
  /** the GLSL function's name (unique) */
  fn: string
  /** GLSL source defining `vec3 <fn>(vec2 p, float aspect, float t)` */
  glsl: string
  /** the generator's params (defaults already filled in) → uniform slots */
  slots(params: Record<string, unknown>): GeneratorSlots
}

const n = (p: Record<string, unknown>, k: string, d: number) => {
  const v = Number(p[k])
  return Number.isFinite(v) ? v : d
}
const c = (p: Record<string, unknown>, k: string, d: string): RGB => hexToRgb(typeof p[k] === 'string' ? (p[k] as string) : d, hexToRgb(d))

export const GENERATORS: ColorGenerator[] = [
  {
    id: 'hue-cycle',
    fn: 'genHueCycle',
    glsl: `
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
vec3 genHueCycle(vec2 p, float aspect, float t) {
  float speed = g_a.x, sat = g_a.y, spread = g_a.z;
  vec2 q = (p - 0.5) * vec2(aspect, 1.0);
  float h = t * (0.004 + speed * 0.06) + spread * 0.35 * (q.x * 0.8 + q.y * 0.5) + 0.04 * fbm(q * 1.5 + t * 0.02);
  return hsv2rgb(vec3(fract(h), sat, 1.0));
}`,
    slots: (p) => ({ a: [n(p, 'speed', 0.2), n(p, 'saturation', 0.75), n(p, 'spread', 0.25), 0] }),
  },
  {
    id: 'color-flow',
    fn: 'genColorFlow',
    glsl: `
vec3 genColorFlow(vec2 p, float aspect, float t) {
  float speed = g_a.x, sc = g_a.y;
  vec2 q = (p - 0.5) * vec2(aspect, 1.0) * (0.6 + sc * 2.2);
  float tt = t * (0.01 + speed * 0.12);
  vec2 w = vec2(fbm(q + vec2(tt, -tt * 0.7)), fbm(q + vec2(-tt * 0.6, tt) + 7.3));
  float f = fbm(q + 1.6 * w + tt * 0.5);
  vec3 col = mix(g_c0, g_c1, smoothstep(0.25, 0.6, f));
  return mix(col, g_c2, smoothstep(0.5, 0.85, f + 0.25 * w.y));
}`,
    slots: (p) => ({ a: [n(p, 'speed', 0.25), n(p, 'scale', 0.5), 0, 0], colors: [c(p, 'colorA', '#ff4d00'), c(p, 'colorB', '#ff2e63'), c(p, 'colorC', '#6a00f4')] }),
  },
  {
    id: 'pulse',
    fn: 'genPulse',
    glsl: `
vec3 genPulse(vec2 p, float aspect, float t) {
  float speed = g_a.x, depth = g_a.y;
  float k = 0.5 - 0.5 * cos(t * (0.4 + speed * 4.0));
  vec3 col = mix(g_c0, g_c1, k);
  return col * (1.0 - depth * 0.6 * (1.0 - k) * (1.0 - k));
}`,
    slots: (p) => ({ a: [n(p, 'speed', 0.3), n(p, 'depth', 0.8), 0, 0], colors: [c(p, 'colorA', '#ff3b30'), c(p, 'colorB', '#2f6bff')] }),
  },
  {
    id: 'aurora',
    fn: 'genAurora',
    glsl: `
vec3 genAurora(vec2 p, float aspect, float t) {
  float speed = g_a.x, sc = g_a.y;
  vec2 q = (p - 0.5) * vec2(aspect, 1.0);
  float tt = t * (0.02 + speed * 0.2);
  float band = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float y = 0.18 * sin(q.x * (1.2 + sc * 2.0) + tt * (0.7 + fi * 0.3) + fi * 2.1) + 0.12 * (fbm(vec2(q.x * 1.3 + fi * 5.0, tt * 0.4)) - 0.5) - 0.15 + fi * 0.12;
    float d = q.y - y;
    band += smoothstep(0.32, 0.0, abs(d)) * (0.55 + 0.45 * fbm(vec2(q.x * 6.0 + fi, d * 3.0 - tt)));
  }
  vec3 col = mix(g_c0, g_c1, smoothstep(-0.4, 0.4, q.y + 0.2 * sin(tt + q.x)));
  return col * clamp(0.12 + band * 0.75, 0.0, 1.0);
}`,
    slots: (p) => ({ a: [n(p, 'speed', 0.25), n(p, 'scale', 0.5), 0, 0], colors: [c(p, 'colorA', '#29ffa0'), c(p, 'colorB', '#7a3cff')] }),
  },
  {
    id: 'kelvin-cycle',
    fn: 'genKelvinCycle',
    glsl: `
vec3 genKelvinCycle(vec2 p, float aspect, float t) {
  float period = max(6.0, g_a.z * 60.0);
  float ph = mod(t / period, 2.0);
  float tri = ph < 1.0 ? ph : 2.0 - ph;
  float k = mix(g_a.x, g_a.y, 0.5 - 0.5 * cos(3.14159265 * tri));
  return kelvinRgb(k);
}`,
    slots: (p) => ({ a: [n(p, 'fromKelvin', 2700), n(p, 'toKelvin', 6500), n(p, 'minutes', 2), 0] }),
  },
]

export const GENERATOR_IDS = GENERATORS.map((g) => g.id)

/** The GLSL of every generator plus `vec3 generate(int id, vec2 p, float aspect, float t)`. */
export function generatorsGlsl(): string {
  const fns = GENERATORS.map((g) => g.glsl).join('\n')
  const cases = GENERATORS.map((g, i) => `  if (id == ${i}) return ${g.fn}(p, aspect, t);`).join('\n')
  return `${fns}
vec3 generate(int id, vec2 p, float aspect, float t) {
${cases}
  return vec3(1.0);
}`
}
