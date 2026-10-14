/** Blur, blit, warp and final-pass shaders. */
import { FULLSCREEN_VS, HEADER, NOISE } from './common'

export { FULLSCREEN_VS }

/** Dual-Kawase downsample: u_half = half a source texel × offset. */
export const KAWASE_DOWN_FS = `${HEADER}
in vec2 v_uv;
out vec4 o_color;
uniform sampler2D u_src;
uniform vec2 u_half;
void main() {
  vec4 s = texture(u_src, v_uv) * 4.0;
  s += texture(u_src, v_uv - u_half);
  s += texture(u_src, v_uv + u_half);
  s += texture(u_src, v_uv + vec2(u_half.x, -u_half.y));
  s += texture(u_src, v_uv - vec2(u_half.x, -u_half.y));
  o_color = s / 8.0;
}
`

export const KAWASE_UP_FS = `${HEADER}
in vec2 v_uv;
out vec4 o_color;
uniform sampler2D u_src;
uniform vec2 u_half;
void main() {
  vec4 s = texture(u_src, v_uv + vec2(-u_half.x * 2.0, 0.0));
  s += texture(u_src, v_uv + vec2(-u_half.x, u_half.y)) * 2.0;
  s += texture(u_src, v_uv + vec2(0.0, u_half.y * 2.0));
  s += texture(u_src, v_uv + vec2(u_half.x, u_half.y)) * 2.0;
  s += texture(u_src, v_uv + vec2(u_half.x * 2.0, 0.0));
  s += texture(u_src, v_uv + vec2(u_half.x, -u_half.y)) * 2.0;
  s += texture(u_src, v_uv + vec2(0.0, -u_half.y * 2.0));
  s += texture(u_src, v_uv + vec2(-u_half.x, -u_half.y)) * 2.0;
  o_color = s / 12.0;
}
`

/** Copies a texture (premultiplied) with a multiplier; u_flipY samples images stored top row first. */
export const BLIT_FS = `${HEADER}
in vec2 v_uv;
out vec4 o_color;
uniform sampler2D u_src;
uniform float u_alpha;
uniform int u_flipY;
void main() {
  vec2 uv = u_flipY == 1 ? vec2(v_uv.x, 1.0 - v_uv.y) : v_uv;
  o_color = texture(u_src, uv) * u_alpha;
}
`

/**
 * Warp: draws a surface's geometry (scene px) onto the scene target, sampling its content texture.
 * Plain quads compute uv per fragment from the inverse homography (exact perspective); meshes and polygons use
 * per-vertex uv. softEdge feathers by distance to the outline polygon.
 */
export const WARP_VS = `${HEADER}
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_uv;
uniform vec2 u_res;
out vec2 v_pos;
out vec2 v_uv;
void main() {
  v_pos = a_pos;
  v_uv = a_uv;
  gl_Position = vec4(a_pos.x / u_res.x * 2.0 - 1.0, 1.0 - a_pos.y / u_res.y * 2.0, 0.0, 1.0);
}
`

export const WARP_FS = `${HEADER}
in vec2 v_pos;
in vec2 v_uv;
out vec4 o_color;
uniform sampler2D u_content;
uniform int u_useH;
uniform mat3 u_hInv;
uniform int u_mode;          // 0 content, 1 solid colour (masks, stencil), 2 outline colour
uniform vec4 u_color;
uniform float u_opacity;
uniform float u_soft;        // px
uniform vec2 u_outline[64];
uniform int u_outlineN;

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  float a = u_opacity;
  if (u_soft > 0.0 && u_outlineN > 1) {
    float d = 1e9;
    for (int i = 0; i < 64; i++) {
      if (i >= u_outlineN) break;
      int j = i + 1 == u_outlineN ? 0 : i + 1;
      d = min(d, segDist(v_pos, u_outline[i], u_outline[j]));
    }
    a *= smoothstep(0.0, u_soft, d);
  }
  if (u_mode == 1) { o_color = u_color * a; return; }
  if (u_mode == 2) { o_color = u_color; return; }
  vec2 uv = v_uv;
  if (u_useH == 1) {
    vec3 h = u_hInv * vec3(v_pos, 1.0);
    uv = h.xy / h.z;
  }
  if (uv.x < -0.001 || uv.y < -0.001 || uv.x > 1.001 || uv.y > 1.001) discard;
  // content textures store uv.y = 0 (the surface's top) at the texture's top row
  o_color = texture(u_content, vec2(uv.x, 1.0 - uv.y)) * a;
}
`

