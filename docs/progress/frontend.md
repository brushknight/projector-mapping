# Frontend progress

Status as of 2026-10-12. React 18 + TypeScript + Vite + TanStack Router (code-based tree), CSS Modules, no UI
library. Conventions follow `~/dev/brushknight/content-media-manager/web` (see `frontend/CLAUDE.md`).

## Run it

```bash
cd frontend
npm install
npm run dev            # Vite on :5410, proxies /api /ws /a/ /catalog /mcp to http://localhost:7400 (PROJMAP_API overrides)
npm run mock           # the mock backend on :7400 (PORT=…, MOCK_CAMERA=1 for a fake phone camera feed)
npm run build          # tsc -b + vite build into ../backend/internal/web/dist (keeps dist/.gitkeep)
npm run typecheck
npm test               # vitest: contract fixtures, hub client, JSON Patch, scene ops, geometry, render math
npm run test:e2e       # Playwright (bundled headless Chromium), starts the mock on :7499 and Vite on :5411
```

Without the Go server: `npm run mock` and `npm run dev` in two terminals, then open http://localhost:5410/editor,
http://localhost:5410/out, http://localhost:5410/components. With the Go server: `make dev` in `backend/` plus
`npm run dev`. Verified against both (the real server built from `backend/` at 02:08 on a side port).

Playwright needs its Chromium once: `npx playwright install chromium`. WebGL runs on SwiftShader in headless
(`--use-angle=swiftshader --enable-unsafe-swiftshader`, set in `playwright.config.ts`).

## What works

**Shared client** (`src/shared/lib`, `src/entities/*`)
- Types for every protocol §1 entity in `entities/*/types.ts` (plus the §9 optional fields: `show.preview`,
  `asset.thumb`, `device.telemetry`, calibration result and candidates). Runtime guards in `entities/*/schema.ts`
  (`shared/lib/guard.ts`); `entities/contract.test.ts` decodes every `contract/fixtures/*.json`, every ws message and
  the catalog, and proves a drifted field fails.
- `shared/lib/ws.ts` hub client: hello/welcome, reconnect with backoff (0.5 s doubling to 10 s), 8-ping median clock
  offset with a 30 s resync, channel subscriptions into a store (snapshot / patched / param; version gaps resync),
  optimistic patches with stale rebase through an intent function (up to 3 times), draft patches settled by `ack`,
  commands with ack/error promises and timeouts, RPC handler registry, telemetry. Tested with a fake socket.
- `shared/lib/http.ts` (bearer token, `{code,message}` errors), `jsonPatch.ts` (immutable RFC 6902), `useHub.ts`
  (React bindings), `useRaf.ts`.
- `entities/*/api.ts` for every REST route the UI uses.

**Render engine** (`src/render`, WebGL2, deterministic `render(input)`)
- Backdrop compositor at scene resolution (portrait authored at height × width, rotated in the final pass), blend
  modes with premultiplied GL blending, all 8 gobos, all 12 procedural layers (tree sway only darkens lit areas in
  multiply), gradients (stops, drift, grain), photos (scenery or `asset:<sha>`, blur, warmth, drift), solid.
- Light: CCT blackbody + tint, HSI, softness as dual-Kawase blur, angle/scale/offset, all 8 light FX curves.
- Mapping: per-surface content FBO (longest side 1024), quads by exact homography in the fragment shader, mesh
  (bilinear, Catmull-Rom when `bezier`), tri/poly (ear clipping, bbox uv), circle, line (16 px stroke), soft edges,
  opacity, details clipped to their parent via stencil, masks paint black.
- Effects: every catalog built-in as GLSL on the effects contract, user GLSL (compile errors reported), JS effects
  in a worker with a 4 ms budget. Timeline evaluation with fades and surface/object/all targets.
- Final pass: orientation, flips, master, blackout, test patterns, outline flashes, calibration patterns exactly per
  §7 (verified pixel for pixel in e2e). Notes in `docs/effects.md` "Renderer notes (frontend)".

**/out** fullscreen canvas at device pixels, role `output`, pairing screen (code from `/pair/code`, QR of
`projmap://connect?server=<host>:7400&code=…`, "waiting for controller") while disconnected, with no active scene,
and for 8 s after load (click or `?headless=1` skips it), wake lock, fps telemetry every 2 s, RPCs
`output.pattern` (answers after 3 frames), `output.outline`, `render.frame` (offscreen PNG → `/assets` snapshot →
`{sha}`), blackout fade over `blackoutFadeMs`, `show.preview` drafts, `?token=` for a non-local output.

