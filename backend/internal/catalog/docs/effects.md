# Effects contract

An effect draws content inside one surface, in that surface's own UV space (0..1 on both axes). The renderer then
warps the result onto the real object, so an effect never deals with perspective. Built-in effects (ids in
`contract/catalog.json` → `effects`) are implemented in `frontend/src/render/effects/` with this same contract.
User and agent effects are stored on the backend (`kind: glsl | js`) and compiled by the renderer.

## GLSL (preferred)

The source defines one function. The renderer wraps it in a WebGL2 (GLSL ES 3.00) fragment shader:

```glsl
vec4 effect(vec2 uv, float t, float progress);   // returns premultiplied RGBA
```

Available in scope:

| name | type | meaning |
| --- | --- | --- |
| `u_time` | float | seconds since the scene started playing (same as `t`) |
| `u_progress` | float | 0..1 within the clip; 1.0 for always-on surface effects |
| `u_resolution` | vec2 | the content texture size in pixels (longest side 1024) |
| `u_aspect` | float | the surface's real width / height in scene pixels |
| `u_seed` | float | stable per surface, 0..1 |
| `u_<param>` | float / vec3 / int | each param from the effect's schema: number and integer → float, color → vec3 (linear 0..1), boolean → float 0/1, enum → int (index into options) |
| `edgeDist(uv)` | float | distance to the nearest surface edge in UV units, aspect-corrected |
| `perimeterPos(uv)` | float | 0..1 position along the border (clockwise from the first point) of the nearest edge point |
| `hash(vec2)`, `noise(vec2)` | float | deterministic helpers |

Rules: no texture lookups other than the provided helpers, no loops longer than 64 iterations, and the function
must be deterministic for the same inputs. Compile errors are reported back to the author (and to agents through
`effect_create`).

## JS (particles, text, logic)

A module whose default export draws one frame onto an OffscreenCanvas 2D context inside a worker:

```js
export default function render(ctx, { t, progress, width, height, aspect, seed, params }) { /* draw */ }
```

There is no DOM, no network and no timers. The frame budget is 4 ms; an effect that goes over it three frames in a
row is disabled and reported.

## Renderer notes (frontend)

Clarifications from the web renderer (`frontend/src/render/`), additive to the contract above:

- `uv` is (0,0) at the surface's first point (top left of a quad) and y grows towards the third/fourth point.
  Quads map uv by an exact homography; tri, poly and circle surfaces use their bounding box; a line surface is a
  16 px wide stroke with `uv.x` = arc-length fraction and `uv.y` across it (0.5 = the centreline).
- `edgeDist(uv)` is measured in aspect-corrected units where the surface height is 1 (x is scaled by `u_aspect`).
  On a line surface it is the distance from the centreline. To convert scene pixels, divide by the surface height
  in pixels (built-ins get it as `u_surfacePx.y`).
- Colour params arrive as the hex value / 255 (display space, no gamma decode); the pipeline blends in display space.
- Params whose names clash with the wrapper's uniforms (`time`, `progress`, `resolution`, `aspect`, `seed`, `alpha`,
  `surfacePx`, `perimeterPx`, `outline`, `outlineN`, `lineMode`, `text`) are not exposed as `u_<param>`.
- Always-on surface effects (`surface.effects`) get `u_time` from the ambient clock so they keep moving while the
  transport is stopped; timeline clips get the playhead.
- The JS `render` call gets `{ t, progress, width, height, aspect, seed, params }`; frames are composited one frame
  late live, and offscreen renders (`render.frame`) wait for them.
- **`drawing` (frontend).** The built-in `drawing` effect does not run GLSL per stroke: the engine rasterizes
  `params.strokes` (protocol §1) on a 2D canvas the size of the surface's content texture (at most 1024 px on the
  longest side, with the surface's aspect), caches it by the strokes and the reveal (to 1/1000), uploads it and samples
  it in a one-line effect. Widths and text sizes are in surface px, so they scale with the surface. `reveal` cuts the
  total stroke length; in a clip the reveal is `reveal × progress`. The same rasterizer draws the face view of the editor's content space,
  so what you draw there is what the wall shows.

- **Content layers (frontend, protocol §12).** Media and gradient layers are not effects: the engine draws them into
  the surface's content target before the effects (object layers first, sampled from the object's atlas canvas
  through the face's atlas rect, then the surface's own layers), with `src/render/shaders/content.ts`. Effects
  composite on top of them in the same UV space.

