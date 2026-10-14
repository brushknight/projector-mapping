# MCP plan: letting Claude and Codex map and animate

> Working name `projector-map`. The final product name will replace it.

## The idea

You do the part only a human can do: aim the projector and place the outlines of the real objects in the laptop editor. After that, an agent (Claude Code, Codex, or any MCP client) does the creative work. It reads the geometry, writes effects, places clips on the timeline, renders frames, and checks the result against a camera photo of the real wall. Then it hands you a proposal you can preview, apply or discard.

The agent never touches the live output directly. Everything it does lands in **backstage**, a draft copy of the scene. Only you, or an explicit permission you grant, move it on air.

```
 iPhone remote ─┐                       ┌─ projector page (/out, fullscreen)
                │   WebSocket bus       │
 laptop editor ─┼──── local server ─────┤
                │   scene store (JSON)  │
 MCP server ────┘   + history + drafts  └─ render worker (headless, same engine)
   ▲
   └── Claude Code / Codex (stdio or streamable HTTP)
```

The MCP server is a thin layer over the same scene store the editor and the phone use. It does not keep a second copy of the truth.

## Scene model (what the agent reads and writes)

```ts
Scene {
  id, name,
  output: { width, height, orientation: 'landscape'|'portrait-cw'|'portrait-ccw', flipH, flipV },
  reference?: { photoId, takenAt },            // phone photo from the lens position, never projected
  calibration?: { cameraToProjector: Mat3 },   // homography from the camera pass, enables "real view" checks
  objects: [{
    id, name, tags,                            // "zimacube", tags: ["nas", "hero"]
    surfaces: [{
      id, name, kind: 'quad'|'tri'|'poly'|'circle'|'line'|'mesh'|'mask',
      points: [{ id, x, y }],                  // output pixels; shared ids weld faces together
      uv?: [{ u, v }], mesh?: { cols, rows, bezier },
      role?: 'face'|'edge'|'detail'            // detail = hdd bay, cpu, fan
    }]
  }],
  effects: [{ id, name, kind: 'glsl'|'js', params: JSONSchema, source }],
  timeline: {
    duration,
    tracks: [{ id, target: surfaceId|objectId|'all' }],
    clips:  [{ id, track, effect, start, end, params, fadeIn, fadeOut }],
    cues:   [{ id, at, label, autoFollow }]
  }
}
```

Every write is a patch on this model. Patches are versioned, so every agent action can be undone and diffed.

## Effect contract (so agents can write new effects)

An effect is a small piece of code that draws inside one surface's UV space. The engine handles the warp onto the real object, so an effect never has to know about perspective.

- **GLSL** (preferred, fast, safe): a fragment shader. Uniforms: `u_time`, `u_progress` (0..1 within the clip), `u_resolution`, `u_params.*`, plus `u_edgeDist` (distance to the surface border, for line effects) and `u_neighbors` (which edges are shared with other faces).
- **JS** (for particles, text and logic): `render(ctx, { t, progress, surface, params })` running in a worker with an OffscreenCanvas. It has no DOM access and no network.

The built-in effects (grid build, trace, scan, glitch, fill, particles, label, pulse) are written with the same contract. Agents can read them as examples.

## Tools

### Read
| tool | returns |
|---|---|
| `scene_get` | the full scene summary: objects, surfaces, timeline, output size and orientation |
| `surface_get(id)` | points, edges, shared points, area, centroid, edge lengths, which faces touch it |
| `reference_photo_get` | the photo taken from the lens position (image) |
| `effects_list` | the effect catalog with parameter schemas |
| `effect_source_get(id)` | the effect's source, to learn from or fork |
| `timeline_get` | tracks, clips and cues |

### Look (this is what makes it "real")
| tool | returns |
|---|---|
| `output_render(t, draft=true)` | a PNG of exactly what the projector would show at time t |
| `output_render_strip(from, to, fps)` | a contact sheet of frames, to judge motion without video |
| `camera_capture` | a photo of the real wall from the iPhone (the phone shows a capture prompt) |
| `camera_compare(t)` | renders frame t, projects it in backstage preview, captures it, warps it with the calibration and reports misalignments per surface in pixels |
| `calibration_run` | projects structured patterns, captures them with the phone and stores the camera-to-projector homography |

### Write (backstage only)
| tool | effect |
|---|---|
| `surface_create / surface_update / surface_nudge` | edit geometry. Nudges are small fixes found via `camera_compare` |
| `effect_create(name, kind, source, params)` | compiles the effect and returns compile errors and a test render |
| `effect_update(id, source)` | iterate on an effect |
| `clip_add / clip_update / clip_remove` | place effects on the timeline |
| `cue_add / cue_update` | cue flags that the phone's GO steps through |
| `draft_diff` | a human-readable summary of what changed |