**/preview** chrome-less, `?token=&w=&mode=hero|layer&layer=`, role `remote`, 30 fps cap, scene space.

**/editor** (`/editor`, `/editor/map`, `/editor/animate`, `/editor/automap`, `?scene=` picks the scene)
- Top bar: scene picker (scenes, new empty scene, new scene from photo), workspaces, tools V Q T P C W L K, iPhone
  pill with the device list and output telemetry, setup chip (orientation, size, flips, master, blackout fade, test
  pattern, reference photo), backstage/live, on air/blackout, an "agent preview · stop" chip during `show.preview`.
- Left: surfaces tree (objects, surfaces, eye toggles), library tabs: effects (click adds to the selected surface,
  drag onto the stage or a timeline lane), media (scenery and "my photo" as photo layers), backdrops (layer stack,
  add layer from the catalog, presets apply/save).
- Stage: reference photo underlay (screen blend), dot grid, zoom (⌘/ctrl wheel, pinch) and pan, fit, input/output/
  split views, draggable points with the magnet (welds shared points), surface drag, keyboard nudges (arrows 1 px,
  Shift 10 px), Tab cycles points, Alt-click adds a mesh row and column, ⌘ toggles snapping, Enter/Esc finish or cancel
  a drawing, loupe ×10 with a 1 px grid, point readout, mesh handles, test grid (projector and stage), drawing tools
  create surfaces (inside a selected face → a detail of it; W makes a 4×4 mesh quad; K a mask).
- Inspector: surface (corners as numbers with shared markers, warp corner pin/mesh/bezier, mesh size, lock corners,
  effect stack with schema-driven controls, opacity, soft edge, role, parent), object (name, visible, tags), layer
  (blend, opacity, light, colour CCT/HSI with presets, light FX, gobo/photo pick, gradient stops, params), clip
  (timing, fades, effect, params), scene (name, length, history).
- Timeline: transport (to start, play/pause, stop, loop, go), timecode, add cue, cues on the ruler (jump, follow-on,
  move, delete), tracks (add for all/object/surface, delete, local mute), clips drag/resize with snapping to cues and
  edges (Shift for free), drop effects to add clips, ruler scrubbing, send to phone (activate the scene).
- Backstage edits go to the editor's draft (apply to live / discard); live edits patch the scene. ⌘Z / ⇧⌘Z call the
  server's undo/redo. Space plays/pauses; Delete removes the selected clip, layer, surface or object.
- Agent panel (right tab in map/animate, always in auto map): codex/claude, session log from `agent:{id}`, tool rows
  with durations, messages, proposal card with apply / preview (the stage shows the draft) / discard, stop, the
  `/settings` toggles (hidden on 404), prompt box → `POST /agents/sessions`.
- Auto map: phone status, calibration progress from `calib:{id}`, quality, candidates from
  `/calibrations/{id}/candidates` (add as surfaces), objects in view, run/recalibrate; camera feed (JPEG frames on
  `camera`) beside the output with outlines; snapshot and "use as reference"; progress strip.
- New scene from photo: upload (pick, drop, paste), take with iPhone (`cmd camera.capture`), grab a live camera frame;
  lens/anywhere, name, find surfaces, ask Codex with a prompt → `/scenes/from-photo` (+ an agent session).
- `/editor?login=<code>` trades a one-time link for a token (kept in localStorage) for an editor on another machine.

**/components** the living style guide with every shared component (Pill, OnAirDot, Segmented, Tools, FillSlider,
Switch, NumField, Readout, TextInput, TextArea, Field, ColorField, Panel/Section/Cap, TreeNode, LibTile, EfxCard +
ParamControls, Menu, Glass, HintBar, Chat/Log/AskBox, StepBar, QrCode, Dialog, Toast, EmptyState, Icon).

**Tests**: 76 vitest unit tests, 16 Playwright e2e (editor loads; dragging a point sends params and the server
commits; drawing a triangle sends a structural patch; backstage edits stay in the draft until applied; the agent
panel shows a proposal; the style guide renders; /out renders a non-black frame and blacks out; pairing screen;
exact Gray-code pixels for x and y, bits and inverse; white/black; preview; render.frame uploads a PNG).

## Modes, test pattern expiry, drawing (protocol §11)

