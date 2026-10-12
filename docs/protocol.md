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
    of their box); `pen` takes 2 or more; `text` takes one (the top left of the text).
  - `tool`: `pen` | `line` | `rect` | `ellipse` | `text`. `width` (stroke) and `size` (text height) are in scene
    pixels of the surface, like other effects' px params. `fill` (rect, ellipse) fills with `color`.
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
| `output.outline` | output | `{ surfaceIds, color, width, ms }`: flash outlines for an alignment check |
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
| `/out` | the projector output: fullscreen, idle pairing screen, role `output` |
| `/preview?token=…&w=…&mode=hero\|layer&layer=<id>` | a chrome-less render of the active scene (or one layer, from any stack) for embedding in the iPhone app's WKWebView. Same engine, lower resolution, no pairing UI, role `remote` (read only). The hero draws the scene's `mode` and the active test pattern exactly like `/out` |
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
- **Agent permission toggles (frontend).** `GET /api/v1/settings` → `{ agentMayPreview, agentMayGoLive, … }` and
  `PATCH /api/v1/settings` with a partial body. Both toggles default to false. The editor hides them on 404.
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