### Hand-off and control
| tool | effect |
|---|---|
| `proposal_submit(summary)` | shows the proposal card in the editor's agent panel (apply / preview / discard) |
| `preview_on_projector(from, to)` | plays the draft on the real projector. **Needs the "agent may preview" toggle** |
| `transport(play / stop / go / blackout)` | live control. **Needs the "agent may go live" toggle (off by default)** |

### Dress an object: draw on the flat faces (implemented)

The agent draws a real device's details (drive bays, fan grille, logo, LEDs, panel seams) on each face of a mapped object, flat and unwarped, in the face's own UV; the renderer warps it onto the wall. Face UV: (0,0) is the face's first point (corner 1), u runs toward corner 2, v toward the 3rd and 4th points, both 0..1 of the face's flat width and height. Stroke widths and text sizes are in the face's scene pixels.

| tool | does |
|---|---|
| `object_unfold_get(object_id)` | the atlas (size, stored or auto layout) and per face: rect and rotation, sizePx and aspect, corners in order (point id, scene px, uv, atlas px), edges (top, right, bottom, left) with the face across each and whether they touch in the atlas, details with their box in the face's UV, content layers and drawing layers |
| `face_get(surface_id)` | the same for one face, plus every drawing layer's strokes and the UV and stroke conventions |
| `face_template_get(surface_id \| object_id)` | a template image drawn by the server: outlines, a 0/.25/.5/.75/1 grid with ticks, corner numbers, u and v arrows, dashed named details, neighbours |
| `face_render(surface_id, t?, with_outline?, size?)` | the face flat at its aspect (at most 1280 px), from the agent's draft, rendered by the editor or `/out` through the `render.face` RPC; without a browser, a built-in approximation (drawings, gradients, PNG/JPEG pictures) that says so |
| `object_unfold_render(object_id, t?, size?)` | the whole unfold through `render.unfold`, with face names and corner marks |
| `face_draw(surface_id, strokes[], mode: append \| replace, layer_name?)` | strokes (pen, line, rect, ellipse, circle, polygon, text) into a named `drawing` layer on the face, validated with errors that say how to fix them |
| `face_drawing_clear(surface_id, layer_name?)` | removes one drawing layer, or all of them |
| `object_draw(object_id, strokes[], mode, layer_name?)` | strokes in atlas px across the unfold, split onto each face they cross as that face's drawing layer (no object level drawing in the data model, so this is how a line runs on across a shared edge) |
| `layer_add(target_kind, target_id, kind, …)` / `layer_update(layer_id, …)` / `layer_remove(layer_id)` | media and gradient content layers on a surface or across an object (protocol §12); an object layer pins the auto atlas |
| `asset_upload(data_base64 \| path)` | PNG, JPEG or SVG (base64, or a file under the home folder on this Mac), at most 16 MB, returns `asset:<sha>` |
| `draft_apply(summary?)` | applies the agent's draft. **Needs "agent may apply" (`agentMayApply`), off by default** |

Resource `docs://drawing` explains face UV and strokes with a worked example (four drive bays on the right face). Prompt `dress-object(objectId, device)`: read the unfold, get the templates, draw details per face in named layers, render, compare, iterate, then `proposal_submit`.

### Resources and prompts
- Resources: `scene://current`, `effects://catalog`, `docs://effect-api`, `docs://style-guide` (house style: tron-like lines, pixel stepping, black and white plus one accent), `docs://drawing`.
- Prompts: `animate-object(object, mood, duration)`, `reveal-sequence(objects[], duration)` and `dress-object(objectId, device)`. These are starters that make the agent call `scene_get`, then `reference_photo_get`, and then look before writing.

## The agent loop

1. `scene_get` and `reference_photo_get`, to understand what's there and what it looks like.
2. `surface_get` for the hero object, to get edge lengths, shared corners and details (bays, cpu, fan).
3. Write or fork effects (`effect_create`), then `output_render` to check each one alone.
4. Place clips and cues, then `output_render_strip` to check the motion.
5. `camera_compare` on key frames: fix spill and misalignment with `surface_nudge`.
6. `proposal_submit`. You preview on the projector, then apply, or ask for changes in the agent panel.

## Safety and control

- **Drafts by default.** The agent edits a backstage copy, and live output is untouched until you apply.
- **Three explicit toggles** in the editor: "agent may preview on projector", "agent may go live" and "agent may apply its drafts". All are off by default.
- **Sandboxed effects.** GLSL only reaches the uniforms. JS runs in a worker with no DOM or network, and a frame-time budget kills runaway code.
- **Undo for everything.** Every agent patch is one history entry with its own diff.
- **Local only.** The MCP server binds to localhost (stdio for Claude Code and Codex). Phone pairing uses a one-time code, as in agents-deck.

## Auto map: phone on a stand plus an agent

Flow (phone screens "auto map 1–4", editor workspace "auto map"):