- Types and guards for `scene.mode`, the four backdrop stacks, `scene.underlay`, `setup.testPatternUntil`, the
  `drawing` effect's strokes and the catalog param type `strokes` (never a slider). `entities/scene/lib.ts`:
  `locateLayer`, `findLayer`, `stackLayers`, `allLayers`, `onAirPlan` (what a mode puts on air). `ops.ts`: `setMode`,
  `addLayer(mode, …)`, `replaceStack`, `pickSingle` (single-choice picks that keep the light or the photo params and
  put the mode on air), `applyPresetOps`, `setUnderlay`; layer ops find layers in any stack.
- Engine: draws `backdrop[mode]` only in a backdrop mode and the mapped objects only in objects mode (over the
  underlay scaled by its level); `RenderInput.mode` overrides the scene's mode (editor stage, MCP renders, agent
  previews); `layerOnly` finds the layer in any stack. The `drawing` built-in is rasterized on the CPU
  (`render/effects/drawing.ts`) and sampled in the content pass, so it warps like any effect.
  `Renderer.renderSurface(input, surfaceId)` draws one surface's content flat (the flat view) and
  `surfaceFlatSize` gives its size in scene px.
- `/out` and `/preview` draw the test pattern that is really on (`activeTestPattern`: an expired `testPatternUntil`
  counts as off); `/preview` keeps its drawing buffer so tests can read it. `/out` draws `show.preview` drafts in
  objects mode; `render.frame` honours `mode`.
- Editor: a mode picker in the top bar (static, live, color, scenery, objects with what each shows), a test pattern
  chip with the seconds left (click renews 60 s, "off" stops it), the setup panel's countdown and "keep on 60 s", and
  the library's backdrops tab per stack (on-air dot, "put … on air", single-choice tiles for gobos, gradients and
  photos, the live layer stack with add layer, presets of that mode that switch the wall to it). Media tiles and
  "my photo" put a photo on air in scenery. The mapping side (stage objects preview, coach panel, + face, flat view,
  drawing, unfold) is described in `docs/mapping.md`.
- Tests: `ops.test.ts` (mode, picks, presets, on-air plan), `setup/types.test.ts` (expiry), `drawing.test.ts`,
  e2e `modes.spec.ts` (switching mode replaces the output, objects mode hides the backdrop and shows the drawing warped
  on the cube's left face, the preview draws grid and white, a 2 s pattern turns itself off, a preset switches
  mode). The mock server speaks the new shapes, `scene.mode` and pattern expiry.

## Editor B: two spaces, one screen (protocol §12, 2026-10-12)

The editor follows option B of `docs/research/editor-ux.md`. Guide: `docs/mapping.md`.

- **One route, two spaces.** `/editor/$space` (`map`, `content`, `automap`; `animate` opens map with the timeline
  open; `/editor` redirects to map). Switching spaces never remounts the editor, so the hub, the selection and the
  preview clock survive; **Tab** switches Map and Content.
- **Top bar**: scene, Map | Content, the editor preview (play, time, **wall follows**), **set up** (projector panel
  with the reference photo and test patterns, auto map, new scene from photo, devices), backstage | live, and the
  **wall** group (draft preview stop, test pattern and solo countdowns, what is on air, the wall's playhead, go, on
  air). The tools moved to the stage bar.
- **Editor preview clock** (`entities/scene/editor/preview.ts`, pure + hook). Space, L (loop), J/K (a frame; Shift a
  second), Home, the scrub on the transport bar. The stage, content views, PiP and thumbnails render at it. With
  **wall follows** the editor sends `show.seek` + `show.play`/`show.pause` (live) or `show.preview { draftId, t, play }`
  (backstage). Tools changed keys: line **E**, mask **M**; points step with **[ ]**.
- **Timeline** folds to the transport bar (play, loop, time, scrub with cue ticks, solo chip); open it for tracks,
  clips and cues. Layer tracks (`target.kind: "layer"`) take reveal and sweep clips from their ⋯ menu.
