# Backend progress

Status as of 2026-10-11. Everything below is implemented, tested and race-clean unless it says otherwise.

## Run it

```bash
cd backend
make dev                 # server on :7400, data in backend/.data (PROJMAP_DATA overrides)
make build               # builds ../frontend into internal/web/dist (npm ci + npm run build), then ./projmap
./projmap serve          # default data folder ~/Library/Application Support/projmap
./projmap open           # opens the editor; prints a one-time LAN login link
./projmap open --out --display 2   # /out in a Chrome kiosk window on display 2
./projmap pair           # prints the 4-character pairing code
./projmap sim            # fake phone camera + fake projector output (calibration without hardware)
./projmap install        # launchd login item dev.projmap.server, logs in the data folder
make test                # all Go tests (about 25 s); make test-race for the race detector
make lint                # go vet + gofmt
make catalog             # copy contract/catalog.json, contract/fixtures, docs/effects.md into the module
```

Env: `PROJMAP_DATA`, `PROJMAP_PORT` (7400), `PROJMAP_BIND` (0.0.0.0), `PROJMAP_BONJOUR=0`, `PROJMAP_SEED=0`,
`PROJMAP_URL` (for the CLI subcommands).

MCP for Claude Code and Codex:

```bash
claude mcp add projmap -- /path/to/projmap mcp          # or: claude mcp add --transport http projmap http://127.0.0.1:7400/mcp
# ~/.codex/config.toml
[mcp_servers.projmap]
command = "/path/to/projmap"
args = ["mcp"]
```

`projmap mcp` starts the server in the background when it is not running.

## Done

1. **Skeleton:** `cmd/projmap` with serve, open (login link, `--out` Chrome kiosk on a display via NSScreen), pair,
   mcp (stdio ↔ streamable HTTP bridge, starts the daemon), sim, install (launchd, as agents-deck). Makefile.
2. **Store + domain:** all protocol entities; SQLite (glebarez, pure Go) + goose migration; scenes as JSON doc +
   version + op log with inverse ops; seed from the fixtures plus seven presets (golden hour, office am, noir
   blinds, breezy window, storm, ember, flowers).
3. **Scene service:** actor per scene, JSON Patch (evanphx) with computed inverses, validation (unique ids, point
   refs, kinds, point counts per kind, catalog refs, param schemas, numeric ranges, track targets, clip timing),
   param coalescing (forward now, commit after 200 ms), stale rule, undo/redo, history, drafts (create, ops, view,
   propose, apply with rebase, discard), presets (create from a scene, apply, delete).
4. **Hub `/ws`:** hello/welcome, localhost trusted, device tokens, ping/pong (server ns), all channels with
   snapshots, param/patch/reject on scene, setup and draft channels, cmd/ack/error (show.*, setup.testPattern,
   camera.capture), server → client RPC with timeouts, telemetry on devices, camera.frame/status relay
   newest-only, bounded queues with snapshot resync.
5. **Show:** go/back/play/pause/stop/seek/blackout/activate, hold at cues, auto-follow, end of timeline, agent draft
   preview (`show.preview`), unix-ns `startedAt`.
6. **REST:** every route of protocol §2 plus the (backend) additions in §9; assets content-addressed with JPEG/PNG
   size and 512 px thumbnails, HEIC stored as is; `/a/{sha}` immutable; `/catalog/assets/scenery/*.jpg`; pairing
   (5 min code, one use, tokens stored as sha256); Bonjour `_projmap._tcp` with TXT name, v, id; private-network
   only.
7. **Web:** embeds `internal/web/dist`, SPA fallback for every non-API GET, placeholder page when not built.
8. **MCP:** 32 tools (read, look, write, act incl. the auto-map ones), resources `scene://current`,
   `effects://catalog`, `docs://effect-api`, `docs://style-guide`, prompts `animate-object`, `reveal-sequence`.
   Writes go to the session's draft; act tools check "agent may preview" / "agent may go live"
   (`GET/PATCH /api/v1/settings`, both off by default). Images downscaled to ≤ 1280 px. `output_render` and
   `output_render_strip` use `render.frame` on a client with cap `render`.