1. **Mount.** The phone sits on a stand next to the projector and streams its camera to the laptop. The app checks that the phone is steady, the projected 16:9 area is in frame and the room is dim.
2. **Calibrate (about 20 s).** The projector flashes Gray-code stripe patterns, vertical then horizontal, and the phone captures each one. Decoding them gives a **dense camera ↔ projector pixel map**, so every camera pixel knows which projector pixel lights it. This works on 3D objects too; a single homography would only be exact on a flat wall.
3. **Detect.** The server proposes candidate surfaces from the camera frame: edges, planar regions and corners. They show as dashed outlines with labels.
4. **Ask.** On the phone or in the editor you say what to map: "the three faces of the zimacube, the 4 drive bays and the fan". You pick Codex or Claude.
5. **The agent maps.** It looks at camera snapshots, picks corners in *camera* pixels, and `surface_create_from_camera` converts them to projector pixels through the calibration map. It then projects the outline, takes a new snapshot, measures the error and nudges, repeating until the error is under about 1 px.
6. **Keep or fix.** You keep the result, or fine-tune it in the laptop editor.

Extra tools for this:
| tool | does |
|---|---|
| `camera_stream_status` | whether the phone is connected, its resolution, fps, latency and steadiness |
| `camera_snapshot(exposure?)` | the latest frame as an image. The agent's eyes |
| `projector_show(pattern \| outline \| draft_frame)` | puts a test pattern, an outline or a draft frame on the projector (needs the preview toggle) |
| `calibration_run` / `calibration_get` | runs the Gray-code pass and returns quality (reprojection error, coverage %) |
| `detect_surfaces(hint?)` | candidate polygons in camera space, with confidence scores |
| `surface_create_from_camera(points_cam[])` | maps camera points to projector points and creates the surface |
| `alignment_error(surface)` | projects an edge pattern, captures it and returns the pixel error per edge |

**Starting the agent from the phone.** The "send" button on the phone posts the request to the local server. The server runs `codex exec "<request>"` (or `claude -p`) on the laptop with this MCP server attached and streams the tool log back to the phone and the editor. You never have to touch the laptop.

**Photo instead of stream.** "New scene from photo" (editor) and "just take a photo" (phone) skip the live stream. A single photo taken next to the lens is good enough for flat surfaces and for testing. Use "anywhere" plus a quick calibration when the phone can't sit at the lens.

## Getting pixels to the projector (and the camera to the laptop)

**We don't stream video to the projector.** We stream scene state, a few KB per change, and whatever drives the projector renders the frames itself in WebGL. The output stays sharp, there are no compression artifacts, and latency is only the network hop for a slider change.

Ways to drive the projector, best first:

| setup | how | notes |
|---|---|---|
| **Laptop over HDMI** (default) | the projector is a second display and `/out` opens fullscreen in Chrome on it | lowest latency, simplest, and the editor and output run on one machine |
| **Mini PC or Raspberry Pi 5 on the projector's HDMI** | Chromium kiosk opens `http://studio-mac.local:7400/out` over Wi-Fi | permanent installs; the laptop is free to move around |
| **Projector with a built-in browser or Android TV** | open `/out` in its browser | no cable, but GPU and browser quality vary. Test first |
| AirPlay or screen mirroring | — | avoid: compression, about 200 ms of lag and soft edges ruin the line work |

Camera from the phone to the laptop: **WebRTC over the LAN**, peer-to-peer from the phone app to the server, at 720p30 for alignment. The agent gets full-resolution snapshots on request. iOS only allows camera access in a secure context, so the local server uses a local HTTPS certificate (mkcert, trusted once on the phone), or the Capacitor wrapper gets camera access natively.

## Connecting the agents

```bash
# Claude Code
claude mcp add --scope user projmap -- /abs/path/to/projmap mcp

# Codex (~/.codex/config.toml)
[mcp_servers.projmap]
command = "/abs/path/to/projmap"
args = ["mcp"]
```

Both talk to the running local server (`projmap mcp` is a stdio bridge to `http://127.0.0.1:7400/mcp`; `PROJMAP_URL`, `PROJMAP_PORT` or `--url` point it elsewhere). If the server isn't running, the bridge starts it. See [guides/agents-mcp.md](guides/agents-mcp.md).

## Build order

| phase | what | why first |
|---|---|---|
| 0 | local server, scene store, `/out` projector page, phone pairing, WebSocket bus | everything else plugs into this |
| 1 | static, live, color and scenery backdrops on the phone | first usable video content |
| 2 | laptop editor: surfaces, shared points, warp, reference photo, portrait output | the hero shot needs it |
| 3 | effect engine (GLSL and JS contract), built-in effects, timeline, cues, GO on the phone | the ZimaCube reveal by hand |
| 4 | MCP read and look tools (`scene_get`, `output_render`, `reference_photo_get`) | agents can see and suggest |
| 5 | MCP write tools with drafts and proposals, agent panel in the editor | agents can build |
| 6 | "new scene from photo" (upload or iPhone) with surfaces found automatically | first, cheap test of agent mapping |
| 7 | phone camera stream (WebRTC), Gray-code calibration, `camera_compare` and auto map | the agent maps and checks against the real object |