- **Solo**: S solos the selection on the stage (others at 15 %, `RenderInput.solo`), Shift+S also on the wall
  (`cmd show.solo`, fill from the stage bar's solo menu: grid, white or content), Esc ends both. `/out` and `/preview`
  draw `show.solo` until its `until` (server clock); the grid is a numbered test card drawn through each face's warp.
- **4-step rail** (`entities/scene/ui/rail`) replaces the coach: reference, faces, content, play; done steps light,
  clicks go there; the line under it says what to do next (and what an armed tool needs).
- **Edit face**: a button on each surface row, in the inspector and on the stage chip; **F**; double-click a face.
- **Content space** (`entities/scene/ui/contentView`): the object's atlas (`render/atlas.ts`, auto layout per §12,
  reproduces the fixture's dieline exactly), faces outlined and named, details inside parents, live render
  (`Renderer.renderAtlas`), face zoom (`renderAtlas` with a view frame, so details show in the face's own uv) with
  move / pen / line / rect / ellipse / text / erase (V, 1 to 6), layer handles (move, corner scale, rotate knob),
  **arrange faces** (drag rects with edge snapping, turn 90°), a draggable, collapsible PiP of the warped stage,
  [ ] to step faces, drop / paste / pick files → `/api/v1/assets` → media layer (on a face, or across the object with
  alt or between faces).
- **Content layers in the engine**: `shaders/content.ts` draws media (image cache or looping muted video) and gradient
  layers with fit, crop, offset, scale, rotation, opacity, blend and the reveal wipe; object layers render into an
  atlas target (≤ 2048 px) that each face samples through its rect affine; layer clips (`evaluateLayerClips`, hold
  semantics) drive reveal and sweep. `ready()` waits for layer media.
- **Templates** (`entities/scene/template.ts`): PNG and SVG of the atlas at its pixel size with outlines and names, a
  store-only ZIP of per-face PNGs (CRC-32 tested), import artwork → stretched object layer (warns on a size mismatch).
  Exporting or adding an object layer pins the auto atlas on the object.
- **Inspector**: content layer inspector (look, fit, crop, gradient stops, placement, reveal, wipe on / sweep clips),
  layer lists on faces ("pictures") and objects ("across the faces"), layer clip inspector (reveal/sweep, from/to).
- **Ops**: content layer add (creates the list), remove (drops the list with the last layer, as the server omits it,
  and the tracks that animate it), move; atlas set; deleting a face drops its atlas rect and its surface and layer
  tracks; deleting an object drops its tracks.
- Shared components: `Menu` can be controlled (`open`, `onOpenChange`), `TreeNode` takes an `action`; new icons
  download, solo, edit, pip.
- Tests: unit `render/atlas.test.ts`, `editor/preview.test.ts`, `scene/content.test.ts`, `template.test.ts`, layer
  clips in `timeline.test.ts`; e2e `content.spec.ts` (Space plays the preview and the server transport stays stopped,
  wall follows drives it; S and Shift+S solo with the server's `show.solo` and Esc; the white solo on `/out`; a dropped
  PNG becomes a media layer drawn red through the shelf's warp on `/out`; the template PNG is 618×609 and the zip
  holds the atlas and one PNG per face) and `mapping.spec.ts` (rail, Tab keeps the selection, the cube's three faces
  share edges in the unfold, edit face + drawing + [ ] + Esc).

## Show space, scenes, soundboard and video tiles (protocol §14, 2026-10-14, web show)

The editor now lands on **Show** (`/` and `/editor` redirect to `/editor/show`; `/editor/map`, `/editor/content`,
automap and animate work as before). The top toggle is **Show | Map | Content**.

- **Show** (`entities/show/ui/showSpace`) runs the wall without any mapping knowledge, with the phone's information
  architecture in the editor v2 look. It always shows and controls the **scene on the wall** (`show.activeSceneId`)
  and edits it live through its own `useSceneEditing(…, 'live')`, whatever the backstage switch says; Map and Content
  still follow `?scene=` (any scene). Layout: scenes and the wall on the left, the big live preview (the engine's
  `LivePreview`: active scene at the wall clock, test pattern, solo and the YouTube backdrop) with "● on air · detail",
  the format and (objects) the wall playhead, then the mode tabs (`ModeTabs`, red dot on the mode on air) and the
  mode's panel; soundboard and sounds on the right.
  - Opening a tab puts it on air (`replace /mode`); the tab follows the wall when another client switches it.
  - static: gobo tiles (thumbnails drawn once by the real engine, `showSpace/thumbs.ts`) + intensity, softness, angle,
    scale, colour (CCT kelvin/tint with the catalog presets, or HSI hue/sat) and light FX chips with speed.
  - live: the stack top first (thumbnail, blend/kelvin/opacity meta, up, down, eye, remove), add layer (live layers
    and gobos from the catalog), the selected layer's blend, opacity, motion params and light.
  - color: gradient tiles + drift, grain, brightness, angle.
  - scenery: category chips from the catalog plus **videos** (tiles from the `videos` channel; embeds use YouTube's
    hqdefault thumbnail and an "embed" badge), photo/video controls (blur, brightness, warmth, drift; videos: loop
    from/to, play its sound + volume), **add from YouTube** (`entities/video/ui/youtubeDialog`: live link check with
    `youtubeId()`, trim start/end as seconds or m:ss, quality 360p…4k default 1080p, the yt-dlp hint from
    `GET /videos/tools`, job progress from `import:{id}`) and **add video file** (MP4/MOV/WebM, upload progress).
  - objects: cue card (current and next cue, cue segments, progress through the cue, back / GO / stop, the cue's
    sound), objects with lit / waiting / off and ▸ reveal (seek to the first clip and play), backdrop under the
    objects (underlay on, from, level).
  - Single-choice picks use the new `pickOne` op (§10/§14): one layer that keeps the previous layer's id, its light
    (gobo) or blur/brightness/warmth/drift (photo or video, either way round).
  - Presets per mode as chips: apply, save (name inline), delete.
  - The wall: on air / blackout, master volume + mute and "sound plays on" projector | laptop | phone, all via
    `cmd show.audio`.
- **Soundboard** (`entities/sound/ui/soundboard`): the scene's pads in grid order (`Pad`: tone from the `--pad-*`
  theme tokens, glyph or name, key badge, loop icon, "missing sound"), click or key → `cmd sound.play { padId }`;
  looping pads show playing while in `show.audio.loops` (one-shots for their duration); stop all; add pad (pick a
  library sound or upload; picks a free key); pad editor dialog (name, key with clash warning, sound, volume, color,
  icon, loop, delete) writing leaf patches through the new ops `addPad`, `updatePad`, `removePad`, `movePad`,
  `padForKey`. `no_audio` answers toast "Nothing plays sound right now. Open /out on the projector computer and
  click it once."
- **Sound library** (`entities/sound/ui/soundLibrary`, in Show and as a **sounds** tab of the Map/Content library):
  upload (button or drop; WAV, MP3, M4A, AIFF, OGG) decoded first with Web Audio (`entities/sound/peaks.ts`:
  duration + 128 peaks sent as form fields, upload progress through `http.formProgress`), list with `Waveform` and
  duration, preview (`sound.play { soundId }`), rename, delete (asks). Rows drag as `sound:<sha>` onto the timeline's sound tracks.
- **Scenes** (`entities/show/ui/sceneSwitcher`): `useScenes` (the `scenes` channel, `GET /scenes` fallback) and
  `SceneList` / `SceneSwitcher`: on-air dot and "on the wall", put on the wall (`cmd show.activate`), new (empty, on
  the active setup, then rename inline), duplicate ("… copy"), rename (double-click or pen), delete (asks; disabled
  for the scene on the wall). In the top bar a row click opens the scene in Map/Content and activates it in Show.
- **Keys in Show**: a pad's key plays it, **Enter** (or **G** when no pad uses g) is GO; Space, Tab and the map keys do
  nothing there, so a stray key never moves the wall. Written in the left panel's hint.
- Shared components with demos on `/components`: `ModeTabs`, `Tile`, `Pad`, `Waveform`, `VolumeSlider`,
  `ProgressBar`; new icons (mode glyphs, speaker, the 11 pad glyphs, youtube, copy, arrowRight, keyboard); pad colour
  tokens in `theme.css`.
- `vite.config.ts` ignores `e2e/.results` so Playwright traces no longer full-reload open pages.
- Tests: unit `scene/show.test.ts` (picks keep id/light/photo controls, pads add/edit/remove/move/key) and
  `sound/peaks.test.ts`; e2e `show.spec.ts` (Show is the landing space; switching modes in Show changes `/out`
  pixels; a pad click and its key reach `/out`'s `__pmAudio.started`, the looping pad toggles via `show.audio.loops`,
  stop all; the no_audio toast; pad add/edit/delete patches; scene switcher create/rename/duplicate/activate/delete
  and Map editing a scene off the wall; YouTube link validation, embed fallback, video tile picked onto the wall with
  the YouTube backdrop in the preview; sound upload with browser-decoded duration and peaks). `editor.spec.ts` now
  opens `/editor/map`; `e2e/lib.ts` `waitForOutput` waits up to 60 s (an editor and /out rendering with SwiftShader
  in one browser start slowly on a busy machine).
- Left: the live stack reorders with up/down buttons (no drag); the pad grid has no drag reorder (`movePad` exists);
  the phone's "hold to reorder" is not reproduced.

## Sound engine, timeline sound, video layers and YouTube backdrops (protocol §14, 2026-10-14, web engine)

- **Hub** (`shared/lib/ws.ts`): `hub.onMessage(type, fn)` hears direct server messages (no channel) such as
  `sound.play` / `sound.stop`; caps are passed through to `hello` as before (`/out` and the editor now say `audio`).
- **Audio engine** (`entities/sound/audio.ts`): one AudioContext per page (`audioContext`, `unlockAudio`,
  `unlockOnGesture`, `onAudioState`), a buffer cache (`loadSound(sha)`: fetch `/a/{sha}`, decode once), and
  `AudioEngine`s with their own master gain: `playOneShot(sound.play)` (gain = msg.volume, loop), `stop({ playId? |
  padId? })` (neither = every one-shot, not the timeline), `syncTimeline(planner)` that starts timeline clips with
  `AudioBufferSourceNode.start(when, offset, duration)` and the fades as linear gain ramps, keeping a voice that already
  plays the same clip within 30 ms (so show updates do not glitch), and `setMaster(volume, muted)` live.
  Test hook `window.__pmAudio = { unlocked, started[], stopped[] }` (every source start and stop).
- **Scheduling math** (`entities/sound/audioSchedule.ts`, pure, unit-tested): sound clips of sound tracks,
  `planClips(scene, playhead, { until, fileDuration, mutedTracks, horizon })` → delay, file offset
  (`offset + (t − start)`), duration (cut at the next hold cue, the end of the timeline or the end of the file) and
  the exact gain breakpoints (`clipEnvelope`, including where overlapping fades cross); `holdPoint` (backend §9).
- **Hooks** (`entities/sound/audioHooks.ts`): `useAudioClient(hub, { role, enabled })` plays `sound.play` /
  `sound.stop` and the active scene's timeline on the server clock (playing transports only, re-planned on every show
  or scene change and clock sync) while `show.audio.output` names the role (projector → output, editor → editor,
  phone → remote); one-shots that arrive while the browser still blocks sound are dropped, not played late.
  `usePreviewAudio(scene, preview, { muted, mutedTracks })` plays the editor preview's sound clips locally (re-plans on
  play, pause, seek and loop wraps). `useAudioUnlocked()`, `useSoundList(hub)`.
