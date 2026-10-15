/**
 * (protocol §21) The morph pass: a shape that turns into another with signed distance fields, filled with a colour or
 * a backdrop source; pass 1 draws only its outline. Mirrors render/morph.ts: mix(sdA, sdB, e) < 0, softened over the
 * edge. Kinds: 0 frame, 1 circle, 2 the silhouette loops, 3 rect, 4 plate field. Scene px (0,0 top left).
 */
import { CONVERGE_MAX_LOOPS, CONVERGE_MAX_VERTS } from '../converge'
import { HEADER } from './common'

export const MORPH_FS = `${HEADER}
#define MAXV ${CONVERGE_MAX_VERTS}
#define MAXL ${CONVERGE_MAX_LOOPS}
in vec2 v_uv;
out vec4 o_color;
uniform sampler2D u_src;      // the source backdrop (fill light)
uniform sampler2D u_sdfA;     // plate fields (kind 4)
uniform sampler2D u_sdfB;
uniform vec2 u_frame;
uniform int u_kindA;
uniform int u_kindB;
uniform vec4 u_shA;           // circle cx, cy, r | rect cx, cy, hw, hh | plate cx, cy, half
uniform vec4 u_shB;
uniform vec2 u_pts[MAXV];
uniform float u_loopEnd[MAXL];
uniform int u_loops;
uniform float u_far;
uniform float u_e;
uniform float u_edge;
uniform float u_aa;
uniform float u_alpha;
uniform int u_fill;           // 0 light (u_src), 1 colour
uniform vec3 u_color;
uniform int u_pass;           // 0 fill, 1 outline
uniform float u_lineW;        // outline width, scene px
uniform vec3 u_lineColor;

float sdFrame(vec2 p, float pad) {
  vec2 d = abs(p - u_frame * 0.5) - (u_frame * 0.5 + pad);
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdLoops(vec2 p) {
  if (u_loops <= 0) return u_far;
  float d = 1e9;
  bool inside = false;
  int s = 0;
  for (int l = 0; l < MAXL; l++) {
    if (l >= u_loops) break;
    int e = int(u_loopEnd[l] + 0.5);
    bool inL = false;
    for (int i = 0; i < MAXV; i++) {
      int k = s + i;
      if (k >= e) break;
      int j = k + 1 < e ? k + 1 : s;
      vec2 a = u_pts[k], b = u_pts[j];
      vec2 pa = p - a, ba = b - a;
      float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
      d = min(d, length(pa - ba * h));
      if ((a.y > p.y) != (b.y > p.y) && p.x < ba.x * (p.y - a.y) / ba.y + a.x) inL = !inL;
    }
    inside = inside || inL;
    s = e;
  }
  return inside ? -d : d;
}

float sdShape(int k, vec4 s, sampler2D tex, vec2 p) {
  if (k == 0) return sdFrame(p, u_edge);
  if (k == 1) return length(p - s.xy) - s.z;
  if (k == 2) return sdLoops(p);
  if (k == 3) {
    vec2 d = abs(p - s.xy) - s.zw;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }
  if (k == 4) {
    vec2 q = (p - s.xy) / s.z;
    vec2 cq = clamp(q, -1.0, 1.0);
    return texture(tex, cq * 0.5 + 0.5).r * s.z + length(q - cq) * s.z;
  }
  return u_far;
}

void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y) * u_frame;
  float e = clamp(u_e, 0.0, 1.0);
  float d;
  if (e <= 0.0) d = sdShape(u_kindA, u_shA, u_sdfA, p);
  else if (e >= 1.0) d = sdShape(u_kindB, u_shB, u_sdfB, p);
  else d = mix(sdShape(u_kindA, u_shA, u_sdfA, p), sdShape(u_kindB, u_shB, u_sdfB, p), e);
  if (u_pass == 1) {
    float hw = max(u_lineW * 0.5, u_aa * 0.5);
    float a = (1.0 - smoothstep(hw - u_aa * 0.5, hw + u_aa * 0.5, abs(d))) * u_alpha;
    o_color = vec4(u_lineColor * a, a);
    return;
  }
  float h = max(u_edge * 0.5, u_aa * 0.5);
  float x = clamp((d + h) / (2.0 * h), 0.0, 1.0);
  float m = (1.0 - x * x * (3.0 - 2.0 * x)) * u_alpha;
  vec3 c = u_fill == 0 ? texture(u_src, v_uv).rgb : u_color;
  o_color = vec4(c * m, m);
}
`