9. **Agent runner:** `claude -p --output-format stream-json --verbose --mcp-config … --strict-mcp-config
   --allowedTools mcp__projmap --permission-mode dontAsk` (prompt on stdin, MCP over HTTP with a scoped token) and
   `codex exec --json --skip-git-repo-check --sandbox read-only -c mcp_servers.projmap.command=… -c approval_policy="never"`
   (through `projmap mcp --token`). Events stream to `agent:{id}`; cancel kills the process; the token is revoked when
   the run ends. Verified with the real Claude CLI on this Mac (scene_get + proposal_submit round trip). Codex is not
   installed here: `POST /agents/sessions {agent: "codex"}` answers 503 with a clear message; its flags follow the
   current `codex exec --json` docs and are untested against a real binary.
10. **Camera + calibration:** capture requests, `/camera/stills`, Gray-code sequencer per §7, decoder, 16-bit PNG
    map asset, quality, inverse map, `surface_create_from_camera`, plane segmentation for `detect_surfaces`,
    `alignment_error` with outlines, `camera_compare` overlay. Decoder tests on synthetic frames warped by known
    homographies: mean error < 1 px.
11. **`projmap sim`:** fake output (answers output.pattern/outline, follows the active scene) and fake phone
    (answers camera.capture with a rendered still of a synthetic desk and cube, streams camera.frame at 6 fps).
    Against the sim a full calibration takes about 6 s: 98 % coverage, 0.7 px error, wall + 3 cube faces detected.
12. **Tests:** `internal/apitest/{devices,catalog,setups,scenes,show,assets,agents,camera,realtime,mcp}` (every route,
    WS flows incl. param coalescing, stale reject, cmd go/blackout, RPC timeout, camera relay, telemetry, MCP over HTTP
    with a fake render client, calibration against the sim), `internal/contract` (every fixture and ws-message
    round-trips, the fixture scene validates), unit tests for docpatch, show rules, setup transforms, runner parsing,
    vision. `go vet` clean, `-race` clean.

