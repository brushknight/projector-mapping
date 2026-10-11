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
  total stroke length; in a clip the reveal is `reveal × progress`. The same rasterizer draws the editor's flat view,
  so what you draw there is what the wall shows.

