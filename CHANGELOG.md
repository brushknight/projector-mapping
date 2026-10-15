# Changelog

All notable changes to projmap. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
versions follow [Semantic Versioning](https://semver.org/). `scripts/release.sh` moves the Unreleased notes into a
version section, and the release workflow uses that section as the GitHub release notes.

## [Unreleased]

### Focus, lens and background layers

- **Two focus rings, sharp by default.** "Attachment focus" sharpens the plates, "background focus" the colour,
  gradient or effect under them (in live: "live layer focus" for the live layers). Both start at 100 %, and at 100 %
  nothing is blurred.
- **Background layers in static.** Put a colour, gradient, animated colour or effect under the window: the Show static
  panel has a gallery for attachments and for backgrounds, with try before add, and a stack card that reads
  attachments on top, background below, each with its focus.
- **Settings stay put.** Picking another attachment keeps its place, size, turn, motion and the light; applying a
  preset keeps your focus, fringe, vignette and slide.
- **Lens.** Vignette is off by default; colour fringe stays; dust and haze is gone.
- **Instant slide.** Drags show in the preview the next frame and go to the server at about 60 Hz.

### Sharper, cleaner output

- **Sharp plates on a projector.** The light's mask rendered at most 1280 px wide and was stretched up to the
  1920 px output, and focus 1 still blurred it a little, so blinds and figures looked soft and stepped. The mask now
  renders at the output's full size, focus 1 means no blur, plate masks are 4096 px on a projector (2048 px in
  previews) with trilinear and anisotropic filtering, and enlarged plates keep a one-pixel anti-aliased edge.
- **No more specks.** Dust and haze are gone from the light (they drew dark motes and moving grain over the
  picture). Plates no longer wrap at their edge unless tiled, and the colour fringe never samples past the mask's
  edge. A test renders every attachment at sharp focus and fails on isolated dark pixels.
- **Window drags stay fast.** Dragging a window's geometry draws a quick draft and redraws it at full size once
  the value holds.

### Controls

- **The wheel only scrolls.** Sliders, the hero slide, the motion path handles and the timeline scrubbers no longer
  move when you scroll the mouse wheel after a drag: a control only drags while a button is down, a drag ends when
  the pointer is released, cancelled or loses capture, and a pointer press leaves no keyboard focus behind (arrows
  still work after Tab).

### Output windows

- **Put on projector.** The editor (Show preview and Set up) lists the displays attached to the Mac and opens the
  output on the one you pick full screen in a Chrome app window: no address bar, its own Chrome profile, sound
  allowed. The window moves onto the display through the Accessibility API, so it lands right even on a projector
  placed above or left of the main display, and the page goes full screen there by itself, no click. projmap checks
  the output measures exactly that display's pixels before it says it worked. New local-only endpoints `GET /api/v1/outputs/displays` and `POST /api/v1/outputs/launch`;
  `projmap open --out` shares the code.
- **Full screen on the viewer and the output.** The first click goes full screen, double-click and F switch it, Esc
  leaves. A "click for full screen" hint shows for 3 s, and the cursor and the viewer's bar hide after 2 s at rest.
  This hides Chrome's address bar, which a pop-up window keeps even in macOS full screen.

### Reference plates and parametric windows

- **Only the plates from your reference photos.** The attachment library is now 55 metal plates, each following one
  of the photos in `design/refs/gobo-plates` (its source names the photo): the 20 Amaran MO05 to MO24 replicas, and
  new plates from set A (moon and stars, bonfire, eight point stars, leaf breakup), set 2 (breakup, cracked branches,
  rainbow arch, hearts, radial burst, vine leaves), set 3 (starburst cross, stardust, stars, slit, tree with leaves,
  swirl), set 4 and set B (bubbles, squiggles, circle, dots, jungle, radial, maze, snowflake field, big snowflake,
  and the windows). Designs that repeat across sheets appear once. The invented attachments are gone: the 33 shader
  attachments and the 23 original plates.
- **Groups**: windows, nature, sky, patterns and beams, taken from the catalog on the web and the phone.
- **Windows you can reshape.** The 6-pane grid, arched, palace, skewed, setting sun, slanted, tall grid, diamond
  lattice and window grid III windows, the blinds, slat blinds and the fine-lines plates are presets of one
  parametric window. The attachment card's **window** section (and the phone's) adjusts sashes, columns, rows, pane
  gap, width, height, frame and mullion width, an arch with its height, spokes and hub, a round outline, perspective
  (top width, right height, slant, rise), a diamond lattice with its density and inner squares, and slats with their
  width and direction; **reset to preset** puts the preset back.
