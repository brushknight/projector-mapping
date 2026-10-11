/**
 * Wraps an effect's `vec4 effect(vec2 uv, float t, float progress)` source into a full GLSL ES 3.00 fragment shader
 * per docs/effects.md, and maps params to uniforms.
 */
import type { ParamSchema } from '../../entities/effect/types'
import { hexToRgb } from '../math/color'
import { HEADER, NOISE } from '../shaders/common'

/** Uniform names the wrapper owns; params with these names are not exposed. */
export const RESERVED = new Set(['time', 'progress', 'resolution', 'aspect', 'seed', 'alpha', 'surfacePx', 'perimeterPx', 'outline', 'outlineN', 'lineMode', 'text'])

export const MAX_OUTLINE = 64

/** A param uniform: GLSL type and how to set it. */
export interface ParamUniform {
  name: string
  glsl: 'float' | 'vec3' | 'int'
  key: string
  options?: string[]
}

export function paramUniforms(schema: ParamSchema | null | undefined): ParamUniform[] {
  const out: ParamUniform[] = []
  for (const [key, spec] of Object.entries(schema ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || RESERVED.has(key)) continue
    switch (spec.type) {
      case 'number':
      case 'integer':
      case 'boolean':
        out.push({ name: `u_${key}`, glsl: 'float', key })
        break
      case 'color':
        out.push({ name: `u_${key}`, glsl: 'vec3', key })
        break
      case 'enum':
        out.push({ name: `u_${key}`, glsl: 'int', key, options: spec.options ?? [] })
        break
      default:
        break
    }
  }
  return out
}

/** The numeric value(s) a param uniform gets. Colours are the hex value / 255 (display space). */
export function paramValue(u: ParamUniform, v: unknown): number | [number, number, number] {
  if (u.glsl === 'vec3') return hexToRgb(typeof v === 'string' ? v : '#ffffff')
  if (u.glsl === 'int') return Math.max(0, (u.options ?? []).indexOf(String(v)))
  if (typeof v === 'boolean') return v ? 1 : 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export const EFFECT_PRELUDE = `
in vec2 v_uv;
out vec4 o_color;
uniform float u_time;
uniform float u_progress;
uniform vec2 u_resolution;
uniform float u_aspect;
uniform float u_seed;
uniform float u_alpha;
uniform vec2 u_surfacePx;
uniform float u_perimeterPx;
uniform vec2 u_outline[${MAX_OUTLINE}];
uniform int u_outlineN;
uniform int u_lineMode;
${NOISE}
float _segDist(vec2 p, vec2 a, vec2 b, out float h) {
  vec2 pa = p - a, ba = b - a;
  h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
  return length(pa - ba * h);
}
/** distance to the nearest outline edge, aspect-corrected (surface height = 1); lines: from the centreline */
float edgeDist(vec2 uv) {
  if (u_lineMode == 1) return abs(uv.y - 0.5);
  vec2 s = vec2(u_aspect, 1.0);
  vec2 p = uv * s;
  float d = 1e9;
  float h;
  for (int i = 0; i < ${MAX_OUTLINE}; i++) {
    if (i >= u_outlineN) break;
    int j = i + 1 == u_outlineN ? 0 : i + 1;
    d = min(d, _segDist(p, u_outline[i] * s, u_outline[j] * s, h));
  }
  return d;
}
/** 0..1 along the outline, clockwise from the first point, of the nearest edge point; lines: uv.x */
float perimeterPos(vec2 uv) {
  if (u_lineMode == 1) return uv.x;
  vec2 s = vec2(u_aspect, 1.0);
  vec2 p = uv * s;
  float total = 0.0;
  for (int i = 0; i < ${MAX_OUTLINE}; i++) {
    if (i >= u_outlineN) break;
    int j = i + 1 == u_outlineN ? 0 : i + 1;
    total += length((u_outline[j] - u_outline[i]) * s);
  }
  float best = 1e9, at = 0.0, acc = 0.0, h;
  for (int i = 0; i < ${MAX_OUTLINE}; i++) {
    if (i >= u_outlineN) break;
    int j = i + 1 == u_outlineN ? 0 : i + 1;
    vec2 a = u_outline[i] * s, b = u_outline[j] * s;
    float d = _segDist(p, a, b, h);
    float len = length(b - a);
    if (d < best) { best = d; at = acc + h * len; }
    acc += len;
  }
  return total > 0.0 ? at / total : 0.0;
}
`

/** Builds the fragment shader. `extra` adds declarations for built-ins (e.g. a text sampler). */
export function wrapEffect(source: string, schema: ParamSchema | null | undefined, extra = ''): string {
  const decls = paramUniforms(schema).map((u) => `uniform ${u.glsl} ${u.name};`).join('\n')
  return `${HEADER}${EFFECT_PRELUDE}
${decls}
${extra}
#line 1
${source}

void main() {
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
  vec4 c = effect(uv, u_time, u_progress);
  o_color = clamp(c, 0.0, 1.0) * u_alpha;
}
`
}

/** Compile log lines refer to the user's source (the wrapper sets #line 1 before it). */
export function cleanLog(log: string): string {
  return log.replace(/\u0000/g, '').trim()
}
