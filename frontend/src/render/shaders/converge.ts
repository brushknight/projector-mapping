/**
 * (protocol §20) The converge pass: the source backdrop (rendered as in its own mode) masked by a shape that morphs
 * from the start shape to the target's silhouette with signed distance fields. Mirrors render/converge.ts exactly:
 * mix(sdStart, sdLoops, e) < 0, softened over the edge. Works in scene px (0,0 top left).
 */
import { CONVERGE_MAX_LOOPS, CONVERGE_MAX_VERTS } from '../converge'
import { HEADER } from './common'

export const CONVERGE_FS = `${HEADER}
#define MAXV ${CONVERGE_MAX_VERTS}
#define MAXL ${CONVERGE_MAX_LOOPS}
in vec2 v_uv;
out vec4 o_color;
uniform sampler2D u_src;      // the source backdrop, full brightness
uniform vec2 u_frame;         // the authored frame, scene px
uniform int u_start;          // 0 frame, 1 circle
uniform vec3 u_circle;        // cx, cy, r (scene px)
uniform vec2 u_pts[MAXV];     // the silhouette's loops, one after another
uniform float u_loopEnd[MAXL];// exclusive end index of each loop
uniform int u_loops;
uniform float u_far;          // the distance used when there is no silhouette
uniform float u_e;            // eased progress
uniform float u_edge;         // soft edge, scene px
uniform float u_aa;           // one target pixel in scene px
uniform float u_alpha;

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

void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y) * u_frame;
  float start = u_start == 1 ? length(p - u_circle.xy) - u_circle.z : sdFrame(p, u_edge);
  float d = mix(start, sdLoops(p), clamp(u_e, 0.0, 1.0));
  float h = max(u_edge * 0.5, u_aa * 0.5);
  float x = clamp((d + h) / (2.0 * h), 0.0, 1.0);
  float m = (1.0 - x * x * (3.0 - 2.0 * x)) * u_alpha;
  vec3 c = texture(u_src, v_uv).rgb;
  o_color = vec4(c * m, m);
}
`
