/**
 * Content layers (protocol §12): media and gradient layers drawn into a surface's content target or an object's
 * atlas target, and the atlas sample a face draws from its object's atlas. Targets store canvas uv y = 0 (the top) at
 * the GL top row, like effects.
 */
import { HEADER } from './common'

export const MAX_STOPS = 8

export const CONTENT_FS = `${HEADER}
in vec2 v_uv;
out vec4 o_color;
uniform int u_kind;          // 0 media, 1 gradient, 2 atlas sample
uniform vec2 u_canvas;       // target size in px
uniform sampler2D u_tex;
uniform vec2 u_texSize;
uniform int u_premul;        // 1 when u_tex is premultiplied
uniform int u_texFlip;       // 1 when u_tex stores the top row at t = 1 (render targets)
uniform int u_fit;           // 0 fill, 1 fit, 2 stretch
uniform vec4 u_crop;         // x, y, w, h in source fractions
uniform vec2 u_xy;           // centre offset in canvas fractions
uniform float u_scale;
uniform float u_rot;         // radians, clockwise
uniform float u_opacity;
uniform float u_reveal;
uniform float u_revealAngle; // radians
uniform vec3 u_stopColor[${MAX_STOPS}];
uniform float u_stopPos[${MAX_STOPS}];
uniform int u_stopN;
uniform float u_gAngle;
uniform float u_gOffset;
uniform int u_repeat;
// atlas sample: atlas uv = o + c.x * U + c.y * V (all in atlas uv units)
uniform vec2 u_ao;
uniform vec2 u_aU;
uniform vec2 u_aV;

vec3 stops(float t) {
  vec3 c = u_stopColor[0];
  for (int i = 1; i < ${MAX_STOPS}; i++) {
    if (i >= u_stopN) break;
    float a = u_stopPos[i - 1], b = u_stopPos[i];
    c = mix(c, u_stopColor[i], clamp((t - a) / max(b - a, 1e-5), 0.0, 1.0));
  }
  return c;
}

float wipe(vec2 c) {
  if (u_reveal >= 0.9999) return 1.0;
  if (u_reveal <= 0.0) return 0.0;
  vec2 d = vec2(cos(u_revealAngle), sin(u_revealAngle));
  float s = dot(c - 0.5, d) / max(0.5 * (abs(d.x) + abs(d.y)), 1e-5) * 0.5 + 0.5;
  float w = 1.5 / max(u_canvas.x, u_canvas.y);
  return 1.0 - smoothstep(u_reveal - w, u_reveal + w, s);
}

void main() {
  vec2 c = vec2(v_uv.x, 1.0 - v_uv.y);
  if (u_kind == 2) {
    vec2 a = u_ao + c.x * u_aU + c.y * u_aV;
    if (a.x < 0.0 || a.y < 0.0 || a.x > 1.0 || a.y > 1.0) discard;
    o_color = texture(u_tex, vec2(a.x, 1.0 - a.y)) * u_opacity;
    return;
  }
  vec2 W = u_canvas;
  vec2 q = c * W - (W * 0.5 + u_xy * W);
  float cs = cos(u_rot), sn = sin(u_rot);
  q = vec2(cs * q.x + sn * q.y, -sn * q.x + cs * q.y) / max(u_scale, 1e-4);
  float m = wipe(c) * u_opacity;
  if (m <= 0.0) discard;
  if (u_kind == 1) {
    vec2 local = q / W;
    vec2 d = vec2(cos(u_gAngle), sin(u_gAngle));
    float t = dot(local, d) / max(0.5 * (abs(d.x) + abs(d.y)), 1e-5) * 0.5 + 0.5 - u_gOffset;
    t = u_repeat == 1 ? fract(t) : clamp(t, 0.0, 1.0);
    o_color = vec4(stops(t) * m, m);
    return;
  }
  float aS = (u_texSize.x * u_crop.z) / max(u_texSize.y * u_crop.w, 1e-5);
  float aC = W.x / W.y;
  vec2 box = W;
  if (u_fit == 0) box = aS > aC ? vec2(W.y * aS, W.y) : vec2(W.x, W.x / aS);
  else if (u_fit == 1) box = aS > aC ? vec2(W.x, W.x / aS) : vec2(W.y * aS, W.y);
  vec2 local = q / box + 0.5;
  if (local.x < 0.0 || local.y < 0.0 || local.x > 1.0 || local.y > 1.0) discard;
  vec2 s = u_crop.xy + local * u_crop.zw;
  if (u_texFlip == 1) s.y = 1.0 - s.y;
  vec4 px = texture(u_tex, s);
  if (u_premul == 0) px.rgb *= px.a;
  o_color = px * m;
}
`
