# Live layers

Live layers are the moving parts of live mode: a tree swaying in the wind, clouds passing, rain on the glass,
dappled sun. They work like attachments (see [static-light.md](static-light.md)): a **shadow** layer is a mask in
front of the light, so the light fills the frame, the layer blocks some of it, and the one focus ring softens
everything. A **light effect** (day cycle, sun drift, candle, lightning) changes the light itself instead.

## Use them

- **Web.** Show, live tab: the gallery at the top animates every live layer. Tap a tile to try it full size in the
  preview (only on your screen, the wall does not change), then **add to live** or **cancel**. The layers list below
  it reorders, hides and tunes what is on air.
- **Phone.** Live tab, add layer: the same gallery as animated tiles. Tap one to try it in the hero, then add it.
- **Agents.** `backdrop_set` with mode `live` (see [agents-mcp.md](agents-mcp.md)).

## Add a live layer

Say you want "willow sway" from a reference picture. Five steps, all in the repo.

1. **Catalog entry.** Add an item to `procedural` in `contract/catalog.json`, then run `make catalog` in `backend/`
   to copy it into the server:

   ```json
   { "id": "willow-sway", "name": "willow sway", "category": "nature", "animated": true,
     "params": { "wind": { "type": "number", "min": 0, "max": 1, "default": 0.4, "label": "wind" } },
     "thumb": "thumbs/willow-sway.png", "blend": "multiply",
     "animThumb": "thumbs/willow-sway-anim.jpg", "animFrames": 36, "animFps": 12 }
   ```

   `blend: "multiply"` makes it a mask over the light (use it for anything that casts a shadow). Leave it out, or use
   `normal`, for something that adds or colours light. Params use the usual param schema; the web and phone build
   their controls from it, so there is no UI code to write.

2. **Shader.** Append the id to `PROCEDURAL_IDS` in `frontend/src/render/shaders/layer.ts` and add its branch to
   `procedural()` there. Return how much light passes as `vec3` (1 = open, 0 = full shadow). `q` is the frame in
   pattern space (frame height 1, centred), `t` the ambient clock in seconds, `u_pa` your params. Shared shapes
   (`liveLeaves`, `livePalm`, `liveClouds`) live in `frontend/src/render/shaders/live.ts`; put new reusable ones
   there. Keep motion smooth: drive it from slow sines and noise of `t`, never from per-pixel noise of `t`, and
   give each leaf or element its own phase from its cell hash.

3. **Params.** Map the params onto `u_pa` (and `u_pb`) in `proceduralUniforms` in `frontend/src/render/engine.ts`.
   Anything that is the same for every pixel (the wind, a flash curve) belongs there, on the CPU; trees use
   `windState` from `frontend/src/render/wind.ts`.

4. **Thumbnails.** `cd frontend && npm run thumbs -- willow-sway` renders the still (`willow-sway.png`) and the
   looping strip (`willow-sway-anim.jpg`) headless into `backend/internal/catalog/assets/thumbs/`. The server embeds
   them; the phone's gallery animates the strip. Look at both before you commit.

5. **Tests.** `npm test` checks that every catalog item has a renderer branch and a strip; `npm run test:e2e`
   includes `e2e/live-gallery.spec.ts`, which sees every tile, tries one and adds one. In `backend/`, `make test`
   checks the catalog and that `NewLayer` gives the layer its `blend`.

To try a layer while you work, open `/dev/render-harness.html?proc=willow-sway&w=960&h=540&animate=1` on the Vite dev
server, or `/dev/anim-harness.html?proc=willow-sway` for the strip.

## From a reference picture

When you match a photo or a Pinterest reference, look at three things: the scale of the shapes against the frame
(a leaf is about 3 % of the frame height in `tree-sway`), how soft the edges are (that is focus, the light's job,
so draw shapes crisp and let focus soften them), and how it moves (how fast, how much the tips move against the
base, whether parts move together or out of step). Render the still at 960 × 540 next to the reference and iterate.
