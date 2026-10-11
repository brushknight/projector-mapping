# Backend architecture

The Go module `projmap` in `backend/`. Same layering as content-media-manager (domain, application services and
ports, infrastructure, handlers, MCP tools, one composition module per section), at the size this project needs:
one service implementation package per section, no per-use-case command packages.

## Sections

| section | owns | domain | service (interface → implementation) |
| --- | --- | --- | --- |
| show | live state, transport on the server clock, cues | `domain/show` | `services/show` → `showsvc` |
| scenes | scene documents, op log, undo/redo, drafts, presets | `domain/scene`, `domain/docpatch` | `services/scenes` → `scenesvc` |
| setups | projector rigs, scene ↔ physical transform | `domain/setup` | `services/setups` → `setupsvc` |
| catalog | built-in catalog, user and agent effects | `domain/catalog` | `services/catalog` → `catalogsvc` |
| assets | content-addressed files, thumbnails | `domain/assets` | `services/assets` → `assetsvc` |
| devices | pairing codes, tokens, roles, presence | `domain/devices` | `services/devices` → `devicesvc` |
| camera | stills, preview feed, calibration, detection, alignment | `domain/camera` | `services/camera` → `camerasvc` |
| agents | sessions, runner, event log, agent toggles | `domain/agents` | `services/agents` → `agentsvc` |

## Layout

```
backend/
├─ cmd/projmap/                 serve · open · pair · mcp (stdio bridge) · sim · install
├─ internal/app/                composition root: app.go (New, Handler, Start, Stop), modules.go, seed.go
├─ internal/domain/<section>/   plain Go entities and rules (no GORM, Echo, IO)
├─ internal/application/
│  ├─ app_errors/               the wire errors: code + HTTP status ({code, message})
│  ├─ services/<section>/       service interfaces; <section>/<impl>/ the implementation
│  └─ ports/
│     ├─ repository/<section>/  storage ports
│     └─ out/{realtime,camera,agents}/  hub (publish, RPC, presence), camera feed + vision, agent runner
├─ internal/infrastructure/
│  ├─ database/sqlite           open + goose migrate (glebarez/sqlite, pure Go)
│  ├─ database/migrations       versioned SQL, embedded
│  ├─ database/sql/<section>/   GORM models and repositories
│  ├─ filesystem/blobs          assets/ab/cd/<sha256>
│  ├─ realtime/hub              /ws: channels, params, patches, commands, RPC, telemetry, camera relay
│  ├─ vision/                   Gray code, decoder, homography/RANSAC, plane segmentation, alignment, synthetic world
│  ├─ vision/adapter            the camera Vision port over vision/
│  ├─ discovery                 Bonjour _projmap._tcp
│  ├─ clients/agentrunner       claude -p / codex exec with MCP attached, JSON stream → AgentEvents
│  ├─ http_server/              Echo, error replies, auth middleware, handlers/<section>/
│  └─ mcp/                      server.go (resources, prompts, sessions), tools/<group>/
├─ internal/catalog/            embedded catalog.json, fixtures, effects.md, scenery photos (make catalog)
├─ internal/web/                embedded React build (dist/), SPA fallback or a placeholder page
├─ internal/sim/                projmap sim: fake output + fake phone + synthetic camera
├─ internal/apitest/<section>/  every route over HTTP plus WebSocket and MCP flows
└─ internal/contract/           every contract fixture decodes and re-encodes unchanged
```

Rules: dependencies point inward (infrastructure → application → domain). Handlers, the hub and MCP tools depend on
service interfaces only; `internal/app` is the one place that names implementations.

## Concurrency

- **Scenes:** one goroutine (actor) per open scene owns the JSON document; patches, param commits, undo and redo
  run on it in order, each commit writes the document and an op-log row (ops plus inverse ops) in one transaction,
  then broadcasts `patched`. Params are forwarded at once and committed by a per-path coalescer 200 ms after the last
  value. Stale rule: base must equal the version unless every op replaces an existing scalar.
- **Drafts:** a draft stores its base document and ops; the view is base + ops; apply re-applies the ops on the
  current document through the scene actor (rebase), refusing with 409 when they no longer apply or validate.
- **Show:** one mutex; a timer armed after each change holds at the next cue, follows auto-follow cues, ends previews
  and pauses at the end.
- **Hub:** per connection a reader, a writer, a bounded ordered queue (256) and newest-only slots for continuous
  messages; overflow drops the backlog and resends snapshots. RPCs go to the newest matching client and time out.

## Storage

`<data>/projmap.db` (SQLite, WAL, one connection) and `<data>/assets/ab/cd/<sha256>`. Tables: setups, scenes (doc +
version), ops, drafts (doc + base doc), presets, effects, assets, devices (token hashes), agent_sessions,
agent_events, calibrations, kv (show, settings, server id). Data folder: `~/Library/Application Support/projmap` or
`$PROJMAP_DATA`. First run seeds the desk setup and scene (contract fixtures) and seven presets.

## Calibration path

`POST /calibrations` → for white, black and every Gray bit (x then y, normal then inverse): `output.pattern` RPC to the
output (waits for its answer), `camera.capture` RPC to the phone (waits for the still upload) → each still reduced to
≤ 1280 px gray → `vision.Decode` (per-bit normal vs inverse, Gray → binary, median outlier filter) → dense
camera → projector map (16-bit PNG asset) + quality (coverage of 16 px projector blocks, local affine residual) →
setup.calibrationId. Detection fits RANSAC models per camera block, grows planar regions and simplifies them to
quads. `projmap sim` exercises the whole path with a synthetic desk and cube.
