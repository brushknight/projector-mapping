# Changelog

All notable changes to projmap. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
versions follow [Semantic Versioning](https://semver.org/). `scripts/release.sh` moves the Unreleased notes into a
version section, and the release workflow uses that section as the GitHub release notes.

## [Unreleased]

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
