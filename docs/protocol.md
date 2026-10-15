# projmap wire protocol (v1)

The contract between the Go backend (`backend/`), the React app (`frontend/`, routes `/out` and `/editor`) and the
iPhone app (`ios/`). Field names are camelCase JSON. Examples of every message live in `contract/fixtures/`; all three
codebases decode every fixture in their tests. Change this file, the fixtures and all three decoders together.

Working name `projmap`. Server port **7400** (HTTP and WebSocket on the same port), Bonjour service `_projmap._tcp`.

## 1. Entities

### Setup (a projector rig)

```json
{
  "id": "set_9f2c1a",
  "name": "Desk projector",
  "output": { "width": 1920, "height": 1080, "orientation": "landscape", "flipH": false, "flipV": false },
  "master": 1.0,
  "blackoutFadeMs": 500,
  "testPattern": "off",
  "testPatternUntil": null,
  "referenceAsset": null,
  "calibrationId": null
}
```

- `orientation`: `landscape` | `portrait-cw` | `portrait-ccw`. Portrait means the scene is authored at
  `height × width` (1080×1920) and the output rotates it 90° onto the physical 1920×1080 framebuffer.
- `testPattern`: `off` | `grid` | `white` | `crosshair` | `corners`. Drawn by the output and by `/preview` on top of
  everything.
- `testPatternUntil`: server Unix nanoseconds when the test pattern goes back to `off`, or null while it is off. Any
  write that sets `testPattern` to something other than `off` (the `setup.testPattern` command, `PATCH /setups/{id}`,
  a patch or param) sets it to now + 60 s; sending the same pattern again renews it. When it passes, the server sets
  `testPattern: "off"` and broadcasts the setup. Renderers also stop drawing a pattern whose `until` has passed (by
  the server clock), so a grid never stays lit on camera. Clients show the remaining seconds.
- `referenceAsset`: sha256 of a photo taken from the lens position. Shown behind the editor stage only, never
  projected.

### Scene

```json
{
  "id": "scn_desk",
  "setupId": "set_9f2c1a",
  "name": "Desk",
  "version": 418,
  "mode": "static",
  "backdrop": {
    "static":  { "layers": [ /* Layer, bottom → top */ ] },
    "live":    { "layers": [] },
    "color":   { "layers": [] },
    "scenery": { "layers": [] }
  },
  "underlay": { "on": false, "from": "static", "level": 0.35 },
  "points": [ { "id": "p1", "x": 1004, "y": 118 } ],
  "objects": [ /* Object */ ],
  "timeline": { /* Timeline */ }
}
```

`version` increments by one for every committed patch.

`mode` is what is on air, exactly one at a time: `static` | `live` | `color` | `scenery` | `objects`.

- In a backdrop mode (`static`, `live`, `color`, `scenery`) the output draws only `backdrop[mode].layers`. The other
  stacks keep their content but are not drawn, and the mapped objects and the timeline are hidden.
- In `objects` mode the output draws the mapped objects and the timeline over black. With `underlay.on` it first
  draws `backdrop[underlay.from]` scaled by `underlay.level` (0…1, brightness) under them.
- Switching mode is a leaf patch: `replace /mode`. The phone sends it when a tab opens; the editor has a mode switch.
- `backdrop` holds one stack per backdrop mode; each is `{ layers: [Layer] }`, bottom → top. Layer ids are unique
  across all four stacks. Paths look like `/backdrop/live/layers/0/light/intensity`.
- What each stack holds by convention (the server does not enforce it): `static` is one gobo layer (picking a gobo
  replaces it and keeps its light), `color` is one gradient layer (picking replaces it), `scenery` is one photo
  layer (picking replaces it and keeps blur, brightness, warmth, drift), `live` is a free layer stack (add, remove,
  reorder). Single-choice picks replace the whole stack: `replace /backdrop/static/layers` with `[layer]`.
- `underlay` is optional on decode (absent = `{ on: false, from: "static", level: 0.35 }`). `from` is one of the four
  backdrop modes.

Upgrade of older documents (v1 had `backdrop: { layers }` and no `mode`): the server converts them when it loads them
and rewrites them on start. Gobo layers go to `static`, gradient and solid layers to `color`, photo layers to
`scenery`, procedural layers to `live` (with copies of the gobo layers under them, ids suffixed `_live`, so a
multiply layer like tree sway still has light to darken). `mode` becomes `live` when there were procedural layers,
else the first non-empty of `static`, `color`, `scenery`, else `static`.

`points` is the scene's pool of mapping points in **scene pixels**, where (0,0) is top left of the authored frame.
Surfaces reference point ids, so faces that share a corner share a point, and moving it moves every face.

**Details follow their face (server, 2026-10-15).** Whenever a commit moves any point of a surface that has detail
surfaces (`role: "detail"`, `parentId` = that surface), the server maps every point of those details from the
parent's old corners to its new ones and adds the moves to the same patch (so one undo puts both back): a homography
for a quad parent, a similarity for a circle (centre, rim), a least-squares affine fit for `tri`, `poly`, `mask` and
`line` (n ≥ 3), a translation otherwise. Only points used by detail surfaces alone follow; a point that a face, edge
or mask also uses, and a detail point the same patch moves itself, stay as written. The added ops are
`test /points/{i}/id`, `replace /points/{i}/x`, `replace /points/{i}/y` per point, rounded to 1/100 px. This holds for
every way corners move: patches, params (below), undo/redo, drafts (`AddOps` adds the follow ops to the draft) and MCP
writes.

### Layer (backdrop)

```json
{
  "id": "lay_1",
  "kind": "gobo",
  "ref": "window",
  "name": "window 2×3",
  "visible": true,
  "opacity": 1.0,
  "blend": "normal",
  "light": {
    "intensity": 0.8, "softness": 0.62, "angle": -22, "scale": 1.4, "offsetX": 0, "offsetY": 0,
    "color": { "mode": "cct", "kelvin": 3200, "tint": 0.04, "hue": 212, "sat": 0.7 },
    "fx": { "kind": "none", "speed": 0.35 }
  },
  "params": {}
}
```

- `kind`: `gobo` | `procedural` | `gradient` | `photo` | `solid`.
- `ref`: a catalog id of that kind (see `contract/catalog.json`). For `photo` it is a scenery id or `asset:<sha>`.
- `blend`: `normal` | `multiply` | `screen` | `add`.
- `light` applies to `gobo` and `procedural` layers; it is omitted (null) for the others.
- `light.color.mode`: `cct` (uses `kelvin` 2000–10000 and `tint` −1…1, negative = green, positive = magenta) or
  `hsi` (uses `hue` 0–360 and `sat` 0–1).
- `light.fx.kind`: `none` | `candle` | `fire` | `lightning` | `paparazzi` | `tv` | `breathe` | `strobe` | `police`;
  `speed` 0–1.
- A layer lives in one of the four stacks under `backdrop` (see Scene above).
- `params` hold the kind-specific values, validated against the catalog item's `params` schema:
  - gradient: `{ "stops": [{ "color": "#ff4d00", "pos": 0 }], "angle": 135, "drift": 0.24, "grain": 0.12, "brightness": 0.9 }`
  - photo: `{ "blur": 0.74, "brightness": 0.66, "warmth": 0.08, "drift": 0.1 }`
  - procedural (for example tree-sway): `{ "wind": 0.4, "gust": 0.18, "focus": 0.7, "seed": 7 }`
  - solid: `{ "color": "#000000" }`

### Object and Surface (mapping)

```json
{
  "id": "obj_cube", "name": "zimacube", "tags": ["hero"], "visible": true,
  "surfaces": [
    {
      "id": "srf_top", "name": "top", "kind": "quad", "role": "face",
      "pointIds": ["p1", "p2", "p3", "p4"],
      "parentId": null,
      "visible": true,
      "mesh": null,
      "effects": [ { "id": "fx_1", "effect": "trace", "enabled": true, "params": { "mode": "border", "line": 3, "speed": 2.0, "glow": 0.62 } } ],
      "opacity": 1.0,
      "softEdge": 8
    }
  ]
}
```

- `kind`: `quad` (4 points, clockwise from top left) | `tri` (3) | `poly` (n ≥ 3) | `circle` (2 points: centre,
  rim) | `line` (n ≥ 2, open polyline) | `mask` (n ≥ 3, cuts content out of everything below it).
- `role`: `face` | `edge` | `detail`. A detail surface (drive bays, fan) has `parentId` set to its face and is
  clipped to it.
- `mesh` (quads only): `{ "cols": 4, "rows": 4, "bezier": false, "offsets": [[dx, dy], …] }`: (cols+1)×(rows+1)
  offsets in scene pixels from the bilinear position, row-major.
- `effects` are always-on content for the surface; timeline clips add timed content on top.
- Mapped objects are drawn only in `objects` mode (see Scene).
- The built-in effect `drawing` holds vector drawings made on the surface in the editor's flat view:

  ```json
  { "id": "fx_draw", "effect": "drawing", "enabled": true, "params": { "reveal": 1, "strokes": [
    { "tool": "pen", "points": [[0.1, 0.2], [0.15, 0.25]], "color": "#ffffff", "width": 6 },
    { "tool": "rect", "points": [[0.1, 0.1], [0.9, 0.9]], "color": "#ff3b30", "width": 4, "fill": false },
    { "tool": "text", "points": [[0.2, 0.4]], "color": "#ffffff", "width": 0, "text": "hello", "size": 60 }
  ] } }
  ```

  - `points` are normalized surface UV: (0,0) is the surface's first corner (top left of its content), (1,1) the
    opposite one, v down. `line`, `rect` and `ellipse` take two points (`rect` and `ellipse` from opposite corners
    of their box); `circle` takes two (its centre, then a point on its rim); `pen` takes 2 or more; `polygon` 3 or
    more (closed); `text` takes one (the top left of the text).
  - `tool`: `pen` | `line` | `rect` | `ellipse` | `circle` | `polygon` | `text`. `width` (stroke) and `size` (text
    height) are in scene pixels of the surface, like other effects' px params. `fill` (rect, ellipse, circle,
    polygon) fills with `color`. A circle's radius is the centre to rim distance measured in surface pixels, so it
    stays round on a face of any aspect.
  - `reveal` 0…1 draws the strokes on in order: the first `reveal` fraction of the total stroke length is drawn
    (text counts as its width). A timeline clip with effect `drawing` and its own `strokes` uses `progress` as the
    reveal (`reveal × progress`), so a clip draws them on.
  - The param type `strokes` is new in the catalog schema: an array of these objects (at most 2000 strokes and 20000
    points per surface).

### Timeline

```json
{
  "duration": 20.0,
  "tracks": [ { "id": "trk_1", "name": "zimacube · faces", "target": { "kind": "object", "id": "obj_cube" } } ],
  "clips": [ { "id": "clp_1", "trackId": "trk_1", "effect": "grid-build", "start": 0, "end": 4, "fadeIn": 0.2, "fadeOut": 0.2, "params": {} } ],
  "cues": [ { "id": "cue_1", "at": 0, "label": "grid build", "autoFollow": false } ]
}
```

- `target.kind`: `surface` | `object` | `all`. An object target applies the clip to every surface of the object;
  `all` to every surface in the scene.
- Times are seconds. Each clip's `progress` = (t − start) / (end − start), 0…1.
- GO jumps to the next cue's `at` and plays. If `autoFollow` is false, playback holds at the next cue.
- (§20) A clip may carry `hold` (it keeps its end state after `end`); the state at t is every clip up to t with its
  hold, so GO, seek and back continue from the previous state. The built-in effect `converge` closes a backdrop
  mode's light onto an object's silhouette (`show.converge` starts a sequence with it).

### Effect (catalog or user/agent-made)

```json
{ "id": "trace", "name": "trace", "kind": "builtin", "origin": "builtin", "params": { /* JSON Schema */ }, "source": null }
```

- `kind`: `builtin` (implemented in the renderer by id) | `glsl` (source is a fragment shader, see
  `docs/effects.md`) | `js` (source is a worker module).

### Show (live state, one per server)

```json
{
  "activeSetupId": "set_9f2c1a",
  "activeSceneId": "scn_desk",
  "onAir": true,
  "transport": { "state": "playing", "startedAt": 1791700000123456789, "offset": 6.4, "cue": 1 },
  "version": 77
}
```

- `transport.state`: `stopped` | `playing` | `paused`.
- The playhead is `offset` when not playing. When playing it is
  `offset + (serverNow − startedAt) / 1e9`, where `startedAt` is in server Unix nanoseconds. Clients convert with
  their clock offset (section 3).
- `onAir: false` is blackout: the output fades to black over `setup.blackoutFadeMs` but keeps rendering underneath.

### Preset

```json
{ "id": "pre_1", "name": "golden hour", "mode": "static", "backdrop": { "layers": [] }, "thumbAsset": null, "createdAt": "2026-10-11T10:00:00Z" }
```