- **/out** says caps `render` + `audio`, runs the audio client, shows **click to enable sound** (bottom centre pill)
  until its context runs while it is the audio output (hidden with `?headless=1`; any click on the page unlocks it),
  and unmutes an `asset:` video layer with `params.audio` at volume × master. **/preview** never plays sound.
- **Video layers in the engine**: kind `video` with `asset:<sha>` is a looping muted video texture drawn exactly like
  a photo (cover, blur, brightness, warmth, drift) inside the loop window `start…end`; `youtube:<id>` draws nothing.
  Renderers created with `transparent: true` (/out, /preview, `LivePreview`, `OutputView`) clear to transparent only
  while a YouTube layer shows (`render/youtube.ts activeYouTube`: the lowest visible one of the drawn stack, also as the
  objects-mode underlay); backdrop blends then keep coverage in alpha, the underlay level, master and blackout dim
  the player through the canvas alpha, test patterns and outlines stay opaque. Every other frame is byte-identical.
- **YouTubeBackdrop** (`entities/video/youtube.tsx`): the youtube-nocookie embed (muted, looping, no controls,
  start/end) behind the canvas, covering the frame (16:9 scaled up plus a blur margin), turned and flipped like the
  output on /out, CSS blur and brightness plus a multiply warmth tint, layer opacity, no pointer events
  (`data-testid="youtube-backdrop"`).
