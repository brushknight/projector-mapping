/**
 * Built-in effects (contract/catalog.json → effects), written against the same contract as user GLSL effects:
 * `vec4 effect(vec2 uv, float t, float progress)` returning premultiplied RGBA. Built-ins may also read
 * u_surfacePx (surface size in scene px) and u_perimeterPx (outline length in scene px).
 *
 * Line widths in scene px convert to edgeDist units (surface height = 1) by dividing by u_surfacePx.y.
 */

export interface Builtin {
  source: string
  /** extra declarations (samplers) */
  extra?: string
  /** needs the label text texture */
  text?: boolean
  /** needs the drawing texture (the strokes, rasterized on the CPU) in u_text */
  drawing?: boolean
  /**
   * (§20) drawn by the engine over the whole scene, not inside a surface (the converge): surface content skips its
   * clips, and its source draws nothing
   */
  scene?: boolean
}

const PX = `
float pxToH(float px) { return px / max(u_surfacePx.y, 1.0); }
vec4 premul(vec3 c, float a) { a = clamp(a, 0.0, 1.0); return vec4(c * a, a); }
`

export const BUILTINS: Record<string, Builtin> = {
  // (§20) the converge closes a backdrop mode's light onto the target's silhouette; render/converge.ts draws it
  converge: {
    scene: true,
    source: `vec4 effect(vec2 uv, float t, float progress) { return vec4(0.0); }`,
  },
  'grid-build': {
    source: `${PX}
vec4 effect(vec2 uv, float t, float progress) {
  float nx = max(1.0, u_cells);
  float ny = max(1.0, floor(u_cells / max(u_aspect, 0.05) + 0.5));
  vec2 g = uv * vec2(nx, ny);
  vec2 cellPx = u_surfacePx / vec2(nx, ny);
  vec2 f = fract(g);
  vec2 dpx = min(f, 1.0 - f) * cellPx;            // px to the nearest vertical / horizontal line
  vec2 idx = floor(g + 0.5);                       // index of that line
  // each line draws on in sequence during the first 70% of the clip
  float rv = clamp((progress - idx.x / nx * 0.45) / 0.3, 0.0, 1.0);
  float rh = clamp((progress - idx.y / ny * 0.45) / 0.3, 0.0, 1.0);
  float lw = u_line * 0.5;
  float v = (1.0 - smoothstep(lw, lw + 1.0, dpx.x)) * step(uv.y, rv);
  float h = (1.0 - smoothstep(lw, lw + 1.0, dpx.y)) * step(uv.x, rh);
  float glowV = exp(-max(dpx.x - lw, 0.0) / (2.0 + 10.0 * u_glow)) * step(uv.y, rv);
  float glowH = exp(-max(dpx.y - lw, 0.0) / (2.0 + 10.0 * u_glow)) * step(uv.x, rh);
  float lines = max(v, h);
  float glow = max(glowV, glowH) * u_glow * 0.5;
  // cells flicker on once the grid is built
  float cellOn = step(hash(floor(g) + floor(t * 6.0) * 0.17), 0.18) * smoothstep(0.7, 1.0, progress) * (1.0 - smoothstep(0.98, 1.0, progress) * 0.5);
  float a = max(lines, glow) + cellOn * 0.12;
  return premul(u_color, a);
}`,
  },

  trace: {
    source: `${PX}
vec4 effect(vec2 uv, float t, float progress) {
  float lw = pxToH(u_line) * 0.5;
  float ed = edgeDist(uv);
  float pp = perimeterPos(uv);
  float per = max(u_perimeterPx, 1.0);
  if (u_pixelStep > 0.5) pp = floor(pp * per / u_pixelStep) * u_pixelStep / per;
  float lap = max(u_speed, 0.05);
  float ph = fract(t / lap);
  float head = u_mode == 1 ? 1.0 - abs(1.0 - 2.0 * ph) : ph;
  if (u_pixelStep > 0.5) head = floor(head * per / u_pixelStep) * u_pixelStep / per;
  float tail = 0.28;
  float behind = u_mode == 1 ? abs(head - pp) / tail : fract(head - pp) / tail;
  float comet = behind < 1.0 ? pow(1.0 - behind, 1.6) : 0.0;
  float core = 1.0 - smoothstep(lw, lw + pxToH(1.0), ed);
  float glow = exp(-max(ed - lw, 0.0) / max(pxToH(4.0 + 16.0 * u_glow), 1e-4)) * u_glow;
  float base = 0.18;
  float a = (core * (base + (1.0 - base) * comet)) + glow * comet * 0.8;
  return premul(u_color, a);
}`,
  },

  scan: {
    source: `${PX}
vec4 effect(vec2 uv, float t, float progress) {
  float pos;
  if (u_direction == 0) pos = uv.y;
  else if (u_direction == 1) pos = 1.0 - uv.y;
  else if (u_direction == 2) pos = 1.0 - uv.x;
  else pos = uv.x;
  float head = progress >= 0.999 ? fract(t * 0.5) : progress;
  float w = max(u_width, 0.01);
  head = head * (1.0 + w) - w * 0.5;
  float d = (head - pos) / w;
  float band = d >= 0.0 && d <= 1.0 ? (1.0 - d) * (1.0 - d) : 0.0;
  float lead = 1.0 - smoothstep(0.0, pxToH(3.0), abs(head - pos));
  return premul(u_color, max(band * 0.8, lead));
}`,
  },

  glitch: {
    source: `${PX}
vec4 effect(vec2 uv, float t, float progress) {
  float n = max(2.0, u_blocks);
  float slot = floor(t * 12.0);
  vec2 grid = vec2(n * max(u_aspect, 0.2), n);
  float row = floor(uv.y * grid.y);
  float shift = (hash(vec2(row, slot)) - 0.5) * 0.3 * u_amount * step(hash(vec2(slot, row + 3.0)), 0.35);
  vec2 cell = floor((uv + vec2(shift, 0.0)) * grid);
  float on = step(hash(cell + slot * 1.37), u_amount * 0.45);
  float scan = step(0.5, fract(uv.y * u_surfacePx.y / 3.0)) * 0.25;
  float flash = step(0.93, hash(vec2(slot, 7.0))) * u_amount * 0.4;
  vec3 c = u_color;
  if (hash(cell + 0.5) > 0.7) c = vec3(c.r, c.g * 0.4, c.b);
  return premul(c, on * (0.85 - scan) + flash);
}`,
  },

  fill: {
    source: `vec4 effect(vec2 uv, float t, float progress) {
  return vec4(u_color * u_opacity, u_opacity);
}`,
  },

  particles: {
    source: `${PX}
vec4 effect(vec2 uv, float t, float progress) {
  float count = max(1.0, u_count);
  float gx = max(1.0, floor(sqrt(count * u_aspect) + 0.5));
  float gy = max(1.0, floor(count / gx + 0.5));
  vec2 grid = vec2(gx, gy);
  vec2 p = uv;
  float a = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c0 = floor(p * grid) + vec2(float(i), float(j));
    vec2 h = hash2(c0 + 0.31);
    // particles rise and wrap; each cell column drifts at its own speed
    float speed = (0.05 + u_speed * 0.6) * (0.5 + h.y);
    vec2 pos = (c0 + h) / grid;
    pos.y = fract(pos.y - t * speed * 0.25 + h.x * 7.0);
    pos.x += sin(t * (0.5 + h.x) + h.y * 6.28) * 0.15 / grid.x;
    vec2 d = (p - pos);
    // wrap vertical distance
    d.y = d.y - floor(d.y + 0.5);
    vec2 dpx = d * u_surfacePx;
    float r = u_size * 0.5;
    float tw = 0.6 + 0.4 * sin(t * 3.0 + h.x * 40.0);
    a = max(a, (1.0 - smoothstep(r, r + 1.0, length(dpx))) * tw);
    a = max(a, exp(-length(dpx) / (r * 2.5 + 1.0)) * 0.25 * tw);
  }
  return premul(u_color, a);
}`,
  },

  label: {
    text: true,
    extra: 'uniform sampler2D u_text;',
    source: `vec4 effect(vec2 uv, float t, float progress) {
  vec4 c = texture(u_text, uv);
  float reveal = progress >= 0.999 ? 1.0 : smoothstep(0.0, 0.25, progress);
  return c * reveal;
}`,
  },

  drawing: {
    drawing: true,
    extra: 'uniform sampler2D u_text;',
    source: `vec4 effect(vec2 uv, float t, float progress) {
  return texture(u_text, uv);
}`,
  },

  pulse: {
    source: `${PX}
vec4 effect(vec2 uv, float t, float progress) {
  float beat = fract(t * u_bpm / 60.0);
  float k = exp(-beat * 5.0);
  float level = (1.0 - u_depth) + u_depth * k;
  float ed = edgeDist(uv);
  float edge = exp(-ed / max(pxToH(10.0), 1e-4));
  return premul(u_color, level * 0.55 + edge * level * 0.45);
}`,
  },

  highlight: {
    source: `${PX}
vec4 effect(vec2 uv, float t, float progress) {
  float ed = edgeDist(uv);
  float edge = (1.0 - smoothstep(pxToH(1.5), pxToH(2.5), ed)) + exp(-ed / max(pxToH(18.0), 1e-4)) * 0.6;
  float a = u_fillOpacity + edge * u_edgeGlow;
  return premul(u_color, a);
}`,
  },

  spin: {
    source: `${PX}
vec4 effect(vec2 uv, float t, float progress) {
  vec2 d = (uv - 0.5) * vec2(u_aspect, 1.0);
  float r = length(d);
  float R = 0.5 * min(u_aspect, 1.0) - pxToH(u_line) - pxToH(2.0);
  float lw = pxToH(u_line) * 0.5;
  float ring = 1.0 - smoothstep(lw, lw + pxToH(1.0), abs(r - R));
  float ang = atan(d.y, d.x) / 6.28318 + 0.5;
  float rot = t * u_rpm / 60.0;
  float dash = step(0.45, fract((ang + rot) * max(u_dashes, 1.0)));
  float inner = 1.0 - smoothstep(lw, lw + pxToH(1.0), abs(r - R * 0.55));
  float dash2 = step(0.6, fract((ang - rot * 1.5) * max(u_dashes, 1.0) * 0.5));
  return premul(u_color, ring * dash + inner * dash2 * 0.5);
}`,
  },
}
