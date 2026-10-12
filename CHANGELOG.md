# Changelog

All notable changes to projmap. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
versions follow [Semantic Versioning](https://semver.org/). `scripts/release.sh` moves the Unreleased notes into a
version section, and the release workflow uses that section as the GitHub release notes.

## [Unreleased]

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