- **LivePreview** (`entities/output`, used by Show): exactly what the wall shows (active scene or previewed draft at
  the wall clock, blackout, test pattern, solo, YouTube backdrop). `useWallDocs(hub)` is shared with /out.
- **Timeline**: "sound" in + track; sound clips show the sound's name and the part of its waveform they play; drag
  and trim like other clips but only between sound tracks; drop a library row (`sound:<sha>`) on a sound track (the
  clip takes the sound's length); a sound track's ⋯ menu adds any library sound at the playhead; a speaker toggle on
  the transport bar mutes the preview sound (remembered in localStorage). Cue menus get "edit cue": the **cue
  inspector** (label, time, follow on, play a sound on GO with volume, clear). The **sound clip inspector** picks the
  sound, file offset, volume, start/end, fades and "fit the clip to the sound". Video layers get their params from
  the catalog `videoParams` (fallback built in) plus a note on what YouTube can't do.
- Ops (`scene/ops.ts`): `soundTrack`, `firstSoundTrack`, `soundClip`, `addSoundClip` (makes a sound track when there
  is none), `setClipParams`, `setCueSound`.
- Contract test decodes `sound.json`, `video.json`, `import.json`, the `sound.play` / `sound.stop` messages, the
  `sounds` / `scenes` / `import:` snapshots and the `sound.play`, `sound.stop`, `show.audio` command args.
- Tests: unit `sound/audioSchedule.test.ts`, `video/youtube.test.ts` (link parser, refs, embed URL, the active
  YouTube layer, CSS look), sound ops in `scene/ops.test.ts`, the hub's `onMessage`; e2e `sound-video.spec.ts` (the
  preview schedules `clp_rain` 2 s ahead at file offset 0.5; the sound clip inspector; the cue sound edit; a YouTube
  layer gives /out an iframe and a see-through canvas that blackout closes; /preview shows it too; the click to
  enable sound overlay; an uploaded WebM video layer draws on /out) and `sound-autoplay.spec.ts` (Chrome with
  `--autoplay-policy=no-user-gesture-required` as `projmap open --out` runs it: REST pad press reaches /out, the
  looping pad toggles, library sound + stop all, `no_audio`, GO plays the cue sound and schedules the rain clip on the
  wall clock, stop silences it).