- **Older scenes move on their own.** On start the server moves every removed attachment to the closest plate or
  window preset (a 4-pane window becomes the grid window with one sash of 2 × 2 panes, blinds keep their slats) and
  logs each move. Catalog version 6, scenes and presets carry `format: 6`; protocol §16.
- **For agents**: `catalog_get` lists the plates with their category, source and window geometry, and
  `attachment_add` and `gobo_set` take window params.

### Live gallery

- **Live layers as a gallery.** The Show live panel shows every live layer (tree sway, palm sway, clouds, rain on
  glass, caustics, dapple, film grain, haze, lightning, day cycle, sun drift, candle) as an animated tile, drawn by
  the real engine with one shared renderer. Tap a tile to try it full size in the preview without putting it on air,
  then add it to live or cancel.
- **Live layers block light like attachments.** Trees, palms, clouds, rain and the textures start as masks over the
  light (blend multiply), so the focus ring softens them like a gobo; adding one to a live stack without a light adds
  the light.
- **More natural motion.** Trees and palms move with one smooth wind: slow swells, gusts that build and release, tips
  moving more than boughs, and every leaf turning on its own stalk. Boughs keep an even width. Clouds billow and
  drift in two layers with soft edges and clear gaps of sun. Raindrops meander instead of shivering.
- **Animated strips for the phone.** `npm run thumbs` renders a looping 36 frame strip of every live layer
  (`/catalog/thumbs/<id>-anim.jpg`) for the phone's live gallery, and `/preview?try=<id>` previews a layer on the
  phone's hero without putting it on air.
- **Add a live layer** in a few steps: `docs/guides/live-layers.md`.

### Video sound and brightness

- **YouTube loops play their sound.** Turn on **sound** on a video layer (files and YouTube) and set its volume: it
  plays on the audio output only (`/out` by default, the editor's wall preview when the output is the editor), at
  the layer volume times the master, and master mute silences it. The YouTube player unmutes over the IFrame Player
  API; if the browser blocks sound, `/out` asks for one click. Previews and thumbnails stay muted.
- **Brightness 100 % is the original picture.** Photo and video brightness no longer multiplies by 1.4, so 100 % no
  longer clips colours, and warmth never lifts a channel above its original value. New layers start at 90 %; stored
  scenes and presets scale their brightness by 1.4 (up to 100 %) once, so they look as before.

### Static light like a real spotlight

- **The light model.** In static and live mode the projector is a spotlight: the light lights the whole frame (16:9
  or 9:16), attachments in front of it block light and multiply as you add them, and one focus ring softens the
  whole picture. Existing scenes upgrade on their own: their gobo becomes an attachment and its softness the focus.
- **Attachments** have throw (low sun stretch), keystone and frame depth (the soft double edge); the lens adds colour
  fringe and vignette. Research notes with sources: `docs/research/gobos.md`.
- **Real thumbnails** rendered by the engine at build time and served at `/catalog/thumbs/<id>.png`, in a browser
  by category on the web and the phone.
- **Metal gobo plates**, drawn as vectors and rasterized into a mask so focus, rotation, scale and throw work as on
  every attachment, each with the tie bridges a real steel plate needs. A plate projects a round light field; its
  **light field** control fills the frame, stretches to it or tiles across it instead. Plate tiles show the metal
  plate itself, or the light it projects. `docs/guides/static-light.md` says how to add a plate.
- **Animated colour.** The light can carry a gradient gel or an animated colour (hue cycle, colour flow, colour
  pulse, aurora, daylight cycle); the color tab offers them too. New generators are one GLSL function each
  (`docs/effects.md`).
- **Frame slide.** Pan the whole picture inside the frame with a slider or by dragging the preview sideways.
- **Motion.** Move the light, one attachment, or a photo or video across the wall on the server clock: presets (sun
  passes left to right or right to left, slow drift, sway, rise, set), a mini path editor, speed from seconds to
  hours, easing, once, loop or back and forth, and turn, size and warm to cool drifts. Timeline clips can drive it.

### Scenes by kind

- Every scene has a kind (static, live, colour, scenery, mapping). Putting a scene on the wall puts its kind on air
  and opens the matching controls.
- The show space lists scenes grouped by kind with filter chips and live animated thumbnails; hover one for a quick
  animated preview that leaves the wall alone, with **put on the wall**. New scenes start from templates (a golden
  4-pane window with the sun pass ready, a window with a swaying tree, a mapping scene with the reference step). The
  phone groups its scene picker the same way and previews a scene on a long press.

### The viewer

- **open viewer** (top bar, show preview, set up) opens `/view` in its own 16:9 (or 9:16) window: exactly what the
  projector shows, read only, with a hover bar (scene, mode, sound, fullscreen, close).

### A simpler content space

- A clear title ("zimacube · right face"), breadcrumbs, a "where you are" mini map, an empty state with add picture,
  draw and add effect, labelled tools with tooltips, a one-time tour (replay with ?), and rarely used controls under
  **more**. Show is the home; content is reached on purpose.

### Agents change the wall live

- New MCP tools for the backdrop side: `catalog_get`, `scene_list`, `scene_create`, `scene_activate`, `mode_set`,
  `light_set`, `attachment_add`, `attachment_update`, `attachment_remove`, `gobo_set`, `backdrop_set`, `motion_set`,
  `preset_apply`. With **agents edit live** on (set up), they change the wall, the viewer and the phone at once.

### Fixed

- **Live layers look still in the web previews.** The tree and palm sway moved a few pixels at preview size and the
  layer and scene thumbnails were drawn once; tree and palm sway now bend the real leaf and palm shapes from the trunk
  and crown, scene thumbnails animate, and every preview takes the server clock for motion.
- **The phone's hero preview stayed on the stand-in** after one failed load (first launch, Wi-Fi rejoining, server
  restart). It now retries, reloads on return to the app and when the connection comes back.