`mode`: `static` | `live` | `color` | `scenery`. A preset holds one stack (`backdrop.layers`) for its mode. Applying
it replaces `backdrop[mode]` of the scene and switches the scene to that mode: the ops are
`replace /backdrop/<mode>` with `{ layers }` and `replace /mode`. `POST /presets` snapshots `backdrop[mode]` of the
scene (`mode` defaults to the scene's mode, or `static` when the scene is in `objects` mode).

### Device

```json
{ "id": "dev_7k2", "name": "Grisha's iPhone", "role": "remote", "lastSeen": "2026-10-11T10:00:00Z", "online": true }
```

`role`: `output` | `editor` | `remote` | `agent`.

### Draft

```json
{ "id": "drf_1", "sceneId": "scn_desk", "author": "agent:codex#3", "baseVersion": 418, "ops": [], "status": "open", "summary": "" }
```

`status`: `open` | `proposed` | `applied` | `discarded`. `ops` is a JSON Patch against the scene at `baseVersion`.

### AgentSession and AgentEvent

```json
{ "id": "agt_3", "agent": "codex", "prompt": "map the zimacube…", "status": "running", "sceneId": "scn_desk", "draftId": "drf_1", "createdAt": "…" }
{ "seq": 4, "kind": "tool", "tool": "surface_create", "text": "top, left, right", "durationMs": 200, "ok": true, "ts": "…" }
```

`agent`: `codex` | `claude`. Event `kind`: `message` | `tool` | `status`. Session `status`: `running` | `done` |
`failed` | `cancelled`.

### Asset

```json
{ "sha": "9b1f…", "mime": "image/jpeg", "width": 4032, "height": 3024, "bytes": 2213411, "kind": "photo" }
```

`kind`: `photo` | `reference` | `snapshot` | `calibration` | `thumb`.

## 2. REST (prefix `/api/v1`)

Auth: `Authorization: Bearer <deviceToken>`. Requests from `127.0.0.1`/`::1` are trusted as role `editor` without a
token, so the editor and output on the same Mac just work.

| method | path | body / result |
| --- | --- | --- |
| GET | `/info` | `{ name, version, port, hostname, pairingRequired }` (no auth) |
| GET | `/pair/code` | `{ code: "K7Q2", expiresAt }` (localhost only: the output shows it) |
| POST | `/pair` | `{ code, name, role }` → `{ token, device }` (no auth) |
| GET | `/catalog` | `contract/catalog.json` + `{ version }` |
| GET/POST | `/setups` | list / create |
| GET/PATCH/DELETE | `/setups/{id}` | PATCH takes a partial setup (merge) |
| GET/POST | `/scenes` | list `[{id,name,setupId,version}]` / create `{ name, setupId }` |
| GET/DELETE | `/scenes/{id}` | full scene |
| POST | `/scenes/{id}/patch` | `{ base, ops }` → `{ version }` or 409 `{ code: "stale", version }` |
| POST | `/scenes/{id}/undo`, `/redo` | → `{ version }` |
| GET | `/scenes/{id}/history?limit=50` | `[{ version, author, ts, ops }]` |
| GET/POST | `/presets` | list / create `{ name, mode, sceneId }` (snapshots `backdrop[mode]` of the scene) |
| POST | `/presets/{id}/apply` | `{ sceneId }`: replaces `backdrop[mode]` and sets the scene's `mode` |
| DELETE | `/presets/{id}` | |
| GET/POST | `/effects` | list / create `{ name, kind, source, params }` |
| GET/PUT/DELETE | `/effects/{id}` | |
| GET | `/show` | Show |
| POST | `/show/{action}` | `go`, `back`, `play`, `pause`, `stop`, `seek {t}`, `blackout {on}`, `activate {sceneId}`, `solo {surfaceIds, fill, seconds}`, `preview {draftId, t, play}` (§12) |
| POST | `/assets` | multipart `file`, optional `kind` → Asset |
| GET | `/a/{sha}` | bytes (no `/api/v1` prefix; immutable cache headers) |
| GET | `/devices` | list; `DELETE /devices/{id}` revokes |
| GET/POST | `/drafts` | list / create `{ sceneId, author }`; `POST /drafts/{id}/apply`, `/discard` |
| POST | `/scenes/from-photo` | `{ asset, position: "lens" \| "anywhere", name }` → Scene |
| GET/POST | `/agents/sessions` | list / start `{ agent, prompt, sceneId }`; `GET /agents/sessions/{id}/events` |
| POST | `/agents/sessions/{id}/cancel` | |
| POST | `/camera/stills?request={id}` | multipart JPEG from the phone answering a capture request |
| POST | `/calibrations` | `{ setupId }` → `{ id }`; progress on channel `calib:{id}` |
| GET | `/calibrations/{id}` | result with `quality: { coverage, errorPx }` |

Errors: `{ "code": "not_found", "message": "Scene scn_x does not exist." }` with the matching HTTP status.

## 3. WebSocket `/ws`

One JSON object per text frame:

```
{ "t": <type>, "ch"?: <channel>, "id"?: <client msg id>, "re"?: <id being answered>, "v"?: <version>, "base"?: <version>, "d"?: <payload> }
```

### Connect

1. Client → `hello { token?, role, name, caps: ["haptics","camera","render"], build }`.
2. Server → `welcome { device, serverTime (unix ns), show, catalogVersion }`.
3. Clock sync: the client sends `ping { t0 }` (its own clock, ms). The server answers `pong { t0, ts }` (ts = server
   unix ns). The client does 8 pings and takes the median offset: `offset = ts/1e6 − (t0 + rtt/2)`. It repeats every
   30 s.

### Channels

| channel | content | who subscribes |
| --- | --- | --- |
| `show` | Show snapshots | everyone |
| `scene:{id}` | the scene document | output, editor, remote |
| `setup:{id}` | the setup | output, editor, remote |
| `presets` | the preset list | remote, editor |
| `devices` | the device list with online state | editor, remote |
| `draft:{id}` | a draft (its ops and status) | editor |
| `agent:{id}` | AgentEvents | editor, remote |
| `calib:{id}` | calibration progress `{ step, done, total, message }` | editor, remote |

`sub { }` with `ch` set subscribes; the server answers with `snapshot` (`v` = version, `d` = full document).
`unsub` stops it.

### Changing things

- **Continuous values (drags):** `param { path, value }` on a scene or setup channel. `path` is a JSON Pointer into
  the document. The server forwards it at once to every other subscriber as `param { path, value, by }`, without
  persisting. 200 ms after the last param on a path, it commits a `replace` patch and broadcasts `patched`. Clients
  apply incoming params to their local copy immediately.
- **Point edits name their point (2026-10-15).** Points are addressed by index (`/points/12/x`), so an index computed
  against another document (another scene, an older copy) would move the wrong point. A `param` on a
  `/points/{i}/…` path carries `pointId`, the id the sender saw at that index: `param { path, value, pointId }`. The
  server refuses it with `error { code: "mismatch" }` and sends a fresh `snapshot` when point i is not `pointId`
  (or does not exist), and forwards `pointId` with the param; a client that holds another point at that index takes a
  fresh snapshot instead of applying it. The commit 200 ms later is guarded by `test /points/{i}/id` with the id the
  server saw when the param arrived. Patches do the same with a `test /points/{i}/id` op before the ops that write
  point i; a failing `test` answers `reject { code: "stale" }` (the client rebuilds the ops from its intent).
  `test` ops count as leaf ops for the stale-base rule. Before a patch, the server commits the scene's pending params
  first (as one patch), so a drag's last value lands on the index it was sent for even when the patch then removes
  a point (the magnet weld).
- **Live follow while dragging (2026-10-15).** A `param` that moves a point of a face with details makes the server
  send, to every subscriber including the sender, `param { path: "/points/{j}/x"|"/points/{j}/y", value, pointId,
  by }` for each detail point that follows (the committed detail point mapped from the committed corners to the
  live ones), and puts a detail point back with the same message when the face returns. These are not persisted;
  the commit adds the same moves to its patch.
- **Structural edits:** `patch { ops }` with `base` = the version the client has, and `id`. If base equals the current
  version, or every op only replaces a leaf value, the server applies it, bumps the version and broadcasts
  `patched { ops, by }` with `v` and `re` = the client's id. Otherwise it sends `reject { code: "stale" }` with
  `re` and `v`, and the client re-applies its intent on the new snapshot.
- **Commands:** `cmd { name, args }` with `id`. Names match `POST /show/{action}` (`show.go`, `show.back`,
  `show.play`, `show.pause`, `show.stop`, `show.seek`, `show.blackout`, `show.activate`) plus `setup.testPattern`
  `{ setupId?, pattern, seconds? }` (`seconds` 1…600, default 60; see `testPatternUntil`) and `scene.mode`
  `{ sceneId?, mode }` (the same as a `replace /mode` patch on the active scene; for clients that do not hold the
  scene). The server answers `ack` (with `re`), or `error { code, message }` (with `re`).

### Server → client requests (RPC)

`rpc { method, args }` with `id`. The client answers `rpc.result { ... }` with `re`, or `rpc.error`.

| method | sent to | meaning |
| --- | --- | --- |
| `output.pattern` | output | `{ kind: "gray", axis: "x" \| "y", bit, inverse }` or `{ kind: "white" \| "black" \| "off" }`. Answer after 3 presented frames |
| `output.outline` | output | `{ surfaceIds, color, width, ms, sceneId? }`: flash outlines for an alignment check; with `sceneId` the output draws them only while that scene is on the wall (the editor's "outlines on wall" sends it, so another scene's faces with the same ids are never drawn) |
| `render.frame` | a client with cap `render` | `{ sceneId, draftId?, t, width }`. The client renders offscreen, uploads PNG to `/assets` with kind `snapshot` and answers `{ sha }` |
| `camera.capture` | the phone | `{ requestId, lock: true }`. The phone POSTs `/camera/stills?request=…` and answers `{ sha }` |

### Telemetry

The output sends `telemetry { fps, dropped, width, height, refresh }` every 2 s. The server relays it on the
`devices` channel as part of the device (`device.telemetry`).

## 4. Bonjour

`_projmap._tcp`, port 7400, TXT `name=<host>`, `v=1`, `id=<server id>`.

## 5. Camera preview (v1: JPEG frames over the WebSocket)

WebRTC through Pion is a later optimization. v1 sends the phone's preview as JPEG frames on the `camera` channel:

- Phone → `camera.frame { seq, width, height, jpeg }` (`jpeg` is base64, 640–960 px wide, quality ~0.6, 6–10 fps)
  with `ch: "camera"`.
- The server keeps the latest frame and relays it to every `camera` subscriber (editor). Slow subscribers only get
  the newest frame (drop, never queue).
- `camera.status { streaming, fps, width, height, steady, level }` (phone → server, every 1 s) is relayed the same
  way. `steady` is true after 3 s without motion (CoreMotion); `level` is the roll in degrees.
- Decisions (calibration, agents) never use preview frames. They use `camera.capture` stills at full resolution
  with locked exposure.

## 6. Web routes served by the backend

| route | what |
| --- | --- |
| `/out` | the projector output: fullscreen, idle pairing screen, role `output` (§17: first click, double-click, F and Esc for full screen) |
| `/view?token=…` | (§15) the viewer: what the projector shows, read only, role `remote`, no caps (§17: full screen like `/out`) |
| `/preview?token=…&w=…&mode=hero\|layer&layer=<id>&scene=<id>&try=<procedural id>` | a chrome-less render of the active scene (or one layer, from any stack) for embedding in the iPhone app's WKWebView. Same engine, lower resolution, no pairing UI, role `remote` (read only). The hero draws the scene's `mode` and the active test pattern exactly like `/out`. (§16) `try` draws the scene in live mode with a trial live layer on top, locally, never on air |
| `/editor/…` | the laptop editor |
| `/components` | the living style guide |
| `/a/{sha}`, `/catalog/assets/…` | assets and built-in catalog files (scenery photos at `/catalog/assets/scenery/<id>.jpg`) |

## 7. Calibration patterns (exact)

`output.pattern { kind: "gray", axis, bit, inverse }` is drawn in **physical framebuffer pixels** (ignoring the
setup's orientation and flips, and over everything including blackout). For axis `x` with physical width `W`:
`N = ceil(log2(W))`, column `c` has Gray code `g = c ^ (c >> 1)`, and the pixel is white when
`((g >> bit) & 1) == 1`, XORed with `inverse`. Axis `y` is the same with rows and `H`. `bit` runs 0 (LSB) … N−1.
`white`/`black` fill the frame; `off` returns to normal rendering. The backend decodes in physical pixels and maps
to scene pixels with the inverse of the orientation and flip transform.

## 8. Clarifications from the web client (frontend)

Additive notes the React app relies on. Each is marked (frontend); the backend may refine them, and the frontend
follows whatever lands here.

- **Backstage edits go to a draft (frontend).** The editor in backstage mode finds its open draft
  (`GET /drafts`, `author: "user:editor"`, `status: "open"`, same `sceneId`) or creates one, subscribes to
  `draft:{id}` and sends `patch { ops }` (and `param { path, value }`) **on the `draft:{id}` channel**. The ops are scene
  ops (paths into the scene, like a scene patch); the server appends them to `draft.ops` and broadcasts the changed
  draft on the channel, either as `snapshot` (the whole Draft) or `patched` with ops against the Draft document
  (for example `{ op: "add", path: "/ops/-", value: <scene op> }`). The client shows `scene + draft.ops`.
  `POST /drafts/{id}/apply` commits them to the scene. A stale base is not checked for drafts.
- **Ids inside the scene document (frontend).** Points, objects, surfaces, layers, effect instances, tracks, clips and
  cues added by a patch carry a client-made id (`<prefix>_<8 base36 chars>`, for example `srf_k3j9x0aa`), because a
  JSON Patch `add` needs the whole value. The server keeps them as given.
- **Agent session channel (frontend).** On `sub agent:{id}` the client accepts a `snapshot` whose `d` is the
  AgentEvent array (or `{ session, events }`), and live messages `event { AgentEvent }` and
  `session { AgentSession }` on the same channel. It also reads `GET /agents/sessions/{id}/events` on open.
- **Agent permission toggles (frontend).** `GET /api/v1/settings` → `{ agentMayPreview, agentMayGoLive, agentMayApply }`
  and `PATCH /api/v1/settings` with a partial body. Every toggle defaults to false. The editor hides them on 404.
- **Asking the phone for a photo (frontend).** The editor's "take with iphone" sends `cmd camera.capture
  { purpose: "scene" }`. The server forwards a `camera.capture` RPC to a phone and answers `ack { sha }` with the
  uploaded still (or `error { code: "no_phone" }`). Without it the editor falls back to upload only.
- **Test pattern command (frontend).** `cmd setup.testPattern { setupId, pattern }` with `pattern` one of the
  `testPattern` values; the editor falls back to `PATCH /setups/{id} { testPattern }` when the command errors.
- **Output RPC results (frontend).** `/out` answers `output.pattern` with `{ presented: true, width, height }`
  (the physical framebuffer size it drew in), `output.outline` with `{ presented: true }` after one frame, and
  `render.frame` with `{ sha }`.
- **Ambient clock (frontend).** Backdrop animation and light FX run on the server clock in seconds (wrapped hourly),
  not on the transport, so they keep moving while the timeline is stopped. Timeline clips use the playhead.

## 9. Clarifications from the server (backend)

Additive notes on what the Go server does where sections 1 to 7 leave room. Each is marked (backend). Nothing here
changes an existing message shape; new fields are optional.

- **Scene ↔ physical pixels (backend).** Rotation first, then flips in physical space. Scene size is
  `width × height` (landscape) or `height × width` (portrait). `portrait-cw`: `px = sceneH − y, py = x`;
  `portrait-ccw`: `px = y, py = sceneW − x`; then `flipH`: `px = W − px`, `flipV`: `py = H − py`. Calibration maps,
  `detect_surfaces` and `surface_create_from_camera` use this transform.
- **Message payloads (backend).** `patched.d = { ops, by }`; a forwarded `param.d = { path, value, by }` (`by` is the
  sender's device id); `reject` carries `re`, `v` (the current version) and `d = { code: "stale", message }`;
  `pong` has no `re`. `POST /scenes/{id}/patch` answers 409 `{ code: "stale", message, version }`.
- **Snapshot versions (backend).** `v` is the document version on `scene:` and `setup:`, `show.version` on `show`,
  the op count on `draft:`, the event count on `agent:`, `done` on `calib:`, and a millisecond timestamp on
  `presets` and `devices` (lists without a version).
- **Delivery order (backend).** Each connection has an ordered queue (patched, ack, error, rpc, snapshots of
  `scene:` and `setup:`) and a newest-only slot per key for `param` (per channel and path), `camera.frame`,
  `camera.status` and snapshots on `show`, `devices`, `presets`, `draft:` and `calib:`. Newest-only messages can
  overtake ordered ones, so a `show` snapshot may arrive before the `ack` of the command that caused it. A client
  whose ordered queue overflows (256) loses that backlog and gets a fresh `snapshot` of every channel it follows.
- **Draft channel (backend).** As in section 8: `patch` on `draft:{id}` appends the ops (they must apply to the
  draft's current view and validate; base is not checked) and answers `ack` with `re`, then the whole Draft arrives
  as `snapshot`. `param` on `draft:{id}` goes at once to the other subscribers and is appended as a `replace` op
  200 ms after the last one on that path. `GET /drafts/{id}/scene` returns the draft applied to its base (the scene
  the draft would make), for clients that render a draft.
- **Agent channel (backend).** `snapshot.d = { session, events }`; live `event` (`d` = AgentEvent, `v` = seq) and
  `session` (`d` = AgentSession) on `agent:{id}`. Sessions an MCP client starts on its own (Claude Code or Codex
  through `projmap mcp`) appear on the first write tool with prompt `(connected over MCP)` and end `done` on
  `proposal_submit`.
- **Calibration (backend).** `calib:{id}` carries a `snapshot` per step (`d = { step, done, total, message }`, step
  names `white`, `black`, `x3`, `x3i`, …, `decode`, `done` or `failed`). `GET /calibrations/{id}` →
  `{ id, setupId, status: running|done|failed, message, quality: { coverage, errorPx } | null, mapAsset, whiteAsset,
  cameraWidth, cameraHeight, projectorWidth, projectorHeight, createdAt }`. On success the setup's `calibrationId`
  is set. Stills are reduced to at most 1280 px wide; camera pixel coordinates everywhere (MCP tools, candidates)
  are in that frame (`cameraWidth × cameraHeight`). `mapAsset` is a 16-bit RGBA PNG (one header row, then per camera
  pixel R = projector x·16, G = y·16, B = 65535 when valid). `GET /calibrations/{id}/candidates` → planar surfaces
  `[{ id, kind, camera, projector, scene, confidence, areaCamPx }]`. The server answers 503 `unavailable` when no
  output or no phone with cap `camera` is connected.
- **Alignment check (backend).** The server sends `output.pattern { kind: "black" }`, then
  `output.outline { surfaceIds, color, width, ms }`, captures, then `output.pattern { kind: "white" }`, captures, then
  `output.pattern { kind: "off" }`. The output draws outlines above a pattern. Outline ids may name surfaces of the
  draft in `show.preview` (below).
- **Agent preview (backend).** While an agent previews a draft, `Show` has an optional
  `preview: { draftId, until }`; the output renders that draft (`GET /drafts/{id}/scene`, or follow `draft:{id}`)
  instead of the live scene and the transport plays it. `preview` disappears on stop or when the agent ends it.
- **Transport (backend).** `transport.cue` is the index (cues sorted by `at`) of the cue last started. GO from
  `stopped` starts cue `cue` (0 after a stop); from `playing` or `paused` it starts `cue + 1` and answers
  `error { code: "no_cue" }` after the last one. Reaching the next cue's `at` while playing pauses there
  (`paused`, `offset = at`, `cue` unchanged) unless that cue has `autoFollow`, which advances `cue` and keeps
  playing. The end of the timeline pauses at `duration`. `back` restarts the current cue, or goes to the previous one
  within 1 s of its start. `seek` sets `cue` to the last cue at or before `t`; seeking while stopped leaves the
  transport `paused`. A server restart never resumes playback.
- **More REST (backend).** `GET /assets/{sha}` (metadata); Asset has an optional `thumb` (sha of a 512 px JPEG made
  for images larger than that); HEIC is stored as is with width and height 0. `POST /login-links` (this Mac only) →
  `{ code, expiresAt, path: "/editor?login=<code>" }` and `POST /login { code, name }` → `{ token, device }` (role
  editor, one use, 5 minutes) for the one-time editor link `projmap open` prints. `GET /camera/status`
  (`{ connected, streaming, fps, width, height, steady, level, lastFrameAgeMs, device }`) and
  `GET /camera/preview.jpg` (the latest preview frame). `GET /settings` and `PATCH /settings` as in section 8.
  `POST /scenes` and `POST /presets` default `setupId` and `sceneId` to the active ones.
- **Devices and hello (backend).** A device has an optional `telemetry` (the output's last report while it is
  online). A client on this Mac without a token gets a device per `(name, role)`, so keep the hello name stable.
  An editor token may say hello with another role (the editor opening `/out`). Role `output` may subscribe to `show`,
  `scene:`, `setup:`, `draft:` and `presets`; role `agent` uses MCP, not the WebSocket. `/ws` also accepts the token as
  `?token=` (the embedded preview).
- **render.frame (backend).** Sent to the newest client with cap `render`:
  `{ sceneId, draftId?, t, width, mode? }`; MCP waits 20 s and asks for `mode: "objects"` (agents look at their
  mapping whatever is on the wall). While `show.preview` is set, the output draws the draft in `objects` mode. Without such a client `output_render` tells the agent to open the
  editor or `/out` in a browser on the Mac.
- **MCP (backend).** Streamable HTTP at `/mcp` with the same auth as REST (this Mac is trusted; otherwise a device
  or agent token as `Authorization: Bearer`). `projmap mcp [--token]` is a stdio bridge to it.

## 10. Clarifications from the iPhone app (ios)

Additive notes on what the phone sends and accepts. Each is marked (ios).

- **Edits from the phone (ios).** Drags (sliders, colour strips, colour stops, master, orientation, flips, blackout
  fade) go as `param` on `scene:{id}` or `setup:{id}`, throttled to 60 Hz per path with the last value always sent.
  Discrete scene edits (gobo, visibility, add/remove/move layer, gradient choice, preset apply as
  `replace /backdrop/<mode>` + `replace /mode`, tab change as `replace /mode`) go as `patch` with `d` = the op array, `id` = a client id and `base` = the version the phone
  holds. New layers carry client ids `lay_<8 base36>`. Offline, params are refused (the UI says "not connected");
  patches wait in the outbox and are rebuilt from their intent (by layer id) after a `stale` reject.
- **Test pattern (ios).** `cmd setup.testPattern { setupId, pattern, seconds: 60 }`. The projector settings count
  down from `testPatternUntil` (server clock via the ping offset) and show the pattern as off once it passes;
  "keep on" sends the same pattern again to renew it.
- **Modes from the phone (ios).** Tapping a tab sends `replace /mode` (only when the scene is in another mode). On
  launch the phone opens the tab of the scene's mode and sends nothing, so opening the app never changes the wall.
  The tab bar marks the on-air mode with a red dot. Static, color and scenery picks send
  `replace /backdrop/<mode>/layers` with one layer that keeps the previous layer's id (and its light for a gobo, its
  blur, brightness, warmth and drift for a photo); live edits and the add layer sheet touch `/backdrop/live` only.
  Presets list per tab mode; applying one sends `replace /backdrop/<mode>` + `replace /mode`, saving sends that mode.
- **Older servers (ios).** A scene with the v1 `backdrop: { layers }` decodes with the layers split by kind (as the
  server's upgrade does) for display; edits need a server that speaks the stacks.
- **camera.capture (ios).** With `requestId` the phone uploads to `/camera/stills?request=…` and answers
  `{ sha }`; without one (for example `{ purpose: "scene" }`) it uploads to `/assets` and answers `{ sha }`.
- **Auto map candidates (ios).** The phone reads `GET /calibrations/{id}` and then `/candidates`, normalises
  `camera` points by `cameraWidth × cameraHeight` and names them "surface 1…" (largest first). If the result ever
  carries `objects: [{ id, name, faces, outline: [[x, y]] }]` (named objects, outline in 0…1 camera fractions) the
  phone shows those names instead.

## 11. Changes since v1 (2026-10-11)

One release, all three clients and the server together:

- **Scene modes.** `scene.mode` (`static | live | color | scenery | objects`) says what is on air; `scene.backdrop`
  is four stacks `{ static, live, color, scenery }`, each `{ layers }`; `scene.underlay { on, from, level }` puts a
  dimmed backdrop under the objects in `objects` mode. Mapped objects and the timeline only show in `objects` mode.
  Layer paths moved from `/backdrop/layers/…` to `/backdrop/<mode>/layers/…`. Stored scenes upgrade on server start
  (section 1, Scene).
- **Presets** hold one stack for their mode; applying one replaces `backdrop[mode]` and sets `mode`.
- **Commands.** `scene.mode { sceneId?, mode }`; `setup.testPattern` takes `seconds` (default 60).
- **Test patterns expire.** `setup.testPatternUntil` (server Unix ns); the server turns the pattern off when it
  passes and renderers stop drawing it. `/preview` draws the test pattern like `/out`.
- **Drawing effect.** The built-in effect `drawing` (`params.strokes`, `params.reveal`) and the catalog param type
  `strokes`; the catalog `version` is 2.
- **render.frame** takes an optional `mode`; the output draws `show.preview` drafts in `objects` mode.

## 12. Content layers, atlases and solo (2026-10-12)

Additive. Every new field is optional on decode, so older documents and clients keep working. The iPhone app
decodes and ignores them.

### Content layer

A content layer is a picture or a gradient drawn inside a surface (a **surface layer**) or across an object's unfolded
faces (an **object layer**, see Atlas). Shape:

```json
{
  "id": "cl_flowers", "kind": "media", "name": "flowers", "visible": true, "opacity": 0.8, "blend": "normal",
  "x": 0, "y": 0, "scale": 1, "rotation": 0, "reveal": 1, "revealAngle": 0,
  "src": "flowers", "media": "image", "fit": "fill", "crop": { "x": 0, "y": 0, "w": 1, "h": 1 }
}
```

```json
{
  "id": "cl_sweep", "kind": "gradient", "name": "sweep", "visible": true, "opacity": 0.9, "blend": "screen",
  "x": 0, "y": 0, "scale": 1, "rotation": 0, "reveal": 1, "revealAngle": 0,
  "stops": [ { "color": "#000000", "pos": 0 }, { "color": "#ff3b30", "pos": 0.5 }, { "color": "#000000", "pos": 1 } ],
  "angle": 30, "offset": 0, "repeat": true
}
```

- `kind`: `media` | `gradient`. `blend`: `normal` | `multiply` | `screen` | `add`. `opacity` 0…1.
- The layer lives in its **canvas**: the surface's UV square (0,0 top left of the content, as for effects) for a
  surface layer, the object's atlas for an object layer.
- Transform, applied in canvas pixels: the layer's box (see `fit`) is scaled by `scale` (0.01…100) about its centre,
  rotated by `rotation` degrees (clockwise) about its centre, then moved by `x`, `y` in canvas fractions (−10…10;
  `x: 0.5` moves it half the canvas width to the right).
- `reveal` 0…1 is a wipe: the part of the canvas within the first `reveal` fraction along the direction
  `revealAngle` (degrees; 0 = left to right, 90 = top to bottom) shows, the rest is transparent. Missing = 1.
- Media only: `src` is a scenery id from the catalog (`/catalog/assets/scenery/<id>.jpg`) or `asset:<sha>` (an
  uploaded image or video). `media`: `image` | `video` (videos loop, muted). `fit`: `fill` (cover the canvas, crop the
  rest), `fit` (contain, transparent bars) or `stretch` (fill exactly, ignoring the aspect). `crop` is the part of the
  source to use, in source fractions (default the whole source).
- Gradient only: `stops` (1…8, `#rrggbb`, `pos` 0…1) along `angle` (degrees, 0 = left to right), shifted by
  `offset` (−10…10, in gradient lengths). `repeat: true` tiles it, so an `offset` that runs from −1 to 1 sweeps the
  band across the canvas. Defaults: `angle` 0, `offset` 0, `repeat` false.
- Missing common fields decode as: `visible` true, `opacity` 1, `blend` normal, `x`/`y`/`rotation` 0, `scale` 1,
  `reveal` 1, `revealAngle` 0.

### Surface and object additions

```json
{ "id": "srf_right", "...": "…", "layers": [ /* ContentLayer, bottom → top */ ] }
{ "id": "obj_cube", "...": "…", "atlas": { /* Atlas */ }, "layers": [ /* ContentLayer, bottom → top */ ] }
```

- `surface.layers` and `object.layers` are optional (absent = `[]`). A client adding the first layer sends
  `add …/layers` with `[layer]`; later ones `add …/layers/-`.
- Content layer ids are unique across the scene (they share one namespace with nothing else).
- What a surface draws, bottom to top: the object layers (through the surface's atlas rect), the surface layers,
  the always-on `effects`, then the timeline clips. Lines and masks draw no layers.

### Atlas

The object's faces unfolded flat at their real proportions, edge to edge, like a dieline. Object layers are drawn on
this canvas, and each face shows the part of it under its rect, so content runs on across shared edges.

```json
"atlas": { "width": 618, "height": 609, "faces": {
  "srf_top":   { "x": 0,   "y": 0,   "w": 309, "h": 309, "rotation": 270 },
  "srf_left":  { "x": 0,   "y": 309, "w": 309, "h": 300, "rotation": 0 },
  "srf_right": { "x": 309, "y": 309, "w": 309, "h": 300, "rotation": 0 } } }
```

- Units are atlas pixels (1…16384); an exported template is exactly `width × height`. Auto layouts use one atlas
  pixel per scene pixel.
- `faces` keys are surface ids of the object (role `face`). `x`, `y`, `w`, `h` is the axis-aligned rect the face
  covers; `rotation` (0 | 90 | 180 | 270, clockwise) turns the face's UV inside it. With `W = w`, `H = h`, face uv
  (u, v) lands at:
  - 0: `(x + u·W, y + v·H)`
  - 90: `(x + (1 − v)·W, y + u·H)`
  - 180: `(x + (1 − u)·W, y + (1 − v)·H)`
  - 270: `(x + v·W, y + (1 − u)·H)`
- Detail surfaces are not listed: they sit inside their parent face's rect, where their corners fall in the
  parent's UV. Faces missing from `faces` draw no object layers.
- `atlas` is optional. Absent or null means "not laid out yet": renderers compute the auto layout below on the fly.
  The editor stores it when you add the first object layer, export a template or move a face, so artwork stays
  put when the mapping changes; **re-layout** recomputes it.
- Auto layout (deterministic): the faces are the object's `face` surfaces that are quads (the others go in a row
  under the unfold at their flat size). Each face's flat size is the mean length of its opposite edges in scene
  pixels. The root is the face whose v axis (first point to last point) points most nearly straight down on the
  stage, ties to the larger area, then the earlier surface; it sits at rotation 0. Breadth-first from the root, in
  surface order, each face that shares an edge (both point ids) with a placed face is placed against that edge on
  the other side, at the one rotation that lines the shared points up, scaled so the shared edge has the same
  length (its aspect is kept). A placement that would overlap a placed rect is skipped. Finally everything shifts
  so the smallest `x`, `y` is 0 and values round to whole pixels.

### Layer tracks

- Track `target.kind` may be `layer` with `id` = a content layer id (surface or object layer).
- Clips on a layer track animate that layer. `effect` is `reveal` (drives `reveal`) or `sweep` (drives a gradient's
  `offset`, or a media layer's `x`); `params: { from, to }` (numbers; defaults reveal 0 → 1, sweep −1 → 1). During
  the clip the value is `from + (to − from) × progress`. After a clip ends the value holds at its `to` until the
  next clip on the layer starts; before the first clip starts it is that clip's `from`. A layer without clips uses
  its own value. Fades do not apply to layer clips.

### Solo

```json
"solo": { "surfaceIds": ["srf_top"], "fill": "grid", "until": 1791700060123456789 }
```

- `show.solo` (optional, null when off): the output draws only these surfaces, over black, in `objects` mode
  whatever `scene.mode` says (blackout still applies). `fill`: `content` (their normal content, with their details),
  `white` (solid white through the warp) or `grid` (a numbered test grid drawn through each surface's warp, number
  = position in `surfaceIds` + 1, to check alignment on the real object).
- Command `cmd show.solo { surfaceIds, fill?, seconds? }` (also `POST /show/solo`). `fill` defaults to `content`,
  `seconds` 1…600 (default 60). It sets `until` = now + seconds; sending it again renews. `surfaceIds: []` turns solo
  off. At `until` the server sets `solo` to null and broadcasts the show; renderers also stop drawing a solo whose
  `until` has passed (server clock), like test patterns.
- `cmd show.preview { draftId, t?, play? }` (also `POST /show/preview`) plays a draft on the wall from `t` (the
  editor's "wall follows editor" in backstage); an empty `draftId` ends the preview (as `show.stop` does).

### Editor preview (frontend, no wire change)

The editor plays its own clock: space plays the stage, the content view and thumbnails without sending anything.
Only with **wall follows editor** on does it send `show.seek` / `show.play` / `show.pause` (or `show.preview` with its
draft in backstage). GO and on air stay separate controls.

## 13. Drawing on faces over MCP (2026-10-14)

Additive. Every new field is optional on decode.

- **Named effect instances.** A surface effect instance may carry `name` (string, optional):
  `{ "id": "fx_1", "name": "bays", "effect": "drawing", "enabled": true, "params": { … } }`. Agents keep one
  `drawing` instance per idea ("bays", "logo", "leds") so they can redo one without touching the others. A drawing
  instance without a name is the editor's own and counts as the layer `drawing`. The editor draws into the first
  drawing instance of a surface; every instance renders.
- **Stroke tools.** `circle` (points `[centre, rim]`) and `polygon` (3 or more points, closed) join the `drawing`
  strokes (section 1).
- **Settings.** `agentMayApply` (default false) lets an agent apply its own draft with the MCP tool `draft_apply`.
- **Render RPCs.** Like `render.frame`, sent to the newest client with cap `render` (the editor or `/out`):

  | method | args | the client |
  | --- | --- | --- |
  | `render.face` | `{ sceneId, draftId?, surfaceId, t, width, height }` | renders the surface's content flat (unwarped) into exactly `width × height`: canvas px (x, y) is the surface's uv (x / width, y / height). A face with a place in its object's atlas renders the way the editor's face view does (its details inside it); other surfaces render alone |
  | `render.unfold` | `{ sceneId, draftId?, objectId, t, width, height }` | renders the object's atlas (protocol §12) over the whole canvas |

  Both upload the PNG as a `snapshot` asset and answer `{ sha, width, height }`, or `rpc.error` when the surface or
  object does not exist. With `draftId` the client renders the scene with that draft's ops applied.
- **SVG assets.** `POST /assets` (and the MCP tool `asset_upload`) store SVG as `image/svg+xml`, with `width` and
  `height` read from the root's size or `viewBox`. `/a/{sha}` serves an SVG with a sandboxing
  `Content-Security-Policy`. Renderers draw an SVG media layer through an image element at up to 2048 px.
- **MCP sessions (backend).** A client that connected on its own (Claude Code, Codex) and whose draft gets applied or
  discarded starts a new session and draft on its next write; until then its reads show the live scene. Tool events
  on `agent:{id}` read `tool · target · layer`, for example `face_draw · srf_right · bays · 16 strokes`.

## 14. Show control, sound and video (2026-10-14)

Additive. Every new field is optional on decode (absent decodes to the default given here), so older documents and
clients keep working. Fixtures: `scene.json` (two pads, a sound track with one clip, a cue with a sound, a scenery
video layer), `show.json` (`audio`), `sound.json`, `video.json`, `import.json`, `ws-messages.json` (`sound.play`,
`sound.stop`, `cmd sound.play`, `cmd show.audio`).

### Scenes: create, duplicate, rename, delete, activate

| method | path | body / result |
| --- | --- | --- |
| GET | `/scenes` | `[{ id, name, setupId, version }]` in creation order |
| POST | `/scenes` | `{ name, setupId?, duplicate? }` → Scene (201). Without `duplicate`: an empty scene (`mode: "static"`, empty stacks, no objects, a 20 s timeline) on `setupId`, which defaults to the active setup. With `duplicate: <sceneId>`: a deep copy of that scene's current document with a new id, `version: 1` and the given name (`setupId` is the source's). |
| PATCH | `/scenes/{id}` | `{ name }` → the summary. The same as a `replace /name` patch on the scene. |
| DELETE | `/scenes/{id}` | 204. Deleting the active scene answers 409 `{ code: "scene_active" }` ("Activate another scene first."). |

- Channel **`scenes`** (editor, remote): `snapshot` with `d` = the summary list and `v` = a millisecond timestamp,
  sent on subscribe and whenever a scene is created, deleted or renamed (a committed patch that changes `/name`
  counts).
- Activating puts a scene on the wall: `cmd show.activate { sceneId }` or `POST /show/activate { sceneId }`. The
  transport stops and `preview` clears; `onAir`, `audio` and `solo` stay. Each scene keeps its own `mode`, stacks,
  pads and timeline.
- Names are trimmed, 1…80 characters, and need not be unique.
- **The active scene survives restarts.** On start the server keeps the stored `activeSceneId` when that scene
  exists; otherwise (nothing stored yet, or the scene is gone) it activates the first scene of the list and stores the
  show at once. A server that has scenes therefore always has an active one.

### Sound assets

```json
{ "sha": "5d1e0a", "mime": "audio/mpeg", "width": 0, "height": 0, "bytes": 482113, "kind": "sound",
  "name": "rain on glass", "duration": 12.48, "peaks": [0.02, 0.31, 0.88, 0.6] }
```

- Asset `kind` gains `sound` and `video`. Asset gains optional `name` (string), `duration` (seconds) and `peaks`
  (sound only: 0…1 values, the largest absolute sample per equal slice of the file, normally 128 of them). A sound's
  id everywhere is its `sha`.
- Accepted sound files: WAV, MP3, M4A (AAC or ALAC), AIFF and OGG (Vorbis or Opus), up to 64 MB. Anything else
  answers 400 `{ code: "unsupported" }`.
- `duration` and `peaks`: the server reads WAV and AIFF itself and uses `ffprobe`/`ffmpeg` (on `PATH` or in
  `/opt/homebrew/bin`) for the rest. When it cannot, it keeps `duration` and `peaks` that the uploader sent as form
  fields (`duration` = seconds, `peaks` = a JSON array), else stores `duration: 0, peaks: []`. The web editor always
  sends them (it decodes the file with Web Audio first).

| method | path | body / result |
| --- | --- | --- |
| GET | `/sounds` | `[Asset]` of kind `sound`, newest first |
| POST | `/sounds` | multipart `file`, optional `name` (default: the file name without its extension), `duration`, `peaks` → Asset (201). `POST /assets` with `kind=sound` does the same |
| PATCH | `/sounds/{sha}` | `{ name }` → Asset |
| DELETE | `/sounds/{sha}` | 204. Pads, clips and cues that use it stay and show as "missing sound" |

Channel **`sounds`** (editor, remote): `snapshot` with `d` = the list (as `GET /sounds`), `v` = a millisecond
timestamp, on subscribe and on every change.

### Soundboard pads (`scene.sounds`)

```json
"sounds": { "pads": [
  { "id": "pad_thunder", "name": "thunder", "sound": "a77c31", "volume": 0.9, "color": "blue", "icon": "thunder", "key": "t", "loop": false },
  { "id": "pad_rain", "name": "rain", "sound": "5d1e0a", "volume": 0.6, "color": "teal", "icon": "rain", "key": "r", "loop": true }
] }
```

- Every scene has its own soundboard. `scene.sounds` is optional on decode (absent = `{ pads: [] }`); the server
  always writes `sounds.pads`, so clients add a pad with `add /sounds/pads/-` and edit it with leaf patches such as
  `replace /sounds/pads/0/volume`. Order is the grid order (left to right, top to bottom).
- `id`: client-made `pad_<8 base36>`, unique within the pads. `name` 1…40 chars. `sound`: a sound sha (not checked
  against the library, so a deleted sound leaves a pad that says "missing sound").
- `volume` 0…1 (default 1). `color`: `ink` | `red` | `amber` | `green` | `teal` | `blue` | `violet` | `pink`
  (default `ink`). `icon`: `none` | `bell` | `door` | `thunder` | `rain` | `wind` | `bird` | `music` | `voice` |
  `knock` | `spark` | `heart` (default `none`; a client without a glyph for it shows the name only). `key`: one of
  `a-z` or `0-9`, or absent: the web Show space plays the pad on that key. `loop` (default false): the sound repeats
  until the pad is pressed again (`sound.stop { padId }`).

### Audio output: `show.audio`

```json
"audio": { "output": "projector", "volume": 0.8, "muted": false, "loops": ["pad_rain"] }
```

- `loops` (optional, default `[]`): the looping pads playing now (below). Read only for clients.
- `output`: which client plays every sound: `projector` (the `/out` page, default), `editor` (the laptop editor) or
  `phone` (the iPhone app). `volume` 0…1 is the master (default 1); `muted` (default false) silences everything
  without losing the volume. Absent on decode = `{ output: "projector", volume: 1, muted: false }`.
- Change it with `cmd show.audio { output?, volume?, muted? }` or `POST /show/audio` (any subset); the show
  version bumps and the show is broadcast. The master volume applies live to sounds that are already playing.
- A client that can play sound says so with cap **`audio`** in `hello` (`/out`, the editor, the phone app; never
  `/preview`). The **audio client** is every connection with cap `audio` whose role matches `output`:
  `projector` → role `output`, `editor` → role `editor`, `phone` → role `remote`.

### Playing sounds: `sound.play` and `sound.stop`

- `cmd sound.play { padId? | soundId?, volume?, sceneId? }` (also `POST /sounds/play`). `padId` is looked up in
  `sceneId` (default the active scene); `soundId` plays a library sound directly. `volume` (0…1, default 1)
  multiplies the pad's volume. The server sends every audio client:

  ```json
  { "t": "sound.play", "d": { "playId": "ply_k2m9x0aa", "sound": "a77c31", "padId": "pad_thunder", "name": "thunder", "volume": 0.9, "loop": false } }
  ```

  and answers `ack { playId, outputs }` (`outputs` = how many clients got it), or `error { code: "no_audio" }` when no
  audio client is connected ("Nothing plays sound right now. Open /out on the projector computer and click it once.").
  Unknown pad → `not_found`; a pad without a sound → `bad_request`.
- `cmd sound.stop { playId? | padId? }` (also `POST /sounds/stop`) sends `sound.stop { playId?, padId? }` to the audio
  clients: `playId` stops one sound, `padId` every sound of that pad, neither stops every pad and cue sound (not the
  timeline). Answers `ack`.
- `sound.play` and `sound.stop` are direct messages (no `ch`) on the ordered queue. The audio client fetches
  `/a/{sha}`, decodes once and caches, and plays at `volume × master` (0 while `muted`).
- **Looping pads toggle on the server.** The server keeps the looping pads it started in `show.audio.loops`
  (pad ids, in start order). `sound.play` of a looping pad that is already in `loops` stops it instead (it sends
  `sound.stop { padId }`, removes it and answers `ack { stopped: true }`). `sound.stop` without ids, `show.stop`,
  activating another scene and a server restart clear `loops`. UIs mark the pads in `loops` as playing.

### Sound on the timeline

```json
{ "id": "trk_sound", "name": "sound", "target": { "kind": "sound", "id": null } }
{ "id": "clp_rain", "trackId": "trk_sound", "effect": "sound", "start": 2, "end": 9, "fadeIn": 0.5, "fadeOut": 1.5,
  "params": { "sound": "5d1e0a", "offset": 0.5, "volume": 0.8 } }
```

- Track `target.kind` may be `sound` (`id` null). A scene may hold several sound tracks; they mix.
- Clips on a sound track have `effect: "sound"` and `params { sound, offset, volume }`: `sound` a sound sha,
  `offset` ≥ 0 the seconds into the file where the clip starts (default 0), `volume` 0…1 (default 1). The clip plays
  from `start` to `end`; at playhead `t` the file position is `offset + (t − start)`. `fadeIn` / `fadeOut` are linear
  gain ramps at the clip's ends. Clips past the file's end are silent there. Effect `sound` is only valid on sound
  tracks and sound tracks take only `sound` clips.
- The audio client schedules the clips from `show.transport` and the active scene's timeline on the server clock
  (Web Audio on the web, `AVAudioPlayer.play(atTime:)` on the phone): on every show or scene change it stops what it
  scheduled and schedules again from the playhead, so clips stay within a frame of the picture. Paused and stopped
  transports are silent. A clip that starts before the playhead starts at once at the right file position.
- The editor's own preview clock (§12, Space) plays the timeline's sound clips locally in the editor whatever
  `output` is, with a mute toggle on the transport bar; it sends nothing.

### Cue sound

```json
{ "id": "cue_1", "at": 0, "label": "grid build", "autoFollow": false, "sound": { "sound": "a77c31", "volume": 1 } }
```

- `cue.sound` (optional, null or absent = none): `{ sound, volume }` (volume 0…1, default 1). When a cue starts on
  the wall (GO, or playback passing an `autoFollow` cue) the server sends `sound.play { playId, sound, cueId, name,
  volume, loop: false }` to the audio clients. Seek and back do not fire cue sounds.

### Video layer

```json
{ "id": "lay_waves", "kind": "video", "ref": "youtube:aqz-KE-bpKQ", "name": "big buck bunny", "visible": false,
  "opacity": 1, "blend": "normal", "light": null,
  "params": { "blur": 0.2, "brightness": 0.8, "warmth": 0, "drift": 0, "start": 12, "end": 0, "audio": false, "volume": 1 } }
```

- Backdrop layer `kind` gains `video`. It belongs in `scenery` (picking a video tile replaces the scenery stack and
  keeps blur, brightness, warmth and drift like a photo pick); `live` and `color` accept it too.
- `ref`: `asset:<sha>` (an uploaded or downloaded MP4, MOV or WebM) or `youtube:<videoId>` (11 characters
  `[A-Za-z0-9_-]`, an embedded YouTube player). Anything else is invalid.
- `params` (catalog `videoParams`; the catalog `version` is 3): `blur` 0…1 (default 0.2), `brightness` 0…1 (0.8), `warmth` −1…1 (0), `drift`
  0…1 (0), the photo controls; `start` ≥ 0 and `end` ≥ 0 seconds are the loop window (`end` 0 = the end of the
  file); `audio` (default false) sends the video's own sound to the audio output; `volume` 0…1 (1).
- `asset:` videos are a WebGL video texture drawn exactly like a photo (cover the frame, blur, brightness, warmth,
  drift), looping `start`…`end`, muted. With `audio: true` and `output: "projector"`, `/out` unmutes its element at
  `volume × master`; other outputs ignore the video's sound in this version. (§16 extends this to YouTube and the
  editor output, and changes brightness: 100 % is the original picture.)
- `youtube:` videos are an embedded player (`https://www.youtube-nocookie.com/embed/<id>`, muted, looping, no
  controls, from `start`, to `end` when set) that `/out` and `/preview` place **behind** the WebGL canvas, sized to
  cover the frame (and rotated and flipped with the output), with CSS `blur()`, `brightness()` and a warm or cool tint
  for warmth, and `opacity`. The canvas is transparent where nothing is drawn above it, so a YouTube layer always
  shows at the bottom of its stack whatever its index; drift does not apply. Only one YouTube layer shows at a time
  (the lowest visible one). The player needs the internet, which `asset:` videos do not.

### Video library and YouTube import

```json
{ "id": "vid_9k2m1x0a", "name": "big buck bunny", "ref": "asset:7c4e1d", "source": "youtube",
  "url": "https://www.youtube.com/watch?v=aqz-KE-bpKQ", "youtubeId": "aqz-KE-bpKQ", "sha": "7c4e1d", "thumb": "3a9f00",
  "duration": 20, "width": 1920, "height": 1080, "createdAt": "2026-10-14T10:00:00Z" }
```

- A **Video** is one tile of the scenery "videos" category. `source`: `file` (an upload) or `youtube`. `ref` is what
  a layer uses: `asset:<sha>` for files and downloads, `youtube:<id>` for embeds (then `sha`, `width`, `height` are
  absent or 0). `thumb` is a JPEG asset sha (the frame at `start`, made with ffmpeg) or null; clients show
  `https://i.ytimg.com/vi/<id>/hqdefault.jpg` for embeds without one.

| method | path | body / result |
| --- | --- | --- |
| GET | `/videos` | `[Video]`, newest first |
| POST | `/videos` | multipart `file` (MP4, MOV or WebM, up to 512 MB), optional `name` → Video (201); the file is stored as an asset of kind `video` |
| PATCH | `/videos/{id}` | `{ name }` → Video |
| DELETE | `/videos/{id}` | 204 (layers that use it go black: no texture) |
| GET | `/videos/tools` | `{ ytdlp: bool, ffmpeg: bool }`: what the server found on `PATH` (and `/opt/homebrew/bin`) |
| POST | `/videos/import` | `{ url, maxHeight?, start?, end?, name? }` → ImportJob (202) |
| GET | `/videos/import/{id}` | ImportJob |

- `url` must be a YouTube watch, short or Shorts link: `https://(www.|m.)youtube.com/watch?v=<id>`,
  `https://youtu.be/<id>`, `https://(www.)youtube.com/shorts/<id>` (http or https; extra query parameters are
  ignored). Anything else answers 400 `{ code: "invalid_url" }` ("Paste a YouTube link: youtube.com/watch,
  youtu.be or a Shorts link.").
- `maxHeight`: 360 | 480 | 720 | 1080 | 1440 | 2160 (default 1080). `start`, `end`: trim in seconds (≥ 0; `end` 0
  or absent = to the end; `end` must be after `start`).

```json
{ "id": "imp_3k9x0aa1", "url": "https://youtu.be/aqz-KE-bpKQ", "youtubeId": "aqz-KE-bpKQ", "mode": "download",
  "status": "running", "progress": 0.42, "message": "downloading 42%", "maxHeight": 1080, "start": 12, "end": 32,
  "videoId": null, "ref": null, "createdAt": "2026-10-14T10:00:00Z" }
```

- **ImportJob**: `mode` `download` (yt-dlp found) or `embed` (it was not). `status` `running` | `done` | `failed`;
  `progress` 0…1; `message` says what happens now, or why it failed. On `done`, `videoId` names the new Video and
  `ref` is its layer ref.
- With yt-dlp the server downloads the best MP4 at or below `maxHeight` (yt-dlp merges with ffmpeg), trims
  `start`…`end` with ffmpeg (re-encoded, H.264, audio kept), stores it as a `video` asset, makes the thumb and the
  Video (`source: "youtube"`, `ref: "asset:<sha>"`). Progress: download 0…0.8, trim 0.8…0.95, store to 1.
- Without yt-dlp the job is `done` at once with `mode: "embed"` and a Video with `ref: "youtube:<id>"`, and its
  `message` says: "yt-dlp is not installed, so this loop plays as an embedded YouTube player. Install it with brew
  install yt-dlp for offline, sharper loops you can fully blur." The trim becomes the layer's `start` / `end`.
- Channel **`import:{id}`** (editor, remote): `snapshot` of the ImportJob (`v` = an update counter) on subscribe and
  on every change. Channel **`videos`** (editor, remote): `snapshot` with the Video list, like `sounds`.

### Clients

- **Seeding (backend).** A fresh server seeds the desk scene from `scene.json` without the parts that point at files
  it does not have: the pads, the sound tracks and clips, cue sounds and video layers.
- `/out` announces caps `["render", "audio"]`. A browser blocks sound until the page gets a click, unless Chrome
  runs with `--autoplay-policy=no-user-gesture-required` (which `projmap open --out` passes). Until its Web Audio
  context runs, `/out` shows "click to enable sound" over the picture and takes the click; `?headless=1` hides it.
- The editor and the phone play only while `output` names them; the editor's preview sound (above) is separate.
- MCP tools: `sound_list` (the library: sha, name, duration), `sound_play { pad | sound | name, volume? }` (a pad id
  or name in the active scene, or a sound sha or name), and `clip_add` takes `sound` (sha or name), `offset` and
  `volume` to put a sound clip on a sound track (it makes the scene's first sound track when `track` is `sound` or
  absent with `sound` set).

### Server notes (backend)

- **Acks (backend).** `cmd sound.play` → `ack { playId, outputs }`; pressing a looping pad that plays now →
  `ack { stopped: true, outputs }` (no `playId`); `cmd sound.stop` → `ack { outputs }`; `cmd show.audio` → `ack`
  without `d` (the show snapshot carries the change). REST `POST /sounds/play` and `/sounds/stop` answer the same
  objects with 200; `no_audio` is HTTP 409.
- **Stopping loops (backend).** `show.stop` and activating a scene send `sound.stop { padId }` for every pad in
  `loops` before clearing it. `sound.stop { playId }` of a looping pad's play also removes that pad from `loops`.
- **Scenes (backend).** `GET /scenes` and the `scenes` channel list in creation order. `PATCH /scenes/{id}` answers
  the summary with the new `version`. `DELETE /scenes/{id}` is open to editor and remote. A patch that sets `/name`
  to a blank or longer than 80 characters answers 422 `invalid`. A pad may have no `sound` yet (it validates; playing
  it answers `bad_request`).
- **Sounds (backend).** `DELETE /sounds/{sha}` removes the file too (`/a/{sha}` answers 404). `POST /sounds`
  sniffs WAV (`audio/wav`), AIFF (`audio/aiff`), OGG (`audio/ogg`), MP3 (`audio/mpeg`, ID3 or a frame sync) and M4A
  (`audio/mp4`, an `ftyp` box with brand `M4A ` or a `.m4a` name). Uploader peaks are clamped to 0…1. Peaks are
  rounded to 3 decimals; a file shorter than 128 frames gets fewer peaks.
- **Videos (backend).** `POST /videos` sniffs MP4 (`video/mp4`), MOV (`video/quicktime`) and WebM (`video/webm`);
  anything else answers 400 `unsupported`. `GET /videos/import` lists the recent import jobs (in memory, newest
  first, up to 50 finished ones; a restart forgets them). Shorts links on `m.youtube.com` are accepted too. An embed
  is named the given `name` or `youtube <id>`; a download the given `name` or the video's title. A download asks
  yt-dlp for H.264 first and is re-encoded only when trimmed; a trim without ffmpeg ends `failed` ("ffmpeg is not
  installed, so the server cannot trim the download. …"). A failed job's `message` starts "The import failed: ".
  The thumb is the stored file's first frame (a trimmed download starts at `start`). Deleting a Video deletes its
  file when no other Video uses it.
- **MCP (backend).** `sound_play` needs the editor's "agent may preview" toggle, like `preview_on_projector`.

## 15. Light, attachments, motion, scene kinds, viewer and agent live edits (2026-10-15)

Additive on decode: every new field is optional and decodes to the default given here, so older documents load. The
server upgrades stored scenes on start (below). The catalog `version` is 4 (5 with the plates, below). Fixtures:
`scene.json` (static and live stacks with `light` and `attachments`, a motion, `kind`), `preset.json` (a static
preset), `scene-summary.json`, `settings.json`, `ws-messages.json` (a slide `param` and a motion `patch`), and
`catalog.json` itself.

### The light model

A projector in static mode is a spotlight with a projection attachment. The **light** lights the whole frame
(16:9, or 9:16 in portrait) in its colour. **Attachments** (gobos) are masks in front of it that block light, like
metal or glass gobos in the gate: each one multiplies its occlusion on top, so more attachments block more. One
**focus** ring softens the whole projected image, as on a real spotlight. Rotation, position and scale belong to
each attachment.

The `static` and `live` stacks gain `light` and `attachments` (the other stacks keep only `layers`):

```json
"static": {
  "layers": [],
  "light": {
    "intensity": 0.85, "focus": 0.68,
    "color": { "mode": "cct", "kelvin": 3200, "tint": 0, "hue": 212, "sat": 0.7 },
    "fx": { "kind": "none", "speed": 0.35 },
    "colorLayer": null,
    "fringe": 0.2, "vignette": 0.3, "haze": 0,
    "slide": { "x": 0, "y": 0 },
    "motion": null
  },
  "attachments": [
    { "id": "att_window", "gobo": "window-4", "name": "window 4-pane", "visible": true, "opacity": 1,
      "rotation": -12, "offsetX": 0, "offsetY": 0, "scale": 1.25,
      "params": { "cols": 2, "rows": 2, "mullion": 0.35, "throw": 0.25, "skew": 0, "depth": 0.35 },
      "motion": { "on": false, "preset": "sun-lr", "...": "…" } }
  ]
}
```

**StackLight** (`stack.light`; absent or null in `static` decodes to the default light below; in `live` null means
"no light": the layers draw over black as before):

- `intensity` 0…1 (default 0.85), `focus` 0…1 (default 0.7; 1 is sharp, 0 is fully soft; the renderer blurs the
  composed mask by `(1 − focus)^1.5 × 60` px at 1080 p), `color` and `fx` exactly as a layer's `light.color` and
  `light.fx` (default CCT **5600 K**, tint 0; fx `none`). The fx curve (candle, police…) scales the colour layer.
- `colorLayer` (null = the light's own colour): what colours the light before the masks.
  `{ "kind": "gradient", "ref": "<gradient id>", "params": { …gradientParams… } }` or
  `{ "kind": "generator", "ref": "<colorGenerators id>", "params": { … } }` (animated colour, below). A colour layer
  replaces the CCT/HSI colour; `intensity` and `fx` still scale it.
- Lens: `fringe` 0…1 (default 0.2, a chromatic edge: red spreads out and blue in at mask edges, more towards the
  frame edges), `vignette` 0…1 (default 0.3, the beam's falloff towards the corners), `haze` 0…1 (default 0, dust
  and haze texture in the beam).
- `slide` `{ x, y }` in frame fractions, each −1…1 (default 0, 0): the **frame slide**, a pan of the whole composed
  light inside the frame. `x: 0.25` moves the image a quarter of the frame width to the right; what slides out of the
  frame is gone and the uncovered part is black. UIs offer the long axis (x in landscape, y in portrait) with reset.
- `motion` (null = none): a Motion (below) that drives the slide (its path offsets add to `slide`), turns and scales
  every attachment about the frame centre (`rotate`, `scaleFrom`/`scaleTo`) and drifts the CCT
  (`kelvinFrom`/`kelvinTo`). "Sun passes left to right" on the light slides the whole picture.

**Attachment** (`stack.attachments`, bottom to top; order does not matter for masks):

- `id` client-made `att_<8 base36>`, unique across the scene. `gobo`: a catalog `gobos` id. `name` (display).
  `visible` (default true). `opacity` 0…1 (default 1): how much light it blocks; 1 is metal, lower is a glass gobo.
- `rotation` degrees −360…360, `offsetX` / `offsetY` −2…2 frame fractions (centre of the gobo; 0, 0 is the frame
  centre), `scale` 0.05…10.
- `params`: the gobo's own params (catalog item `params`: panes, mullion thickness, slats and opening, density,
  shutter blades…) merged with `goboParams` (`throw` 0…1 stretches the shape away from the light like low sun,
  `skew` −1…1 keystones it, `depth` 0…1 is the frame depth that gives the soft double edge real windows cast).
  Missing params take the catalog defaults (the item's `defaults` override `goboParams` defaults).
- `motion` (null = none): a Motion that moves this attachment (path offsets add to `offsetX`/`offsetY`, `rotate`
  adds to `rotation`, scale drift multiplies `scale`; a kelvin drift on an attachment drifts the stack light).

Rendering a light stack: the colour (`colorLayer` or the light colour) × `intensity` × fx; times the mask, which is
the product over visible attachments of `1 − opacity × (1 − pass)`, and in `live` also the layers with blend
`multiply` (tree sway, palm sway, clouds: procedural shadows block light the same way); the mask is blurred by focus;
then fringe, vignette and haze; then the slide. The other `live` layers (normal, screen, add) draw over the result as
before. With no attachments the whole frame is lit.

Paths: `/backdrop/static/light/focus`, `/backdrop/static/light/slide/x`,
`/backdrop/static/attachments/0/params/slats`, `/backdrop/live/attachments/1/rotation`. Picking "one attachment"
replaces the list: `replace /backdrop/static/attachments` with `[attachment]`. `static.layers` stays `[]` (the server
rejects layers in the static stack).

### Catalog version 4

(Catalog 6, §16, replaces the attachment list with reference plates; the item shape below stays.)

- `gobos` items: `{ id, name, description, category, thumb, params, attachment: { scale, rotation }, focus,
  defaults }`. `category`: `windows` | `blinds` | `nature` | `patterns` | `spots`, and `plates` since version 5
  (listed with display names in `goboCategories`). `thumb` is relative to `/catalog/assets/` (see Thumbnails). `attachment` holds the scale and
  rotation a new attachment of this gobo starts with, `focus` the focus that suits it, `defaults` overrides of
  `goboParams` defaults. The old ids stay (`window` is the 6-pane window, `tree` the medium leaves, `spot` the hard
  round spot). 33 attachments, see `docs/research/gobos.md`.
- `goboParams`: `throw`, `skew`, `depth` (above). `stackLight`: `{ params: { intensity, focus, fringe, vignette,
  haze }, kelvin: 5600, attachmentParams: { opacity, rotation, scale, offsetX, offsetY } }` (ranges for UIs).
- `procedural` items gain `thumb`.
- `colorGenerators`: `[{ id, name, description, animated, params }]`: animated colour (`hue-cycle`, `color-flow`,
  `pulse`, `aurora`, `kelvin-cycle`). Used by a light's `colorLayer` and by a new backdrop layer kind
  **`generator`** (`ref` = generator id, `params` validated against its schema, `light` null) in the `color` and
  `live` stacks. Renderers implement them by id; `docs/effects.md` says how to add one.
- `motionPresets`: `[{ id, name, description, motion }]` (`sun-lr`, `sun-rl`, `drift`, `sway`, `rise`, `set`), the
  exact Motion a preset chip writes (with `startedAt` set by the client). `motionEasings`, `motionLoops`: the enums.
- `sceneKinds`: `[{ id, name, mode, description }]`; `sceneTemplates`: `[{ id, kind, name, description }]`.

### Catalog version 5: metal plates (2026-10-15)

Additive: catalog `version` 5 adds a gobo category and two optional item fields; nothing else changes on the wire.

- `goboCategories` gains `{ "id": "plates", "name": "plates" }`. A **plate** is a round laser-cut metal gobo: its
  cut-outs let light through inside a round light field, the metal blocks it. 43 plates, ids `plate-<name>`
  (`docs/research/gobos.md` §8 lists them).
- A plate item carries `metalThumb` (relative to `/catalog/assets/`, `thumbs/<id>-metal.png`: the plate itself, a
  grey disc with its cut-outs on a transparent ground) next to `thumb` (the light it projects), and, when the design
  follows a real plate, `source` (for example `"inspired by Amaran AS-GB-M MO05"`). Other gobos have neither.
- Every plate has one param of its own, **`field`** (enum `round` | `fill` | `stretch` | `tile`, default `round`,
  label "light field"): `round` projects the round field of a spotlight's aperture; `fill` scales the plate's
  square to cover the frame without distortion ("fill frame"); `stretch` stretches the square to the frame's
  aspect; `tile` repeats the plate across the frame at its size. `defaults` sets `depth` 0. `throw`, `skew`,
  `rotation`, `scale`, `offsetX`/`offsetY`, `opacity` and motion apply as for every attachment.
- Renderers: a plate is vector paths in plate space (the unit circle, y down, viewBox `-1 -1 2 2`, field radius
  per plate, about 0.84) rasterized once into a one-channel mask texture: 4096 px on an output of 1200 px or more
  (a projector), 2048 px on previews and tiles, mipmapped with trilinear and anisotropic filtering, clamped at its
  edge (repeated only in `tile` mode). Where one texel covers several output pixels the shader re-sharpens the edge
  to one output pixel (from the texel footprint), so edges stay anti-aliased and never show the texel staircase. The
  light's mask renders at the output's full size (up to 4096 px), and focus 1 applies no blur at all. At scale 1
  the field is 0.9 of the frame height. The web engine keeps the sources in `frontend/src/render/plates/`. Other
  clients show the thumbnails.
- `GET /catalog/thumbs/<id>-metal.png` serves the metal thumbnail like any other thumbnail.
- Clients: the attachment browser gets a "plates" category; its tiles show the metal plate by default with a toggle
  to show the light instead. The attachment card shows `field` as a segmented control (`fill` reads "fill frame").
- MCP: `catalog_get { section: "gobos" }` lists plates with `category: "plates"` and `source`; `attachment_add`
  and `gobo_set` take a plate id and `params.field`.

### Motion

```json
"motion": { "on": true, "preset": "sun-lr",
  "from": { "x": -0.6, "y": 0.08 }, "via": { "x": 0, "y": -0.04 }, "to": { "x": 0.6, "y": 0.08 },
  "duration": 600, "easing": "inOut", "loop": "loop",
  "rotate": 8, "scaleFrom": 1, "scaleTo": 1, "kelvinFrom": 0, "kelvinTo": 0,
  "phase": 0, "startedAt": 1791700000123 }
```

On a stack light, an attachment, or a `photo` / `video` layer (`layer.motion`, which moves the picture inside the
frame: it can enter and leave).

- `from`, `to` (required), `via` (null = straight): offsets in frame fractions (x of the width, y of the height),
  each −2…2. `duration` seconds 1…86400. `easing`: `linear` | `in` (u²) | `out` (1 − (1 − u)²) | `inOut`
  (3u² − 2u³) | `sine` (½ − ½ cos πu). `loop`: `once` | `loop` | `pingpong`. `rotate` degrees −360…360 over the move.
  `scaleFrom`, `scaleTo` 0.1…10 (default 1, 1; the sun rising shortens shadows: 1.45 → 1). `kelvinFrom`, `kelvinTo`
  0 or 1000…12000 (0, 0 = no CCT drift; both set = drift, for CCT lights only). `preset`: the preset id it came from
  or `""` (custom).
- **Progress** runs on the server clock (Unix ms, not the hourly ambient clock, so hour-long moves stay smooth):
  `u = on ? phase + (serverNowMs − startedAt) / (1000 × duration) : phase`. `once` clamps u to 0…1, `loop` takes
  `u − floor(u)`, `pingpong` maps it to `1 − |1 − (u mod 2)|`. `e = ease(u)`. Position: without `via`,
  `from + (to − from) × e`; with `via`, the quadratic curve through it,
  `(1 − e)² from + 2e(1 − e) c + e² to` with `c = 2 via − (from + to) / 2`. Rotation adds `rotate × e`, scale
  multiplies by `scaleFrom + (scaleTo − scaleFrom) × e`, kelvin is `kelvinFrom + (kelvinTo − kelvinFrom) × e`.
- `phase` 0…2 (default 0), `startedAt` server Unix ms (default 0). Clients set `startedAt` to the server now when
  they turn motion on, pick a preset or change the speed. Pause writes `on: false` and `phase` = the current u;
  play writes `on: true` and `startedAt` = now. A speed change keeps the place: `phase` = current u,
  `startedAt` = now, then the new `duration`.
- **Timeline.** A layer track (§12) may target an attachment id, a backdrop layer id, or the light (`target.id` =
  `light:static` or `light:live`). Clips on it with effect **`motion`** and `params { from, to }` (progress values,
  default 0 → 1) set u from the playhead (`from + (to − from) × progress`, holding like reveal clips); while a
  target has motion clips its own clock is ignored. The target needs a `motion` to move.
- The phone's speed slider maps to `duration` (log scale, 5 s … 2 h).

### Scene kinds

- `scene.kind`: `static` | `live` | `color` | `scenery` | `mapping`. What the scene is for: it picks the controls
  the clients open. Its **mode** is `kind` itself, `objects` for `mapping`.
- **Activating a scene puts its kind's mode on air**: `show.activate` sets `scene.mode` to the kind's mode (a
  `replace /mode` patch by `server`) when it differs.
- Absent on decode: the server infers it on load and stores it: a scene with objects is `mapping`; otherwise its
  `mode` (`objects` → `mapping`). Clients infer the same way when it is missing.
- `GET /scenes` and the `scenes` channel list `[{ id, name, setupId, version, kind, mode }]`.
- `POST /scenes { name, setupId?, duplicate?, kind?, template? }`: with `template` (a `sceneTemplates` id) or a
  `kind` (its default template), the server builds the scene from the template:
  - `static-window` (static): the static light at 3200 K, intensity 0.85, focus 0.68, one `window-4` attachment (since
    catalog 6 `plate-grid-window`, §16)
    (catalog defaults, `throw` 0.25) with the `sun-lr` motion present but `on: false`.
  - `live-window-tree` (live): the live light at 3200 K with a `window-4` attachment and a `tree-sway` layer
    (multiply).
  - `color-ember` (color): one `ember` gradient layer. `scenery-flowers` (scenery): one `flowers` photo layer.
  - `mapping-empty` (mapping): mode `objects`, no objects; the editor opens the reference photo step.
  Without either it is the empty static scene as before (`kind: "static"`).

### Upgrade (server, on start)

Scenes stored before this change are rewritten once:

- In `static` and `live`, every `gobo` layer becomes an attachment (same id, `gobo` = its ref, `rotation` = its
  `light.angle`, `offsetX`/`offsetY` and `scale` from its light, `opacity` from the layer, `visible` kept, `params`
  = its params). The stack light takes the first gobo layer's light: `intensity`, `color`, `fx`, and
  `focus = 1 − softness`. `static.layers` becomes `[]` (non-gobo layers there are dropped); `live` keeps its other
  layers. A `live` stack without gobo layers gets `light: null`. A `static` stack without one gets the default light.
- `kind` is inferred as above.
- Presets of mode `static` are upgraded the same way (`backdrop` becomes the static stack shape).

### Frame slide on the phone and the web

The slide is `light.slide` (above), sent as `param` on drags. Both clients show a slider for the long axis and accept
a horizontal (vertical in portrait) drag on the preview, with a reset.

### Viewer (web route)

| route | what |
| --- | --- |
| `/view?token=…` | the viewer: exactly what the projector shows (the active scene in its mode, at the wall's clock, with the test pattern, solo, video and YouTube layers and live animation) in a chrome-less page with a small hover bar (scene name, mode, fullscreen, close). Role `remote`, name `viewer`, no caps: read only, never the output, never an audio client. Its own sound toggle plays video layers' sound and the timeline's sound clips locally |

`/preview` gains `scene=<id>`: it then follows that scene (in its own mode, at the wall's clock) instead of the
active one, without putting it on air. The phone's long-press preview and the web's quick preview use it.

The editor's "open viewer" buttons open it in a new window sized 16:9 (9:16 in portrait), passing the editor's token
when it has one. The viewer and the editor share nothing but the server.

### Thumbnails

`GET /catalog/thumbs/<id>.png` (no auth, immutable cache headers): a 384 × 216 PNG of a gobo (one attachment under a
warm light) or a procedural layer (and, for a plate, `<id>-metal.png`: the metal plate itself), rendered by the web engine at build time and embedded in the server
(`/catalog/assets/thumbs/<id>.png` serves the same file; catalog items carry `thumb`). 404 for unknown ids.

### Settings

`agentLiveEdits` (default false) joins the settings (§8): when on, the backdrop MCP tools write straight to the live
scene (the phone, viewer and wall change at once); when off they write to the agent's draft as every other write
tool does.

### MCP tools (backdrop side)

| tool | args | does |
| --- | --- | --- |
| `catalog_get` | `{ section? }` (`gobos`, `procedural`, `gradients`, `colorGenerators`, `scenery`, `videos`, `sounds`, `motionPresets`, `sceneTemplates`) | the catalog (and the video and sound libraries), compact |
| `scene_list` | `{}` | scenes with id, name, kind, mode, and which is on the wall |
| `scene_create` | `{ name, kind, template? }` | creates a scene from a template; does not activate it |
| `scene_activate` | `{ scene }` (id or name) | puts it on the wall (its kind's mode goes on air) |
| `mode_set` | `{ mode, scene? }` | `replace /mode` |
| `light_set` | `{ stack?: "static" \| "live", intensity?, focus?, kelvin?, tint?, hue?, sat?, colorMode?, fx?, fxSpeed?, colorLayer?, fringe?, vignette?, haze?, slideX?, slideY? }` | edits the stack light (creates it in `live` if null) |
| `attachment_add` | `{ stack?, gobo, params?, rotation?, offsetX?, offsetY?, scale?, opacity?, motion? }` | adds an attachment (catalog defaults filled in), returns its id |
| `attachment_update` | `{ stack?, id, … }` | changes any of those fields |
| `attachment_remove` | `{ stack?, id }` | removes it |
| `gobo_set` | `{ stack?, gobo, params? }` | the quick pick: replaces every attachment with one of this gobo |
| `backdrop_set` | `{ mode, layers }` | replaces the `live`, `color` or `scenery` layers (ids made when missing, defaults filled) |
| `motion_set` | `{ target: "light" \| <attachment id> \| <layer id>, stack?, preset?, on?, from?, via?, to?, duration?, easing?, loop?, rotate?, scaleFrom?, scaleTo?, kelvinFrom?, kelvinTo? }` | sets or clears (`preset: "none"`) a motion; `startedAt` = now |
| `preset_apply` | `{ preset }` (id or name) | applies a preset to the active scene |

Every write tool targets the active scene (or `scene`). With `agentLiveEdits` on they patch the scene as author
`agent:<name>`; otherwise they append to the agent's draft. Their results say which ("live on the wall" or "in your
draft").

### Server notes (backend)

- **Defaults (backend).** A `motion` object decodes absent fields as `on: true`, `preset: ""`, `via: null`,
  `duration: 60`, `easing: "linear"`, `loop: "loop"`, `rotate: 0`, `scaleFrom`/`scaleTo: 1`, `kelvinFrom`/`kelvinTo: 0`,
  `phase: 0`, `startedAt: 0`. An attachment decodes absent `visible` as true, `opacity` and `scale` as 1. `startedAt`
  may carry a fraction (server ms as a number).
- **Ids (backend).** Attachment ids are not checked for the `att_` prefix (upgraded attachments keep their gobo
  layer's `lay_` id); they must be unique with the layer ids. A layer track whose target is an `att_` or `lay_` id that
  no stack has any more stays valid and moves nothing, so a preset or a pick that replaces the attachments never fails
  on a motion track.
- **Older clients (backend).** A patch that replaces a whole `static` or `live` stack with only `{ layers }` (no
  `attachments` key) is upgraded on the way in like a stored v3 stack (gobo layers become attachments); a patch that
  puts layers into a `static` stack that has `attachments` answers 422 `invalid`. Stored `live` presets are upgraded
  too. Applying a preset gives its layer and attachment ids that another stack of the scene uses fresh ids.
- **Scenes (backend).** `POST /scenes`: `template` wins over `kind`; an unknown `kind` or `template` answers 400
  `bad_request`; `duplicate` keeps the source's kind. Summaries always carry `kind` and `mode`. The activation patch's
  author is `server`; a scene already in its kind's mode is not patched. `POST /scenes/from-photo` makes a `mapping`
  scene (mode `objects`).
- **Templates (backend).** `static-window`'s `sun-lr` motion is `on: false` with `phase: 0.5`: parked in the middle of
  its path, so the window shows in the frame until the motion is turned on.
- **Agent sessions (backend).** A live backdrop write attaches the MCP client's agent session without a draft
  (`draftId: ""`) so its tool events show on `agent:{id}`; its first draft write gives it a draft.
- **Thumbnails (backend).** `/catalog/thumbs/<id>.png` sends `Cache-Control: public, max-age=86400`, like
  `/catalog/assets`.
- **MCP (backend).** The tool args are camelCase as in the table. `scene_activate` needs `agentLiveEdits` or
  `agentMayGoLive`. Live writes are patches against the version the tool read; a concurrent structural edit answers
  "call the tool again". `attachment_add` takes `motion` as a `motionPresets` id; `motion_set` with `on: false`
  stores the current progress in `phase`. `light_set` takes `colorLayer: { kind: "none" }` to clear the colour layer.

## 16. Reference plates, parametric windows, live gallery, video sound and brightness (2026-10-15)

Catalog `version` 6. Every client decodes the new fields as optional, so older documents and catalogs load.

### Catalog version 6: the plate library

**Every attachment is a metal plate** (§15 "Catalog version 5" describes a plate: vector cut-outs in the unit circle,
a round light field, `metalThumb`, the `field` param). The library holds only plates that follow the user's reference
photos in `design/refs/gobo-plates` (README there: which part of each photo is light); nothing is invented. The 33
attachments of catalog 4 (windows, blinds, nature, patterns, spots) and the 23 original plates of catalog 5 are gone
(Migration, below).

- `gobos`: 55 plates, ids `plate-<name>`. Every item carries `thumb`, `metalThumb`, `source` and the `field` param.
  `source` names the reference: `"<file in design/refs/gobo-plates>, <label>"`, with `"; also <file>, <label>"` when
  one design appears on several sheets (for example `"amaran-as-gb-m-set1.png, MO05; also set-a-six-plates.png,
  sunburst and set-b-17-paper-plates.png, Radiant light (80)"`).
- `category` is one of the new `goboCategories`, in browser order: `windows`, `nature`, `sky`, `patterns`, `beams`
  (the `plates` category and the old five are gone). Clients take the categories from the catalog.
- New optional item field **`family`**: `"window"` for the 13 parametric window presets (below); absent otherwise.
- New top-level **`windowParamGroups`**: `[{ id, name, params: [keys] }]`, the window params in display order.
- Every plate starts at scale 1, rotation 0, `defaults: { depth: 0 }`, `focus` 0.82 (0.9 for the fine lines).
- Renderers: a plate is rasterized into its mask texture once; a window preset once per geometry (the attachment's
  window params), keeping only the newest few geometries.
- The list (id: source):

| category | plates |
| --- | --- |
| windows | `plate-grid-window` (MO10), `plate-arched-window` (MO11), `plate-skewed-window` (MO09), `plate-palace-window`, `plate-setting-sun`, `plate-window-grid-iii`, `plate-blinds` (set B), `plate-slanted-window`, `plate-tall-grid-window`, `plate-diamond-window`, `plate-slat-blinds`, `plate-fine-vertical-lines`, `plate-fine-horizontal-lines` (set 4), `plate-louvre` (MO06) |
| nature | `plate-scattered-sticks` (MO13, set A), `plate-water-ripples` (MO15), `plate-flames` (MO19), `plate-bare-branches` (MO21), `plate-fern-leaves` (MO22), `plate-foliage-breakup` (MO23), `plate-bonfire`, `plate-leaf-breakup` (set A), `plate-breakup`, `plate-cracked-branches`, `plate-vine-leaves` (set 2), `plate-tree-with-leaves` (set 3), `plate-jungle` (set B) |
| sky | `plate-rain-lines` (MO07), `plate-snowflakes` (MO16), `plate-lightning` (MO17), `plate-starfield` (MO18), `plate-firework-burst` (MO20), `plate-moon-and-stars`, `plate-eight-point-stars` (set A), `plate-stardust`, `plate-stars` (set 3), `plate-snowflake-field`, `plate-big-snowflake` (set B) |
| patterns | `plate-crossed-lines` (MO12), `plate-pixel-cloud` (MO14), `plate-rings` (MO24), `plate-rainbow-arch`, `plate-hearts` (set 2), `plate-swirl` (set 3), `plate-bubbles`, `plate-squiggles`, `plate-dots`, `plate-maze` (set B) |
| beams | `plate-sunburst` (MO05, set A, set B radiant light), `plate-fan-rays` (MO08), `plate-radial-burst` (set 2), `plate-starburst-cross`, `plate-slit` (set 3, set B gap), `plate-circle`, `plate-radial` (set B) |

- MCP: `catalog_get { section: "gobos" }` lists every plate with `category` and `source`, the `categories`, and for a
  window preset `family: "window"` and `window` (its preset geometry); the window params schema comes once as
  `windowParams` with `windowParamGroups`. `attachment_add`, `attachment_update` and `gobo_set` take window geometry
  in `params`.
- Templates: `static-window` and `live-window-tree` (§15) use `plate-grid-window` with `throw` 0.25 at scale 1.25.
  The starter presets use `plate-grid-window`, `plate-slat-blinds`, `plate-blinds` and `plate-tall-grid-window`.

### Parametric windows

The window plates are one window generator with presets: an attachment of a preset (`family: "window"`) adjusts its
geometry through these params (catalog item `params`, defaults = the preset's values; `windowParamGroups` groups
them). Numbers and integers are clamped to their range, booleans are JSON booleans.

| group | param | type, range | what |
| --- | --- | --- | --- |
| grid | `sashes` | integer 1…4 | sashes side by side |
| | `cols`, `rows` | integer 1…12, 1…16 | panes per sash |
| | `gap` | 0…1 | the pane gap (glazing bars): 0.006 + 0.054 × gap plate units |
| frame | `width`, `height` | 0.1…1 | the window's size as a fraction of the plate's diameter |
| | `frame` | 0…1 | the frame width: 0.16 × frame plate units of metal inside the outline |
| | `mullion` | 0…1 | the bar between sashes: 0.16 × mullion plate units, never thinner than the pane gap |
| arch | `arch` | boolean | a round head on top of the window |
| | `archHeight` | 0…1 | its rise as a fraction of half the width (1 is a half circle) |
| | `spokes` | integer 0…9 | bars splitting the head like a fan light |
| | `hub` | 0…0.8 | a small half wheel at the spokes' centre (with spokes), as a fraction of the head |
| shape | `round` | boolean | a round (elliptic) window; the arch is ignored |
| | `taper` | −1…1 | top width against the bottom: positive is wider at the top |
| | `taperY` | −1…1 | right height against the left: positive is taller on the right |
| | `slant` | −1…1 | the top edge slides right of the bottom (negative: left) |
| | `slantY` | −1…1 | the right side rises (negative: drops) |
| lattice | `diamond` | boolean | each pane is leaded in diamonds |
| | `diamonds` | integer 1…16 | diamonds across one sash |
| | `jewels` | boolean | a framed inner square on every other lattice crossing |
| blinds | `slats` | integer 0…120 | 0 is glass panes; otherwise each pane is that many slats |
| | `slatWidth` | 0.1…0.9 | the metal part of each slat's pitch |
| | `vertical` | boolean | the slats run vertically |

- Geometry: the window is drawn flat (sashes, panes, head, lattice and slats as cut polygons, the metal left between
  them), then mapped by one homography from its flat box onto the quad that `taper`, `taperY`, `slant` and `slantY`
  give, so panes shrink towards the far side as in perspective. No bar is thinner than 0.006 plate units.
- A new attachment of a window preset carries no window params: missing params take the preset. **Reset to preset**
  removes them (`replace .../params` without those keys). UIs show the groups, sliders for numbers and integers,
  switches for booleans, and hide a param whose switch is off (`archHeight`, `spokes`, `hub` without `arch`;
  `diamonds`, `jewels` without `diamond`; `slatWidth`, `vertical` without slats).
- The presets (window params that differ from the plain window: one sash, one pane, gap 0.25, width 0.5, height 0.6,
  mullion 0.3, arch height 1, 4 diamonds, slat width 0.5):

| preset | geometry |
| --- | --- |
| `plate-grid-window` 6-pane grid window | sashes 2, cols 2, rows 4, gap 0.3, width 0.62, height 0.44, mullion 0.35 |
| `plate-arched-window` arched window | cols 3, rows 4, gap 0.3, width 0.34, height 0.6, arch, spokes 4, hub 0.4 (field 0.9) |
| `plate-skewed-window` skewed window | cols 4, rows 5, gap 0.22, width 0.5, height 0.32, taperY 0.6, slantY −1 |
| `plate-palace-window` palace window | cols 4, rows 5, gap 0.4, width 0.46, height 0.5, arch, archHeight 0.72, spokes 2 |
| `plate-setting-sun` setting sun | cols 4, rows 4, gap 0.4, width 0.62, height 0.3, taperY 0.6, slantY 0.6 |
| `plate-slanted-window` slanted window | cols 4, rows 4, gap 0.22, width 0.44, height 0.46, taper 0.8, slant −0.55 |
| `plate-tall-grid-window` tall grid window | cols 5, rows 5, gap 0.2, width 0.42, height 0.64 |
| `plate-diamond-window` diamond lattice window | sashes 3, gap 0.08, width 0.68, height 0.42, mullion 0.4, diamond |
| `plate-window-grid-iii` window grid III | gap 0.3, width 0.84, height 0.84, round, diamond, diamonds 7, jewels |
| `plate-blinds` blinds | cols 3, gap 0.05, width 0.55, height 0.66, slats 22, slatWidth 0.42 |
| `plate-slat-blinds` slat blinds | width 0.5, height 0.6, slats 12, slatWidth 0.22 |
| `plate-fine-vertical-lines` fine vertical lines | width 0.62, height 0.38, slats 64, vertical |
| `plate-fine-horizontal-lines` fine horizontal lines | width 0.58, height 0.58, slats 60 |

### Migration (server, on start)

Scenes and presets carry a document **`format`** (integer): 6 since this change, written on every scene and preset;
absent (0) is a document from before it. Clients decode it as optional and keep it.

- On start the server rewrites every stored scene and preset: each attachment whose gobo was removed moves to the
  closest plate or window preset (below). The attachment keeps its id, name, placement, opacity, visibility and
  motion; its params keep `throw`, `skew`, `depth` and a valid `field`, take the window geometry the old gobo maps to,
  and drop the rest. The server logs one line per move (`upgraded scene to the plate library`, with the scene and
  `<stack> attachment <id>: <old> → <new>`). Reading or patching a document moves removed gobos the same way, so an
  older client that writes one gets the plate.
- Once, for a document below format 6: photo and video brightness × 1.4, clamped to 1 (Video sound and brightness,
  below), logged too. Then `format` becomes 6. Documents read through the API are always current.
- The mapping:

| removed | becomes |
| --- | --- |
| `window-4`, `window`, `barn` | `plate-grid-window` with `sashes` 1 and the old `cols` × `rows` (2 × 2, 2 × 3, 2 × 2) |
| `arch` | `plate-arched-window` with the old `cols` × `rows` |
| `french-doors` | `plate-tall-grid-window`, `sashes` 2, half the old columns per sash, the old rows |
| `skylight` | `plate-skewed-window` with the old `cols` × `rows` |
| `gothic` | `plate-palace-window` |
| `porthole`, `spot`, `spot-soft`, `oval`, `shutter`, `iris` | `plate-circle` |
| `blinds-fine` | `plate-fine-horizontal-lines` |
| `blinds` | `plate-slat-blinds` with the old `slats` |
| `vertical-blinds` | `plate-slat-blinds` with the old `slats` and `vertical` |
| `shutters` | `plate-blinds` with the old `slats` |
| `blinds-wide`, `stripes` | `plate-louvre` |
| `leaves-light` | `plate-leaf-breakup` |
| `tree` | `plate-tree-with-leaves` |
| `leaves-dense`, `plate-dapple-fine` | `plate-foliage-breakup` |
| `palm`, `plate-palm-silhouette`, `plate-monstera`, `plate-jungle-breakup` | `plate-jungle` |
| `branch` | `plate-bare-branches` |
| `ivy` | `plate-vine-leaves` |
| `bamboo`, `plate-bamboo-stalks` | `plate-fern-leaves` |
| `dots`, `plate-portholes` | `plate-dots` |
| `lattice`, `moroccan`, `plate-moroccan-arch` | `plate-window-grid-iii` |
| `honeycomb`, `plate-honeycomb`, `plate-dapple-bold` | `plate-bubbles` |
| `grid`, `plate-skyline` | `plate-tall-grid-window` |
| `stars` | `plate-starfield` |
| `water`, `plate-wave-lines` | `plate-water-ripples` |
| `plate-curved-venetian`, `plate-diagonal-blinds` | `plate-blinds` |
| `plate-stained-glass`, `plate-mesh-fence` | `plate-diamond-window` |
| `plate-concentric` | `plate-rings` |
| `plate-spiral` | `plate-swirl` |
| `plate-starburst-fine` | `plate-radial` |
| `plate-starburst-bold` | `plate-radial-burst` |
| `plate-deco-fan`, `plate-god-rays` | `plate-fan-rays` |
| `plate-triangles` | `plate-breakup` |
| `plate-curtain-window` | `plate-grid-window` |

- Thumbnails of removed ids answer 404.

### Live gallery

Live layers (catalog `procedural`) work like attachments: a **shadow** layer is a mask over the light. The web Show
live panel and the phone Live tab's add-layer sheet show them as a gallery of animated tiles; tapping a tile **tries**
it full size in the preview without putting it on air, and "add to live" commits it.

- Procedural items gain three optional fields: `blend` (the blend a new layer of it gets; absent = `normal`),
  `animThumb` (`"thumbs/<id>-anim.jpg"`, relative to `/catalog/assets/`, also served at
  `/catalog/thumbs/<id>-anim.jpg` with `image/jpeg` and the thumbnails' cache headers), `animFrames` (integer, 36) and
  `animFps` (number, 12). The strip is a vertical JPEG of `animFrames` frames, each 192 × 108, top to bottom, that
  loops seamlessly at `animFps` (its last 8 frames fade into the frames just before the first). It is rendered at
  build time by the web engine (`npm run thumbs`): the layer under a warm 3200 K light filling the frame for a shadow,
  over black for a light effect. Clients that cannot animate show `thumb`.
- `blend: "multiply"` on `tree-sway`, `palm-sway`, `clouds`, `rain-glass` (nature, weather) and `caustics`, `dapple`,
  `film-grain`, `haze` (texture): in a `live` stack with a light, a visible multiply procedural layer joins the
  attachments' mask before the focus blur (§15), so focus softens it like an attachment. `lightning` (it flashes
  over the light) and the light effects `day-cycle`, `sun-drift`, `candle-flicker` stay `normal`. Clients and the
  server (`NewLayer`) give a new procedural layer its item's `blend`; a client that adds a multiply layer to a live
  stack without a light also adds the default stack light (the mask needs light to block). Existing layers keep their
  blend.
- **Try** is client side only: `/preview?scene=<id>&try=<procedural id>` (the phone's hero) and the web Show hero draw
  the scene in live mode with a trial layer (id `lay_try`, catalog defaults and `blend`) on top of the live stack, and
  the default stack light at 3200 K when the stack has none and the layer is a mask. Nothing is sent; another `try`
  replaces it; an unknown id draws the scene as is. "Add to live" adds a fresh layer (`add /backdrop/live/layers/-`,
  plus the light when needed) like any add.
- Realism (renderer only, no wire change): the trees and palms move with one smooth wind per frame (slow swells,
  gusts that build and release, tips moving more than boughs, boughs out of step), each leaf turns on its own stalk,
  and clouds are domain-warped noise in two drifting layers with soft edges. `docs/guides/live-layers.md` says how
  to add a live layer.

### Video sound and brightness

A video layer's own sound (§14 `params.audio`, shown as "sound", and `params.volume`) and the photo controls of
photo and video layers. No message changes; `videoParams.audio` is relabelled "sound".

**Who plays a video's sound.** Only the audio output client (§14 `show.audio.output`), at `volume × master` (0 while
`muted`), live as the master changes:

- `projector`: `/out`. `editor`: the editor's wall preview (Show space). `phone`: no client plays video sound in this
  version (the phone's hero is a `/preview` web view, which never plays sound).
- `/preview`, thumbnails, the editor's other views and the phone stay muted. `/view` plays video sound only while its
  own sound toggle is on (at `volume × master`), as before.
- File videos (`asset:`): the client unmutes the video element at that gain.
- YouTube videos (`youtube:`): the player always loads muted (muted autoplay is never blocked). On a page that may play
  sound the embed URL adds `enablejsapi=1` and `origin=<page origin>`, and the page drives the IFrame Player API over
  `postMessage` (no script tag): it sends `listening` until the player answers (`onReady`, `infoDelivery`), then
  `unMute`, `setVolume [round(volume × master × 100)]` and `playVideo` while the gain is above 0, and `mute`
  otherwise, again on every change. If the browser pauses the unmuted player or keeps it muted (autoplay with sound
  needs a gesture), the page mutes and plays it again and `/out` shows "click to enable sound"; the click retries.
  `projmap open --out` passes `--autoplay-policy=no-user-gesture-required`, so no click is needed there.

**Brightness.** `brightness` 0…1 of photo and video layers is a plain gain: **1 (100 %) is the original picture**
(before, the renderers multiplied it by 1.4, so 100 % clipped colours). Warmth −1…1 gives the channel gains
`(1 + 0.22 w, 1 + 0.04 w, 1 − 0.22 w)` divided by the largest of them, so no channel goes above its original value
at 100 %. The shader and the YouTube CSS (`brightness()` plus a multiply tint) use the same math
(`frontend/src/render/photoLook.ts`). Defaults: `photoParams.brightness` 0.9 (was 0.66), `videoParams.brightness`
0.9 (was 0.8). UIs label it "brightness" and show 100 % as the original.

**Upgrade (server).** Stored scenes and presets from before catalog 6 scale every photo and video layer's
`params.brightness` by 1.4, clamped to 1, once (the `format` marker, Migration above), so they look as they did.

## 17. Output windows (2026-10-15)

A clean projector output: no browser chrome, on the display you pick. Additive; nothing else changes on the wire.

### Full screen on `/view` and `/out`

Chrome keeps the location bar on a pop-up window even in macOS full screen; only the Fullscreen API hides it. Both
pages therefore take it on the document element:

- The first click anywhere enters full screen (on `/out` the same click also unlocks sound, §14). A double-click
  within 600 ms of that first click keeps it.
- Double-click and the F key toggle full screen; Esc leaves it.
- While not full screen, a "click for full screen" hint shows for 3 s after load: big and centred on `/view`, a small
  corner note on `/out` (the launcher puts `/out` in full screen itself, below). `?headless=1` hides it (both routes
  accept `headless`).
- The cursor (and `/view`'s hover bar) hides after 2 s without mouse movement.

### Put on projector (REST, prefix `/api/v1`)

| method | path | body / result |
| --- | --- | --- |
| GET | `/outputs/displays` | `[{ index, name, width, height, scale, x, y, pointWidth, pointHeight, main }]`: the displays attached to the server's Mac, main first. `index` counts from 1 (as `projmap open --out --display`); `width` and `height` are pixels; `x`, `y`, `pointWidth`, `pointHeight` the frame in screen points in Accessibility coordinates (main display top-left = 0, 0, y down: a display above the main one has a negative `y`) |
| POST | `/outputs/launch` | `{ display, route?: "out" \| "view" }` (route default `out`) → 202 `{ launched: true, url, display }` |

- **Local only.** Both answer requests from the server's own Mac (loopback, no `X-Forwarded-For`); anything else is
  403 `forbidden`. They start a program on that Mac.
- Errors: unknown `display` → 404 `not_found`; another `route` → 400 `bad_request`; the display list, Chrome, the
  Accessibility permission or a window that does not land failing → 503 `unavailable` with a message that says what
  happened (for example "the window ended up on display 3 … not on display 2").
- The server opens `http://127.0.0.1:<port>/<route>` (loopback is trusted, so no token) with
  `open -na "Google Chrome" --args --app=<url> --user-data-dir=<data>/chrome-out --window-position=<x>,<y>
  --window-size=<w>,<h> --no-first-run --autoplay-policy=no-user-gesture-required --disable-features=Translate`
  `--remote-debugging-port=0` (each flag one argument, no shell: the data folder path has a space). No `--kiosk`:
  Chrome on macOS ignores the position for displays left of or above the main one. It then finds that Chrome's main
  process (`ps`, by the profile flag), moves its front window inside the display with System Events (`osascript`,
  Accessibility coordinates) and reads the bounds back. Then it puts the page itself into full screen with no
  gesture and no Chrome UI: DevTools on the loopback port Chrome writes to `<profile>/DevToolsActivePort`,
  `Runtime.evaluate` of `document.documentElement.requestFullscreen()` with `userGesture: true`. Without DevTools it
  falls back to macOS full screen of the window (`AXFullScreen`). For `out` it waits up to 12 s for the output's
  telemetry (§1, the canvas: window size × devicePixelRatio) to equal the display's pixel size, give or take 2
  pixels (3840 × 2160 for a 1920 × 1080 point display at 2×). A miss retries, three attempts in all, then 503 says
  what it measured.
  `projmap open --out --display <n>` runs the same code (`internal/infrastructure/browser`).
- The server lists displays with AppKit's `NSScreen.screens` (through `osascript`) and converts the frames
  (origin the main display's bottom-left, y up) to Accessibility points: `y = mainHeight − (frame.y + frame.height)`.
- Clients: the editor shows **put on projector** with a display picker next to "open viewer" (the Show preview's
  top bar and Set up). "Open viewer" stays for a windowed preview.


### Focus, lens and background layers (2026-10-15)

Supersedes the §15 defaults and the "one focus ring" rule; nothing else of §15 changes.

- **StackLight.focus** is the **attachment focus**: 1 is sharp, 0 fully soft. Default **1** (was 0.7). The renderer
  blurs the attachment mask by `(1 − focus)^1.5 × 60` px at 1080 p; at 1 there is no blur at all.
- **StackLight.backgroundFocus** (new, number 0…1, default **1**, absent decodes to 1): the **background focus**. In
  `static` it softens the background (the background layers, or the colour layer, or the light's own colour) under the
  attachments; in `live` it is the **live layer focus**: it softens the live layers, and the multiply live layers
  (tree sway, clouds…) that join the mask are softened by it on their own, then multiplied over the focused
  attachments. Same curve as `focus`. A sharp attachment over a soft background is valid.
- **Vignette** defaults to **0** (was 0.3); the control stays. **Fringe** stays (default 0.2).
- **Haze is gone**: `haze` is no longer in `stackLight.params`, never written, and dropped on decode (server and
  clients). The MCP `light_set` lost `haze` and gained `backgroundFocus`.
- **Static background layers.** `static.layers` now takes layers of kind `solid`, `gradient`, `generator` and
  `procedural` (effects such as caustics or dapple): the static stack reads, bottom to top, **background layers ↓,
  the light, attachments ↑**. While the stack has visible background layers they are the light's colour (composed
  bottom to top over black, normal blend), in place of the colour layer or CCT/HSI colour; intensity and fx still
  scale them. `colorLayer` stays valid as a single background. Other kinds (gobo, photo, video) in `static.layers`
  answer 422 `invalid`. MCP `backdrop_set` takes `mode: "static"` with those kinds.
- **Settings persist.** Picking an attachment (`gobo_set`, a client pick) replaces the plate and its own params only:
  the new attachment takes the replaced one's id, rotation, scale, offsets, opacity, visibility and motion, and the
  light is not touched (a pick no longer writes the gobo's catalog `focus`). Applying a static or live preset takes the
  preset's attachments, layers and light intensity, colour, fx and colour layer, and keeps the scene's `focus`,
  `backgroundFocus`, `fringe`, `vignette`, `slide` and light `motion` (server `PresetOps` and the web client alike).
- **Continuous controls are instant.** A client applies a `param` to its own copy of the document at once and draws it
  the next frame; the web hub sends at most one `param` per path every 16 ms (about 60 Hz), the newest value last, and
  flushes waiting params before a patch on the same channel. A slide is a uniform offset in the compose pass: it never
  rebuilds a plate mask. `/out` applies an incoming `param` to its document and draws it on the next frame.
- **Web Show static panel**: a gallery with two tabs, attachments ↑ (plates) and background ↓ (colours, gradients,
  animated colours, effects as animated tiles); a tap tries the item in the hero only, a bar over the hero puts it on
  ("put it on", "add on top", "add to the background") or cancels. The stack card lists attachments with the
  attachment focus, the light, and the background layers with the background focus.
- **Phone** (iOS): the same fields: show "attachment focus" and "background focus" (static) or "live layer focus"
  (live), default sharp; no haze control; vignette default 0; static background layers listed under the attachments.

## 18. Auto map on real hardware: pre-flight, aim, measured streaming (2026-10-15)

Additive, except the two error codes on `POST /calibrations`.

### REST (prefix `/api/v1`)

| method | path | body / result |
| --- | --- | --- |
| GET | `/camera/preflight` | `{ server, output, camera, ready, reason?, aiming, running }`, below |
| POST | `/calibrations/aim` | `{ on }` → `{ on }`; same as the `calibration.aim` cmd |
| GET | `/agents/available` | `[{ agent: "claude" \| "codex", available, reason? }]`: which agent CLIs the server's Mac can run |

Pre-flight, every check `{ ok, detail, fix? }` (`fix` says in plain words what to do when `ok` is false):

- `server`: always `ok` when it answers (a client that gets no answer shows "can't reach the server").
- `output`: the newest `/out` (role `output`) plus `connected, name, width, height, fps` from its telemetry,
  `setupWidth, setupHeight` of the active setup, and `warning` when the window size is more than 5 % off the setup's
  output (the window does not fill the projector). The warning does not block.
- `camera`: `connected, streaming, fps, width, height, steady, lastFrameAgeMs`.
- `ready` = output ok && camera ok && no calibration running; `reason` says what blocks it.
- `aiming`: the aiming image is up. `running`: the id of the calibration in progress, or "".

### `cmd calibration.aim { on: bool }`

While the phone's setup screen is open it sends `on: true` every 5 s. The server calls
`output.pattern { kind: "white" }` on the output each time (the output already knows `white`, `black`, `gray`,
`off`; full white gives the phone the clearest area to outline), and `{ kind: "off" }` on `on: false` or 15 s after
the last `on: true`. While a calibration runs, `on: true` answers `conflict` and `on: false` does nothing (the
calibration drives the output). No output: `no_output` (409). Ack: `{ on }`.

### Camera status is measured

`GET /camera/status` (and `camera_stream_status`): `streaming` is true while the last `camera.frame` is under 2.5 s
old and `fps` counts the frames that arrived in the last 2 s. The phone's `camera.status` only contributes `steady` and
`level`. Before, both came from the phone's status, so a phone whose status messages stopped (or whose frames did not
arrive) showed the wrong thing.

### Calibration

- `POST /calibrations` with no output: **409 `no_output`** "No projector output is connected. Open the output on
  the projector: in the editor, Set up → put on projector, or run `projmap open --out --display 2`." No phone:
  **409 `no_phone`** (both were 503 `unavailable`).
- One more step at the end, `verify`: white again. The server compares it with the first white (the lit area of each
  against black) and fails with "The phone moved during calibration (about N px). Steady it and retry." when the mean
  edge shift is over 6 camera pixels (at 1280 px wide).
- New failure messages on `calib:{id}` (`step: "failed"`): the output disconnected or did not show a pattern in time,
  the phone disconnected or did not send a photo in time (each names the pattern), and coverage under 5 % ("The camera
  saw only N% of the projection…"). A done calibration under 50 % coverage says so in its message.
- `camera.capture` args gain `purpose` (`calibration`, `snapshot`, `photo`…) and, for calibration, `maxWidth: 1600`:
  the phone shrinks the still (keeping the sensor's pixel layout, no EXIF rotation) before uploading it.

### Phone (ios)

- Preview frames: the `camera.frame` envelope is built on the camera queue, not the main actor, and always goes to
  the current socket. A failed send on the ordered outbox now closes the socket so the hub reconnects; before, it
  ended the outbox silently and every later `camera.status`, `sub` and `cmd` was lost while frames kept flowing.
- "Phone is steady" = attitude changed less than 0.5° over the last 1.5 s. It does not block the start.
- The light check finds the projected area (pixels well above the room) and outlines its quad on the live preview,
  in capture-device coordinates. Candidates draw the same way over the live camera.

### Real-hardware fixes (same day)

- **Stills one pattern behind.** On a real rig every capture showed the previous pattern: `/out`'s "presented" comes
  before the projector shows the frame, and iOS zero shutter lag returns a frame from before the request. The phone
  turns off zero shutter lag, responsive capture and fast capture prioritization (quality `.balanced`). The server
  keeps `SettleDelay` and checks synchronisation: after black it measures white − black; if black looks like white
  it doubles the settle (at least 250 ms, at most 1.5 s), takes it again and starts the pass over from white. Coarse
  Gray-code steps (bit ≥ max(4, bits − 4)) and `verify` must change at least 15 % of the lit area against the step
  before, else the still is retaken with a longer settle. The learned value is `settleMs` on the calibration.
  If black still looks like white at 1.5 s, the calibration fails at once with the contrast message.
- **Low contrast.** The decoder thresholds the white − black difference adaptively: 3×3 box blur, Otsu split, noise
  floor 4 × the unlit side's MAD, at least 3/255 (a fixed `MinContrast` still overrides). A bit is readable when
  pattern − inverse clears both 15 % of the local white − black and 2.5 × √2 × the noise. `quality.contrast =
  { lit, median, peak, room, noise, threshold, brighterPct }` (0–255 levels; `brighterPct` = peak over the room
  level). Decode failures say what the camera saw ("The projector light is only N% brighter than the room…").
  `diffAsset` (|white − black| × 4, PNG, ≤ 640 px) is on every calibration, failed ones too.
- **EXIF.** Stills are decoded in the sensor's pixel layout and EXIF orientation is ignored everywhere (preview
  frames, stills, the phone's downscaled stills, the decoder), so all camera pixels share one frame.
- **Exposure.** Before starting, the phone meters exposure and focus on the marked object (or the middle of the
  projected area) while the output shows the aiming white, then locks them for the whole pass.
- **Light check.** `POST /calibrations/lightcheck` → `{ level: "strong" | "weak" | "none", message, contrast, at }`:
  white, black, white on the output, compared on the phone's preview frames (the darker of the two whites). The last
  one (10 min) is `preflight.light`. 409 while a calibration runs; `no_output`, `no_phone` as above.

### Region of interest and adaptive precision

- `POST /calibrations` takes `{ setupId, roi?: {x, y, w, h} (scene px), cameraRoi?: {x, y, w, h} (camera-view
  fractions 0…1 of the still) }`; MCP `calibration_run` takes `roi`. The server keeps `roi`, `cameraRoi` and
  `projectorRoi` (physical projector px: the scene ROI, or the camera ROI through the setup's previous calibration,
  plus a 6 % margin of at least 24 px) on the calibration.
- With `projectorRoi`, every `output.pattern` carries `roi: {x, y, w, h}` (physical px): the output should draw the
  pattern inside it and black outside. **`/out` does not do this yet** (frontend change pending); `projmap sim` does.
  Decoding drops correspondences outside `projectorRoi` and camera pixels outside `cameraRoi` either way.
  `calibration.aim { on, cameraRoi? }` lights only that area when an earlier calibration can place it.
- Adaptive bits: per camera pixel, a run of unreadable bits from the finest up is blur; up to 2 are dropped and the
  pixel sits at the centre of the 2^k px interval the readable bits leave; more, and it gets no correspondence. One
  more unreadable bit above that run is a stripe edge and keeps its sign.
- Quality adds `sharp` (share of mapped pixels with at most the last bit lost) and `roi: { mapped, sharp, errorPx }`
  over the lit pixels inside the ROI (the whole frame when none). `errorPx` only uses sharp pixels. The done message
  says "Sharp area mapped: N%" and warns under 40 %.
- `confidenceAsset`: 8-bit PNG at decode resolution, 0 = no correspondence, else 255 · bits read / bits per axis.
  MCP `calibration_get` returns it as an image; `surface_create_from_camera` refuses a point with no correspondence
  within 2 decode px and names the nearest reliable camera pixel.
- Map PNG version 2: B = 65535 − lost bits when valid (version 1 maps still load).

### `projmap mcp` bridge

The stdio bridge keeps the client's `initialize` (and `notifications/initialized`). When the server's session is
gone (a restart answers "session not found") or a write fails, it reconnects, replays them, resends every call that
had no answer, and carries on; a call it cannot deliver within 30 s gets a JSON-RPC error instead of silence. It
exits only when the client closes stdin. Bridges started before this change still die with the server: restart
Codex (or kill those `projmap mcp` processes) once to pick up the new binary.

### Restarts and stale patterns

- On start the server marks every calibration still `running` as `failed` with "Interrupted: the server restarted
  during calibration. Run it again." and publishes `{ step: "failed", message }` on `calib:{id}` (a later `sub` gets
  the same snapshot). The phone also reads `GET /calibrations/{id}` every 3 s while calibrating, so it shows the
  failure even though its old subscription died with the server.
- `/out` drops a calibration or aiming pattern 15 s after the last `output.pattern`, and at once when its hub
  connection drops; while disconnected it shows "reconnecting to projmap…" in the corner.
- `output.pattern` (calibration, aim, light check) goes to exactly one client: the newest connection with role
  `output`. The pre-flight shows that output's window size next to the setup's size.

## 19. Object accent (2026-10-15)

The mapped objects can be drawn over a backdrop mode, so a gobo's pattern falls over the object while its edges glow.

```json
"objectAccent": {
  "on": true,
  "objects": "all",
  "outline": { "on": true, "width": 3, "color": "#ffffff", "glow": 0.3 },
  "fill": { "on": false, "opacity": 0.5, "mode": "cut" }
}
```

- **One setting per scene**, optional on decode (absent = off; the defaults above with `on: false`). It applies in
  every backdrop mode (`static`, `live`, `color`, `scenery`) and never in `objects` mode, where the objects draw
  themselves. Clients add it with `add /objectAccent` (the whole object) and then edit leaves (`replace
  /objectAccent/outline/width`, params while a slider moves).
- `objects`: `"all"` or a list of object ids. Ids of objects that no longer exist draw nothing (deleting an object
  never fails on the accent). Hidden objects are skipped.
- **Silhouette**: the outer outline of each object, the union of its faces (visible surfaces that are not details,
  edges, lines or masks). Faces that meet share corner points (§1), so an edge two faces use is inside and is not
  drawn; details are never drawn. A circle face draws its own outline. Faces that overlap without sharing points
  show their own edges.
- `outline`: `width` in scene px (0…64), `color` `#rrggbb`, `glow` 0…1 (soft bands around the line). The line is
  never blurred (no focus), so the mapping edge stays sharp.
- `fill.mode`: `light` adds a soft light of the outline colour inside the silhouette, `cut` blocks the backdrop
  inside (the object stays dark with lit edges), `only` shows the backdrop only inside; `opacity` 0…1 is the
  strength.
- The same engine draws it on `/out`, `/view`, `/preview` (the phone's previews) and the editor.
- **Validation (server)**: width 0…64, glow and opacity 0…1, colour `#rrggbb`, mode one of `light`, `cut`, `only`,
  objects `"all"` or a string list.
- **Editors**: the web Show panel has an "object accent" card under static and live (switch, object pick, width,
  glow, colour, fill mode and strength); the phone's Static and Live tabs have a compact card (switch, width and glow
  sliders, fill switch, fill mode, strength). Every object is accented on the phone; the web card picks them.
- **MCP**: `object_accent_set { scene?, on?, objects?, outline?, width?, color?, glow?, fill?, fill_mode?,
  fill_opacity? }` changes only the fields passed (`objects: ["all"]` for every object; names or ids otherwise).
  Live with "agents edit live", else in the draft.

## 20. Converge and state that carries over (2026-10-15)

The opening of a mapping sequence: the light on the wall (a spot, a window, a gradient, a photo) closes onto the mapped
object's outline, then the animations play. Every step continues from the state before it. Catalog `version` 7 (one
new effect). Fixtures: `scene.json` (track `trk_converge`, clip `clp_converge` with `hold`), `ws-messages.json`
(`cmd show.converge` and its `ack`), `catalog.json` (effect `converge`).

### Hold: every clip may keep its end state

```json
{ "id": "clp_converge", "trackId": "trk_converge", "effect": "converge", "start": 0, "end": 2, "fadeIn": 0, "fadeOut": 0,
  "params": { "from": "current", "source": "static", "ease": "inOut", "edge": 6, "outline": true }, "hold": true }
```

- `clip.hold` (boolean, optional; absent or null = the effect's default): **true** for `converge`, `reveal`, `sweep` and
  `motion` (the layer clips always held, §12, §15), **false** for every other effect.
- A clip that holds stays in effect after its `end`, at progress 1 and without its fade out, until the next clip
  **with the same effect on the same track** starts (a later `start`; at the same `start`, the one further down
  `timeline.clips`). A clip without hold ends at its `end` as before.
- Layer clips (§12, §15) with `hold: false` go back after their end to the value they had before the clip (the `to`
  of the last held clip, or the first clip's `from`) until the next clip starts.
- **The state at time t is the evaluation of every clip up to t with its hold.** It depends on the document and t only:
  GO, `seek`, `back`, a restart or a client that joins late all land on the same picture as playing there, so stepping
  to the next cue continues from the previous state and never starts empty. Renderers keep no state between frames.
- MCP: `clip_add` and `clip_update` take `hold`; `timeline_get { t }` adds `at`: the clips in effect at t
  (`{ clipId, trackId, effect, progress, held }`).

### The converge effect

A built-in clip effect on a `surface`, `object` or `all` track (not on layer or sound tracks). Catalog params:

| param | values | what |
| --- | --- | --- |
| `from` | `current` (default) \| `circle` \| `frame` | where the light starts: `frame` the whole frame; `circle` the light's round spot, else the frame's inscribed circle; `current` the light's round spot, else the frame |
| `source` | `static` \| `live` \| `color` \| `scenery` (default `static`) | whose light converges: that backdrop mode, rendered exactly as in its own mode (light, attachments, focus, live layers, colours, photos, videos; a YouTube layer does not show) |
| `ease` | `inOut` (default) \| `in` \| `out` \| `linear` | the motion curves of §15: `in` u², `out` 1 − (1 − u)², `inOut` 3u² − 2u³ |
| `edge` | 0…200 scene px (default 6) | the soft edge of the moving outline |
| `outline` | boolean (default false) | draws the silhouette in the object accent's line style (§19: `objectAccent.outline` width, colour and glow) as it lands, over the content |

- **The round spot** (`current`, `circle`) of a `static` or `live` source is the smallest circle around what its
  visible plates with `field: "round"` let through: per plate, how far its cut-outs reach from its centre (at most its
  field), at its offset, scale, rotation and motion, grown by the throw, skew and focus blur, moved by the frame slide;
  with several plates, the smallest. Plates with `fill`, `stretch` or `tile` fields and the modes without a light
  (`color`, `scenery`) have none.
- **The silhouette** is the union outline of the target's faces (the accent's silhouette, §19: visible faces that are
  not details, edges, lines or masks); for `all`, every visible object; for a surface track, that surface's outline.
  Hidden objects converge to nothing.
- **Rendering** (scene px, at eased progress e): `d = mix(sdStart, sdSilhouette, e)` with signed distance fields
  (negative inside; the frame start is padded by `edge` so its border stays lit), and the source drawn with coverage
  `1 − smoothstep(−h, h, d)`, `h = max(edge / 2, half an output pixel)`, times the clip's fade in. At p = 0 the
  picture is the source's own (the switch from that mode is seamless), at p = 1 the light covers the silhouette only.
  The renderers compute the polygon SDF in the shader (at most 128 silhouette points in 16 loops; longer outlines are
  thinned evenly).
- Order in `objects` mode: the underlay (§1, unchanged; turn it off for a dark wall around the object), the converge,
  the mapped content (faces, layers, effects, other clips), then the converge outline.
- Held (the default), the object stays lit by the source inside its silhouette until another converge on that track
  starts. Converge clips never reach surface content: the faces' own clips draw over the lit object.
- Only in `objects` mode (and the editor stage, which previews objects mode; Space plays the morph there), like every
  timeline clip.

### `show.converge`: start with converge

`cmd show.converge { sceneId?, duration?, objectId?, source? }` (also `POST /show/converge`), atomically:

1. **Source**: `source` when given (a backdrop mode, else 400 `bad_request`), else the scene's mode when it is a
   backdrop mode, else (already in `objects` mode) the converge clip's own `source`, else `underlay.from`. Clients
   pass the backdrop mode they last saw on air: opening their objects view puts objects on air first.
2. **Clip**: the converge clip that starts at 0 (the first by track order) gets that `source`. Without one, a new
   clip at 0 of `duration` seconds (0.1…60, default 2, capped at the timeline's duration) with
   `{ from: "current", source, ease: "inOut", edge: 6, outline: false }` goes onto a track of the target (`objectId`,
   or the first visible object; `"all"` for every object) that is free over that time, else a new track
   `"<object name> · converge"`. Nothing else moves.
3. **Cues**: when no cue is at 0 it adds one (`"converge"`); when no cue is at or after the clip's end it adds one there
   (`"after converge"`).
4. **Mode**: `replace /mode` with `objects`. Steps 1 to 4 are one patch by the sender.
5. **Transport**: playing from 0, `cue` = the cue before the first cue at or after the clip's end, so playback holds
   there (§9) and GO continues. A sound on the cue at 0 plays. Another `sceneId` is activated first.

Errors: no active scene `no_scene`; no object to converge onto, an unknown `objectId`, a bad `duration` or `source`
`bad_request`. Answer `ack` (the scene and show snapshots carry the change).

- **Web**: the Show space's objects panel has **start with converge** (a primary button above GO, with a line saying
  which light closes onto which object). The editor's effects library has **converge**; its clip inspector edits
  starts from, light from, ease, soft edge, outline at the end and **hold the end** (every clip has the hold switch). A
  converge dropped on a track takes the mode on air as its `source`.
- **Phone**: the Objects tab has **start with converge** above GO; it sends the last backdrop mode seen on air.
- **MCP**: `converge_start { scene?, duration?, object?, source? }` (needs "agent may go live").