- **`converge` (frontend, protocol §20).** Not a surface effect: its clips never reach `drawContent` (the timeline
  hands surfaces no `converge` clips; the `BUILTINS` entry is a stub marked `scene`). `src/render/converge.ts`
  evaluates the converge clips at t (with hold), finds the start shape (the frame, or the light's round spot from the
  plates' cut paths) and the target's silhouette (the accent's), and the engine draws the source backdrop into its own
  target (`converge:<mode>`, once per frame per mode) and masks it with `shaders/converge.ts`: the polygon SDF in the
  shader (128 points, 16 loops), mixed with the start SDF by the eased progress. It runs after the underlay and before
  the mapping; the outline (the accent's line) after the mapping.
- **Hold (protocol §20).** `evaluateTimeline` and `evaluateLayerClips` include held clips (progress 1, no fade out)
  until the next clip of the same effect on the track: the state at t is a pure function of the document and t.

## The light model (frontend, protocol §15)

Static and live stacks draw with the light model, not as layers: `src/render/shaders/light.ts`.

1. **Colour** (`COLOR_FS`): the light's CCT or HSI colour, a gradient gel or an animated colour generator, into a
   colour target. A CCT light is softened towards white (`0.3 + 0.7 × blackbody`): the eye adapts to the light it
   sits in, so 3200 K reads as warm white on the wall, not as orange paint.
2. **Mask** (`MASK_FS`): a white target, multiplied by every visible attachment (`pass × opacity + 1 − opacity`) and,
   in live stacks, by the shadow layers (blend `multiply`: tree sway, palm sway, clouds). Each attachment maps the frame
   position to wall space (frame height = 1), undoes `throw` (stretch away from the light and widen towards the
   bottom, like low sun) and `skew` (a vertical shear: horizontals tilt, verticals stay upright), then the gobo's
   rotation and scale, and evaluates its shape. `depth` samples the shape three more times along the light's direction
   and darkens the band they disagree on by up to half: the soft second edge a deep window frame casts.
3. **Focus**: one dual-Kawase blur of the whole mask, `(1 − focus)^1.5 × 60 + 0.6` px at 1080 p.
4. **Compose** (`LIGHT_FS`): colour × mask, with lateral colour (red sampled a touch further out from the centre
   than blue, `fringe`), a cos⁴ beam falloff (`vignette`), and with `haze` lens blotches, fine grain and light
   scattered around bright areas (from a much wider blur of the mask). The frame slide shifts where the composed
   light lands; what leaves the frame is gone.

The 33 attachment shapes are signed distance functions in `SHAPES_GLSL` (windows, blinds, leaves, patterns, spots);
`src/render/attachments.ts` maps each catalog gobo and its params onto a shape and its uniform slots. A unit test
fails when the catalog and the renderer disagree. Thumbnails come from the same code: `npm run thumbs` renders every
gobo and procedural layer headless into `backend/internal/catalog/assets/thumbs/`, which the server embeds and serves
at `/catalog/thumbs/<id>.png`.

Live layers (catalog `procedural`: tree sway, clouds, rain…) are branches of `procedural()` in
`src/render/shaders/layer.ts`, with their shared shapes in `src/render/shaders/live.ts`; a multiply one is a mask over
the light (§16). [guides/live-layers.md](guides/live-layers.md) walks through adding one.

## Colour generators (frontend, protocol §15)

Animated colour for a light's `colorLayer` and for `generator` layers in the color and live stacks. Each generator is
one GLSL function plus a mapping from its params to uniform slots, registered in `src/render/generators.ts`:

```ts
{
  id: 'pulse',
  fn: 'genPulse',
  glsl: `
vec3 genPulse(vec2 p, float aspect, float t) {
  float k = 0.5 - 0.5 * cos(t * (0.4 + g_a.x * 4.0));
  return mix(g_c0, g_c1, k);
}`,
  slots: (p) => ({ a: [n(p, 'speed', 0.3), 0, 0, 0], colors: [c(p, 'colorA', '#ff3b30'), c(p, 'colorB', '#2f6bff')] }),
}
```

- `p` is the frame position 0…1 (y down), `aspect` the frame's width / height, `t` the ambient clock in seconds.
- Read numbers from `g_a` and `g_b` (two `vec4`) and colours from `g_c0`, `g_c1`, `g_c2`. Use the shared helpers
  `hash`, `noise`, `fbm`, `rot` and `kelvinRgb(k)`. Return RGB 0…1; the light's intensity and fx scale it after.
- Add the same `id` with its `params` schema to `colorGenerators` in `contract/catalog.json`. The shader is built
  from the list, so nothing else changes; `attachments.test.ts` checks the catalog and the registry agree.
- Built in: `hue-cycle`, `color-flow`, `pulse`, `aurora`, `kelvin-cycle`.