- **Scrolling the phone changed sliders.** Horizontal controls now start only on a clearly sideways drag.

### Run the show from the editor

- **Show | Map | Content.** The editor opens on a new **show** space that runs the wall like the phone does: a big
  live picture of exactly what the projector shows, the mode tabs (static, live, color, scenery, objects) that switch
  what is on air, gobo tiles with light, colour and effects, the live layer stack, gradients, scenery photos and
  videos, cues with GO, back, stop and per-object reveal, presets per mode, on air and blackout, and the soundboard.
- **Several scenes.** A scene switcher in the top bar, the show space and every phone tab creates, duplicates,
  renames, deletes and activates scenes; the one on the wall is marked.
- **Fixed:** a fresh server restarted before any show change no longer loses its active scene.

### Sound effects

- **Your sounds.** Upload WAV, MP3, M4A, AIFF or OGG files to a sound library with length and waveform; rename and
  delete them.
- **Soundboard.** Each scene has pads with a name, a sound, a volume, a colour or icon and an optional key; loop pads
  toggle. Play them from the editor, the phone or MCP (`sound_play`).
- **Sound on the timeline.** Sound tracks with clips (offset, volume, fades) play in sync with the picture, and a cue
  can play a sound on GO. The editor's preview plays them too, with a mute button.
- **Audio output.** The projector computer plays by default (Web Audio; `projmap open --out` lets Chrome play
  without a click, otherwise `/out` asks for one). Switch the output to the editor or the phone, set the master
  volume and mute.

### Video loops

- **Video backdrops.** Scenery loops a video file (MP4, MOV, WebM) with the photo controls: blur, brightness,
  warmth, drift, plus a loop window.
- **From YouTube.** Paste a link in the editor or the phone. With yt-dlp installed the server downloads and trims it
  to a local file; without it the loop plays as an embedded YouTube player behind the picture.

### Editor: two spaces, one screen

- **Map | Content.** Tab switches between the stage (place the faces) and the content space: the selected object
  unfolded like a dieline, its faces edge to edge at real proportions with details inside them, rendering live. Double
  click a face, press F or **edit face** to work on it alone; [ and ] step through faces. A live picture of the warped
  stage sits in a corner.
- **Preview without touching the wall.** The editor has its own playhead: Space, L (loop), J/K, Home and a scrub bar
  under the stage in both spaces. The wall only follows it with **wall follows** on (in backstage it previews your
  draft). The wall's own controls (mode, its playhead, go, on air) sit apart in the top bar.
- **Pictures, videos and sweeps on faces.** Drop, paste or pick an image or a video onto a face, or across the whole
  object so it runs on across shared edges. Move, scale and turn it with handles; set fit, crop, opacity, blend and a
  reveal wipe. A gradient **sweep** runs a band of light across every face; timeline layer tracks animate reveal and
  sweep.
- **Templates.** Save the unfold as a PNG or SVG at its true size (or each face in a zip), paint on it, and import the
  artwork back onto the faces.
- **Solo.** S shows only the selection on the stage; Shift+S also on the wall for 60 s as a numbered grid through each
  face's warp (or white, or its content). Esc ends it.
- **Simpler layout.** A 4-step rail (reference, faces, content, play) replaces the tips panel; **set up** holds the
  projector, reference photo, auto map and devices; the timeline folds into the transport bar; the tools moved onto
  the stage bar. Line is now E and mask M; [ and ] step through points.

### Agents draw on faces (MCP)

- **Read the unfold.** `object_unfold_get` and `face_get` give each face's atlas rect and rotation, real aspect, corners,
  edges with the face across each, details in the face's UV, and its layers and drawings, with the UV convention
  spelled out.