/** The final pass to the canvas: orientation, flips, master, blackout, test patterns, outlines, calibration. */
export const FINAL_FS = `${HEADER}
in vec2 v_uv;
out vec4 o_color;
uniform sampler2D u_scene;
uniform sampler2D u_overlay;
uniform int u_hasOverlay;
uniform int u_space;         // 0 scene, 1 physical
uniform int u_orient;        // 0 landscape, 1 portrait-cw, 2 portrait-ccw
uniform vec2 u_flip;         // flipH, flipV as 0/1
uniform float u_master;
uniform float u_blackout;
uniform int u_test;          // 0 off 1 grid 2 white 3 crosshair 4 corners
uniform vec2 u_sceneSize;    // authored px
uniform vec2 u_canvas;       // framebuffer px
uniform int u_pattern;       // 0 none 1 gray 2 white 3 black
uniform int u_axis;          // 0 x 1 y
uniform uint u_bit;
uniform int u_inverse;
uniform int u_seeThrough;   // (§14) keep the scene's alpha: a YouTube player shows behind the canvas

${NOISE}

vec2 physicalToScene(vec2 pv) {
  if (u_flip.x > 0.5) pv.x = 1.0 - pv.x;
  if (u_flip.y > 0.5) pv.y = 1.0 - pv.y;
  if (u_orient == 1) return vec2(pv.y, 1.0 - pv.x);
  if (u_orient == 2) return vec2(1.0 - pv.y, pv.x);
  return pv;
}

float lineMask(float dpx, float wpx, float pxPerScene) {
  // keep lines at least one framebuffer pixel wide
  float w = max(wpx, 1.0 / max(pxPerScene, 1e-3));
  return 1.0 - smoothstep(w * 0.5, w * 0.5 + 0.75 / max(pxPerScene, 1e-3), dpx);
}

float testPattern(vec2 sp, float pxPerScene) {
  vec2 px = sp * u_sceneSize;
  if (u_test == 2) return 1.0;
  if (u_test == 1) {
    float cell = 120.0;
    vec2 m = mod(px, cell);
    float d = min(min(m.x, cell - m.x), min(m.y, cell - m.y));
    float g = lineMask(d, 1.0, pxPerScene);
    vec2 c = abs(px - u_sceneSize * 0.5);
    g = max(g, lineMask(min(c.x, c.y), 3.0, pxPerScene));
    vec2 e = min(px, u_sceneSize - px);
    g = max(g, lineMask(min(e.x, e.y), 4.0, pxPerScene));
    return g;
  }
  if (u_test == 3) {
    vec2 c = px - u_sceneSize * 0.5;
    float cross = lineMask(min(abs(c.x), abs(c.y)), 2.0, pxPerScene);
    float ring = lineMask(abs(length(c) - u_sceneSize.y * 0.25), 2.0, pxPerScene);
    return max(cross, ring);
  }
  if (u_test == 4) {
    vec2 e = min(px, u_sceneSize - px);
    float L = u_sceneSize.y * 0.12;
    float corner = (e.x < L && e.y < L) ? lineMask(min(e.x, e.y), 24.0, pxPerScene) : 0.0;
    float border = lineMask(min(e.x, e.y), 2.0, pxPerScene);
    return max(corner, border);
  }
  return 0.0;
}

void main() {
  if (u_space == 1 && u_pattern > 0) {
    if (u_pattern == 2) { o_color = vec4(1.0); return; }
    if (u_pattern == 3) { o_color = vec4(0.0, 0.0, 0.0, 1.0); return; }
    uint c = u_axis == 0 ? uint(gl_FragCoord.x) : uint(u_canvas.y) - 1u - uint(gl_FragCoord.y);
    uint g = c ^ (c >> 1u);
    bool on = ((g >> u_bit) & 1u) == 1u;
    if (u_inverse == 1) on = !on;
    o_color = on ? vec4(1.0) : vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec2 sp; // scene position 0..1, y down
  vec2 pv = vec2(v_uv.x, 1.0 - v_uv.y);
  if (u_space == 1) sp = physicalToScene(pv); else sp = pv;
  vec2 tuv = vec2(sp.x, 1.0 - sp.y);
  vec4 sc = texture(u_scene, tuv);
  vec3 col = sc.rgb;
  col *= u_master;
  col *= 1.0 - clamp(u_blackout, 0.0, 1.0);
  // see-through: master and blackout dim the player behind as black over it (premultiplied, so col stays as is)
  float alpha = u_seeThrough == 1 ? sc.a + (1.0 - sc.a) * (1.0 - clamp(u_master, 0.0, 1.0) * (1.0 - clamp(u_blackout, 0.0, 1.0))) : 1.0;
  // framebuffer px per scene px (along the scene's x axis after rotation)
  float pxPerScene = (u_space == 1 && u_orient != 0) ? u_canvas.y / u_sceneSize.x : u_canvas.x / u_sceneSize.x;
  if (u_test > 0) {
    float tp = testPattern(sp, pxPerScene);
    col = mix(col, vec3(1.0), tp);
    alpha = alpha * (1.0 - tp) + tp;
  }
  if (u_hasOverlay == 1) {
    vec4 o = texture(u_overlay, tuv);
    col = col * (1.0 - o.a) + o.rgb;
    alpha = o.a + alpha * (1.0 - o.a);
  }
  o_color = vec4(col, alpha);
}
`