13. **Modes (protocol §11):** `scene.mode`, per-mode backdrop stacks, `scene.underlay`; validation (mode, underlay,
    layer ids unique across stacks); load-time upgrade of v1 scenes (`scene.Upgrade`: gobo → static, gradient and
    solid → color, photo → scenery, procedural → live with gobo copies `_live` under them) and a rewrite of every
    stored scene on start (`UpgradeStored`); presets snapshot `backdrop[mode]` (mode defaults to the scene's) and
    apply as `replace /backdrop/<mode>` + `replace /mode`; `cmd scene.mode`; MCP `scene_get` reports the mode and the
    four stacks; MCP renders ask for `mode: "objects"`.
14. **Test pattern expiry:** `setup.testPatternUntil` (server Unix ns) set by every write that turns a pattern on
    (`cmd setup.testPattern {seconds}` 1 to 600, default 60; PATCH; patch; param), a timer per setup that sets it
    back to off and broadcasts `patched` (by `server`), patches that touch `/testPattern` broadcast the new deadline,
    and on start patterns past their deadline turn off (patterns without one get 60 s).
15. **Drawing effect:** catalog v2 with the built-in `drawing` and the param type `strokes`, validated per stroke
    (tool, at least 1 or 2 UV points in -1..2, #rrggbb colour, width 0..500, size, text, fill; at most 2000 strokes and
    20000 points).
16. **CLI:** `projmap open` builds the LAN login link with the port of `PROJMAP_URL` when it names one.

Tests for these: `apitest/scenes/modes_test.go` (mode switch, stale-free `/mode`, stack pick, unique ids across
stacks, `scene.mode` command, strokes accept/reject, drawing clip, upgrade of a v1 scene on restart),
`apitest/setups/testpattern_test.go` (60 s default, renew, expiry broadcast, PATCH and patch deadlines),
`domain/scene/upgrade_test.go`, `cmd/projmap/main_test.go`.

## Stubbed or left out

- HTTPS and the local CA (plan §11): the server speaks plain HTTP on the LAN. iOS needs an ATS exception for the
  local network until this lands.
- WebRTC camera relay (Pion): preview is JPEG over the WebSocket (protocol §5 v1).
- chromedp headless render fallback: not built; `output_render` needs the editor or `/out` open with cap `render`.
- `effect_create` runs a static check only (balanced braces, the `effect()` signature, forbidden calls); the real
  compile is the renderer's. There is no `effect.compile` RPC yet.
- `scenes/from-photo` sets the reference photo and makes an empty scene; it does not detect surfaces from a single
  photo (calibrated detection works through `detect_surfaces`).
- Undo/redo stacks live in memory (the op log with inverses is persisted; stacks reset on restart).
- Preset thumbnails (`thumbAsset`) stay null; no server-side rendering.
- `projmap export scene.zip` is not implemented.
- golangci-lint is not set up; `make lint` is go vet + gofmt.
- Open drafts made before the mode upgrade keep their `/backdrop/layers` ops; applying such a draft fails with a
  clear error (discard it). There is no MCP tool to switch the mode; agents' mapping drafts show on the wall in
  objects mode (preview) and the user puts objects on air.

## Notes for the other clients

- Everything the server adds is in `docs/protocol.md` §9 (backend): transform convention, message payloads,
  delivery order, draft/agent/calib channels, transport semantics, extra REST routes.
- Clients on this Mac need no token; keep the hello `name` stable (one device per name and role).
- The output must answer `output.pattern` and `output.outline` RPCs, draw outlines above patterns, render
  `show.preview.draftId` instead of the live scene while it is set, and announce cap `render` to serve
  `render.frame` (upload a PNG with kind `snapshot`, answer `{ sha }`).
- The phone answers `camera.capture` by uploading to `/api/v1/camera/stills?request=<requestId>` (multipart field
  `file`) and replying `rpc.result { sha }`.

## Content layers, atlases and solo (protocol §12, 2026-10-12)

- `surface.layers`, `object.layers` (content layers) and `object.atlas` decode, validate and round-trip; missing
  common fields decode to their defaults; empty lists are omitted. Content layer ids are unique across the scene.
- Track target `layer`; clips on a layer track take effect `reveal` (from/to 0..1) or `sweep` (from/to -10..10) and
  no other params.
- `show.solo` (`cmd show.solo`, `POST /show/solo`): fill defaults to content, seconds 1..600 (default 60), `[]` clears,
  sending again renews; its own timer clears it at `until` and broadcasts the show; a restart drops an expired one.
  Surface ids are not checked against the scene (a backstage draft may solo surfaces the live scene lacks).
- `cmd show.preview { draftId, t?, play? }` / `POST /show/preview`: `t` defaults to 0, `play` to false.

## Show control, sound and video (protocol §14, 2026-10-14)

Built:

- **Scenes:** `POST /scenes {name, setupId?, duplicate?}` (empty scene on the active setup, or a deep copy with a new
  id and version 1), `PATCH /scenes/{id} {name}` (a `replace /name` patch; answers the summary), `DELETE` refuses the
  active scene with 409 `scene_active`. Names trimmed, 1..80 (also on `/name` patches). Channel `scenes` (summary
  list, `v` = ms) on create, duplicate, import, delete and every committed name change. The list is in creation
  order (rowid). `show.activate` stops the transport, clears `preview` and `audio.loops`, keeps `onAir`, `audio` and
  `solo`.
- **Active scene fix:** `showsvc.New` keeps the stored `activeSceneId` when that scene exists, otherwise activates
  the first scene of the list, and stores the show at once (also on a first start), so a seeded server restarted
  before any show change keeps `scn_desk`.
- **Seed:** `scene.StripMedia` removes pads, sound tracks and their clips, cue sounds and video layers from the
  fixture scene before seeding.
- **Scene domain:** `sounds.pads` (always written; defaults volume 1, color ink, icon none), pad validation, track
  target `sound` (id null), `sound` clips only on sound tracks and only sound clips there (`sound`, `offset >= 0`,
  `volume 0..1`), `cue.sound {sound, volume}` (volume defaults to 1), layer kind `video` with `asset:<sha>` or
  `youtube:<11>` refs and catalog `videoParams` (catalog v3).
- **Sounds:** asset kinds `sound` and `video`; Asset `name`, `duration`, `peaks` (new columns, migration
  `00002_media.sql`). `GET/POST /sounds`, `PATCH/DELETE /sounds/{sha}`, `POST /assets kind=sound`. WAV and AIFF are
  read in Go (PCM 8/16/24/32, float 32/64, AIFF-C NONE/sowt/fl32/fl64); others through ffmpeg (mono f32 at 8 kHz)
  and ffprobe (duration); else the uploader's `duration`/`peaks`; else `0`/`[]`. Channel `sounds`.
- **Audio:** `show.audio {output, volume, muted, loops}` (pointer, always set by the server; `POST /show/audio`,
  `cmd show.audio`). `cmd sound.play` / `POST /sounds/play`, `cmd sound.stop` / `POST /sounds/stop`: direct messages
  through a new `realtime.Direct` port (`hub.SendDirect`) to every connection with cap `audio` and the output's role;
  `no_audio` when none. Looping pads toggle through `show.audio.loops`; `show.stop`, activate, `sound.stop` without
  ids and a restart clear them. Cue sounds play on GO and when playback passes an auto-follow cue (tick), never on
  seek or back, and not while a draft preview plays.
- **Videos:** `GET/POST /videos` (streamed multipart up to 512 MB to `<data>/tmp`, moved into the blob store),
  `PATCH/DELETE /videos/{id}`, `GET /videos/tools`, `POST /videos/import`, `GET /videos/import/{id}`,
  `GET /videos/import` (recent jobs). Table `videos`. Channels `videos` and `import:{id}`. ffprobe for size and
  duration, ffmpeg JPEG thumb (512 px). Imports: yt-dlp in the background (`--newline` progress → 0..0.8, H.264
  first at or below maxHeight, `--ffmpeg-location`, `--write-info-json` for the title), ffmpeg trim (H.264 + AAC,
  0.8..0.95), store, thumb, Video; failures end `failed` with the tool's last error line. Without yt-dlp the job is
  done at once as an embed with the §14 message.
- **Media tools:** port `application/ports/out/media`, implementation `infrastructure/clients/mediatools`: looks on
  PATH, then `/opt/homebrew/bin` and `/usr/local/bin`, on every call. `app.Options.Media` injects it; the test
  harness uses PATH only (`apitest.ToolsPath` writes fake tools and sets PATH).
- **MCP:** `sound_list`, `sound_play {pad | sound | name, volume?}` (needs "agent may preview"), `clip_add` with
  `sound` (sha, sha prefix or name), `offset`, `volume` (makes the first sound track; no `end` = the sound's length).
  Server instructions, the agent prompt and `timeline_get` mention sounds.
- **CLI:** `projmap open --out` already passes `--autoplay-policy=no-user-gesture-required` (the only place the CLI
  opens Chrome).

Tests: `apitest/scenes/crud_test.go` (CRUD, duplicate independence, rename via PATCH and patch, `scenes` channel,
`scene_active`, activate keeps onAir/audio, restart keeps the active scene, active scene deleted underneath),
`apitest/sounds` (WAV upload with 128 peaks, uploader fallback, unsupported, rename/delete and the channel, pads and
sound-track validation, video layer refs, routing to `/out` with cap audio and not to `/preview` or a remote without
it, output editor/phone, `no_audio`, loops toggling, cue sounds on GO and auto-follow, none on seek),
`apitest/videos` (embed fallback, invalid URLs, fake yt-dlp download with progress, trim without ffmpeg fails, a
failing yt-dlp, file uploads, persistence over a restart), `apitest/mcp/sounds_test.go`, unit tests for YouTube URL
parsing (`domain/videos`), WAV/AIFF/peaks/sniffing (`assetsvc/audio_test.go`), pad/sound-track/video validation
(`domain/scene/sounds_test.go`), loops toggling and the start fix (`showsvc/sound_test.go`), and the contract test
decodes sound.json, video.json, import.json, the new ws-messages and round-trips scene.json through Decode/Encode.
Tried by hand on port 7461 with real ffmpeg: an MP3 gets duration 3.03 s and 128 peaks, an MP4 upload gets 640x360,
4 s and a thumb, and a fake yt-dlp import with start 1, end 3 is trimmed by ffmpeg to 2 s.

Left out: imports are not resumed after a restart (jobs live in memory); progress of yt-dlp's separate video and
audio downloads shows as one bar that never runs backwards; no ffmpeg re-encode of untrimmed downloads.