- **Look flat.** `face_render` and `object_unfold_render` render faces and the whole unfold from the agent's draft
  in the editor or `/out` (new `render.face` and `render.unfold` RPCs), with a built-in fallback when no browser is
  open. `face_template_get` draws templates with outlines, a UV grid, corner numbers and details.
- **Draw.** `face_draw` writes strokes into named drawing layers ("bays", "logo"), `face_drawing_clear` removes them,
  `object_draw` draws across the unfold in atlas pixels, `layer_add`, `layer_update` and `layer_remove` place pictures
  and gradients, and `asset_upload` stores PNG, JPEG or SVG pictures.
- **Apply.** `draft_apply` puts the agent's draft on air when the new **agent may apply its drafts** toggle is on (off
  by default). Proposals from Claude Code or Codex sessions started outside the editor now show in the agent panel.
- **Guidance.** The `dress-object` prompt and the `docs://drawing` resource walk an agent through drawing a real
  device's details on its faces.
- Drawings take two more tools, `circle` and `polygon`; SVG pictures render on faces.

### Protocol (§13)

- Surface effect instances take an optional `name`; the `drawing` strokes take `circle` and `polygon`; settings
  take `agentMayApply`; the `render.face` and `render.unfold` RPCs; SVG assets are served as `image/svg+xml`.

### Protocol (§12)

- `surface.layers` and `object.layers` (content layers: media and gradient), `object.atlas`, track target `layer`
  with `reveal` and `sweep` clips, `show.solo` with `cmd show.solo` (expires like test patterns), and `cmd
  show.preview`. The server validates them; older scenes load unchanged; the iPhone app decodes them.

## [0.1.0] - 2026-10-11

The first release: one Go server with the web app embedded, the iPhone app built from source, and MCP for Claude
Code and Codex.

### Server (`projmap`)

- One binary with the React app embedded. Serves HTTP, the `/ws` WebSocket hub and MCP on port 7400, stores
  everything in SQLite plus content-addressed asset files in one data folder, and advertises `_projmap._tcp` over
  Bonjour.
- Scenes as versioned JSON documents with an op log, undo and redo, history, drafts (backstage) with rebase on apply,
  and presets. A scene has five modes, exactly one on air: static, live, color and scenery (each with its own layer
  stack) and objects (the mapped objects and timeline, with an optional dimmed backdrop underlay). Slider drags are
  forwarded at once and committed 200 ms after the last move.
- Show control on the server clock: on air and blackout, play, pause, stop, seek, cues with hold and auto-follow,
  and GO.
- Pairing with a 4-character code (5 minutes, one use), device tokens with roles, and one-time editor login links
  for other machines.
- Commands: `serve`, `open` (editor, or `--out` for a Chrome kiosk window on a display), `pair`, `mcp` (stdio
  bridge that starts the server when needed), `sim` (fake phone camera and projector), `install` (launchd login
  item), `version`.
- Gray-code calibration from the phone camera to a dense camera to projector map, planar surface detection,
  surfaces from camera points, and alignment checks.
- MCP: tools to read the scene, look at renders and camera frames, write to a draft, and submit a proposal;
  resources and prompts for effects and house style. Preview on the projector and going live each need a toggle in
  the editor, both off by default.
- Agent runner: start Claude Code (`claude -p`) or Codex (`codex exec`) from the editor or the phone, with the event
  log streamed back.

### Web (`/out`, `/editor`, `/preview`, `/components`)

- WebGL2 renderer shared by the projector output, the editor stage, the phone previews and agent renders: backdrop
  layers (gobos, procedural live layers, gradients, scenery photos), light colour (CCT and HSI), softness, light FX,
  mapped surfaces (quad, tri, poly, circle, line, mesh, mask, details), GLSL and JS effects, timeline clips with
  fades, orientation, flips, master, blackout fade and test patterns (which turn off after 60 seconds).
- `/out`: fullscreen output with a pairing screen, wake lock, fps telemetry and the calibration patterns.
- `/editor`: map, animate and auto map workspaces; drawing tools, shared points, mesh warp, loupe, reference photo,
  inspector, timeline with cues, backstage or live editing, and the agent panel. A flat view of one surface to draw
  on it (pen, line, rectangle, ellipse, text), saved as a `drawing` effect that a clip can reveal.

### iPhone app (build from source)

- Native SwiftUI app for iOS 26: connect over Bonjour, a typed address or a QR code; static, live, color, scenery and
  objects tabs; presets; projector setup; GO and blackout with haptics; auto map with the camera; send a prompt to
  Claude or Codex.

[Unreleased]: https://github.com/brushknight/projector-mapping/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/brushknight/projector-mapping/releases/tag/v0.1.0