- Left: video layer sound plays on /out only (as §14 says); YouTube players are always muted and their loop is the
  player's own (not frame-locked to anything); one-shots play on the context clock as they arrive (no server
  timestamp to align them); the editor stage (objects mode) does not show a YouTube underlay.

## Mock server

`frontend/dev/mock-server.mjs` implements protocol §2/§3 well enough for the UI (fixtures, JSON Patch, param
coalescing, stale rejects, drafts with ack + snapshot, scripted agent sessions, scripted calibration that drives the
output's `output.pattern`, assets in memory, `show.solo` with expiry and `show.preview`). Test hooks: `/__mock/log`, `/__mock/state`, `/__mock/rpc`,
`/__mock/reset`. It is a dev tool, not the product.

§14 in the mock (listed at the top of the file): scene create/duplicate/rename/delete (409 `scene_active`) and the
`scenes` channel; `show.audio` (cmd and POST) with `loops`; the sound library (two generated WAVs under the fixture
shas, uploads keep the `duration`/`peaks` form fields) and the `sounds` channel; `sound.play` / `sound.stop` (cmd and
REST) routed to connections with cap `audio` whose role matches `show.audio.output`, `no_audio`, looping pads that
toggle, the cue sound on `show.go` (GO now follows backend §9: from stopped it starts cue `cue`); videos
(upload, rename, delete, `tools`, YouTube import with the embed fallback by default; `MOCK_YTDLP=1` or
`POST /__mock/tools {ytdlp}` runs a download job with progress on `import:{id}`) and the `videos` channel. Extra
hooks: `POST /__mock/send {role?, cap?, t, d}` and caps in `/__mock/state`.

## What's left / approximations

- Looks are judged against the boards, not pixel-compared; no golden-image tests yet.
- Clips have no name field, so a clip shows its effect name (or `params.label`). Track eyes mute locally only.
- The editor preview loops on its own clock; with **wall follows** the wall gets seek + play and is not frame-locked
  to the editor. Videos in media layers play on their own clock (not the playhead), so renders with video are not
  deterministic.
- Surface layer handles show in the face view only (not on the unfold); details are placed by their corners in the
  parent's uv (exact for quads, bounding box for circles and polygons). Undo in backstage is not available (discard the draft instead).
- Content textures are always 1024 on the longest side; JS effects show one frame late live.
- The editor is desktop only (min width 1100 px). The phone app is native and not part of this folder.
- The ambient clock wraps hourly (one jump per hour in backdrop motion) to keep shader floats precise.
- Bezier warp uses Catmull-Rom through the mesh points rather than separate bezier handles.
