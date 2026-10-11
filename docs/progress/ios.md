# iPhone app progress

Status as of 2026-10-11. Native SwiftUI, iOS 26, iPhone only, dark, Swift 6 language mode, bundle
`com.brushknight.projmap`, team 3J46XQAXC4. Only dependency: GRDB 7.

## Build, test, run

```bash
cd ios
xcodegen generate
PATH=/usr/bin:$PATH swift test --package-path Packages/PM          # 60 tests (contract, store, hub)
SIM=$(xcrun simctl list devices | grep projmap-dev | grep -oE '[0-9A-F-]{36}')   # own simulator, iPhone 17 Pro
scripts/build.sh $SIM                                              # xcodebuild + install
xcrun simctl launch $SIM com.brushknight.projmap -pm-demo -pm-screen live   # offline demo on a board's screen
scripts/compare.sh $SIM static                                     # board | simulator in ios/.build/compare/
```

Against a running server:

```bash
PROJMAP_TEST_SERVER=http://127.0.0.1:7400 PATH=/usr/bin:$PATH swift test --package-path Packages/PM --filter LiveServerTests
CODE=$(curl -s http://127.0.0.1:7400/api/v1/pair/code | python3 -c 'import json,sys;print(json.load(sys.stdin)["code"])')
xcrun simctl launch $SIM com.brushknight.projmap -pm-reset -pm-connect "projmap://connect?server=127.0.0.1:7400&code=$CODE"
```

Launch arguments: `-pm-demo` (offline, fixtures + board data in memory), `-pm-screen <static|staticfx|live|addlayer|
color|scenery|objects|setup|automap1…4|connect>`, `-pm-scroll <pt>`, `-pm-reset` (forget server and cache),
`-pm-connect <projmap://connect?server=…&code=…|token=…>`. The URL scheme `projmap://connect` works too.

## Layout

| part | what |
| --- | --- |
| `project.yml` | xcodegen; the app bundles `../contract/fixtures`, `../contract/catalog.json`, `../design/photos` (demo + offline scenery) |
| `PMKit` | wire models (tolerant decoding, `JSONValue` params), JSON Patch + Pointer, `SceneIntent`, `Envelope`, catalog with param order kept, REST client for every §2 route used, `projmap://connect` links, Keychain `TokenStore`, Bonjour `BonjourBrowser` (`_projmap._tcp`, resolves to IPv4) |
| `PMStore` | GRDB: show, setups, scenes (confirmed doc + version, and the shown doc = confirmed + pending intents), presets, catalog bytes, devices, outbox; `ValueObservation` queries (`observeActive`, catalog, scenes, presets, devices) |
| `PMLive` | `LiveHub`: hello/welcome, reconnect backoff, clock sync (8 pings, median, every 30 s), subscriptions (show, presets, devices, active scene and setup, agent, calib), snapshot/param/patched into the store, outbox pump (one patch in flight per scene, stale rebase from intents, 5 tries), 60 Hz param throttle (never queued offline), `cmd` with ack/error/timeout, RPC handlers, camera frame/status sender (newest only), agents + calibration, offline demo mode |
| `PMDesign` | phone v4 kit from the board CSS: palette, Share Tech Mono + Roboto Mono (bundled OFL TTFs), SVG path parser so every board icon is drawn from its source, FillSlider (54 pt, difference blend, detents, haptics every 10 % and at 0/100), StripSlider, Segmented, Pill/IconPill/GlassPill, Card, ListCard/ListRow, Tile, FXTile, ImageCard + Badge, WideButton, PMSwitchStyle, CheckRow, SearchField, PageDots, ProgressLine, IslandTabBar, OnAirDot; native art (gobo tiles, light hero with tree mask, gradient hero, objects grid, desk camera scene) |
| `PMCamera` | `CameraController` (session, 960 px JPEG frames at ~8 fps, locked full-res stills, light analysis), `CameraPreview`, `MotionMonitor` (steady after 3 s, level) |
| `PMPreview` | `PreviewWebView`: transparent, non-scrolling WKWebView on `/preview?token=…&w=…&mode=…`, placeholder until loaded and on failure |
| `App/` | Connect, the five tabs, add layer sheet, projector setup, auto map 1–4, camera bridge, demo data |

## What works

- Connect: Bonjour list, typed address, 4-character code (pairs on the 4th character), QR scan, `pairingRequired:
  false` shortcut, token in the Keychain, "look around without a projector" (demo).
- Header on every tab: title, projector settings, on-air pill (tap = `cmd show.blackout`, shows blackout/offline).
- Static: hero, 8 gobo tiles (catalog), intensity/softness/angle params, white (CCT strip, tint, CCT presets) / color
  (hue, saturation) / effects (8 FX tiles, speed), presets (apply = `replace /backdrop`, save via REST outbox,
  hold to delete).
- Live: layer list (top first, select, eye toggles visibility, hold-and-drag reorder = `move`, hold for remove),
  add layer sheet (search, category pills, catalog cards with LIVE badge), selected layer sliders generated from the
  catalog param schema (plus light params for gobos, opacity), atmosphere toggles (clouds, rain on glass, bulb
  flicker, day cycle are procedural layers switched on/off and kept out of the list), presets.
- Color: catalog gradient cards, colour stops (system picker, sent as params), add/remove stop, drift/grain/brightness.
- Scenery: photo cards (bundled copy first, else `/catalog/assets/scenery/<id>.jpg`), category pills, blur
  (as aperture) / brightness / warmth / slow drift, "use my photo" (PhotosPicker → `/assets` → photo layer
  `asset:<sha>`).
- Objects: scene chips (`show.activate`), hero, cue progress with server-clock playhead, back/GO/stop, auto map
  entry, objects list with lit/waiting/off from the timeline and ▸ reveal (`show.seek` + `show.play`).
- Projector setup: linked computer card (output device + telemetry, RTT), orientation, flips, test pattern
  (`cmd setup.testPattern`), master, blackout fade (cut/0.5 s/2 s), haptics and keep-awake switches, disconnect.
- Auto map: camera (or the drawn desk in the simulator), steadiness/projector-light/dim checklist, start →
  `POST /calibrations` + `calib:{id}` progress (backend step names), candidates from `/calibrations/{id}/candidates`,
  prompt + codex/claude + send → `POST /agents/sessions`, live log from `agent:{id}`, keep (`/drafts/{id}/apply`),
  fix on laptop, ask to animate; "just take a photo for the laptop" → `/assets` kind reference.
- `camera.capture` RPC answered with a locked still uploaded to `/camera/stills?request=…`.
- Verified against the real backend (`LiveServerTests`): pairing, catalog, snapshot, param commit, outbox patch,
  blackout command, clock sync.

## Pixel compare (`scripts/compare.sh`, fuzz 6 %, system status bar and home indicator differ)

| board | differs | notes |
| --- | --- | --- |
| static / staticfx | 4.2 % | staticfx's board shows the same top as static |
| live | 5.8 % | tree mask sways, so leaves differ by frame |
| scenery | 6.1 % | catalog names ("cherry blossom", "desert sunset", "city bokeh") where the board shortens them |
| objects | 5.9 % | |
| setup | 5.4 % | server name wraps one word earlier |
| automap1 | 3.8 % | label says the real stream ("720p · 8 fps", board "30 fps"); level on one line |
| automap2 | 16 % | stripe phase of the animated Gray code |
| automap3 | 5.2 % | |
| automap4 | 4.1 % | |
| color | 25 % | the hero drifts and is a native blur stand-in; gradients interpolate slightly differently |
| addlayer | 44 % | native sheet (system position and scale-down of the tab behind it); "arch" is the catalog name ("arch window" on the board) |

## Modes and test pattern expiry (2026-10-11)

- `Scene.mode` and the four stacks `backdrop.static|live|color|scenery` plus `underlay` (PMKit `SceneBackdrop`,
  `Underlay`, `Scene.layers(_:)`, `onAirLayers`). `ScenePath` takes the mode: `/backdrop/<mode>/layers/…`.
- Tabs switch what is on air: tapping a tab sends `replace /mode` (`SceneIntent.setMode`); the tab bar shows a red
  dot on the on-air tab, and the hero label says "<mode> on air" when another client switched the mode.
- Static, color and scenery picks replace their stack with one layer (`SceneIntent.replaceStack`, `StackPick`),
  keeping the gobo's light and the photo's adjustments. Live, the add layer sheet and atmosphere edit the live stack.
- Presets apply with `SceneIntent.applyPreset` (stack + mode) and save the tab's stack.
- Projector settings: the test pattern counts down from `setup.testPatternUntil`, "keep on" renews (60 s), and the
  pattern reads as off once it expires. The demo stamps the expiry too.
- Catalog v2 (`drawing` effect, `strokes` param type) and array effect params decode; sliders skip non-numeric
  params as before.
- Tests: contract (mode, stacks, underlay, drawing strokes, `testPatternUntil`, legacy split, catalog v2), intents
  (mode patch, static pick keeps light, scenery pick keeps params, preset ops), store (preset apply shows at once),
  hub (tab sends a mode patch, demo mode + test pattern).

## Stubbed or left out

- Hero previews use `/preview`; without the built frontend the backend serves a plain page, and offline/demo the
  native stand-ins draw the backdrop (not the WebGL engine).
- No WebRTC (JPEG frames over the WebSocket per §5). No HTTPS/CA pinning (backend is plain HTTP; ATS
  `NSAllowsLocalNetworking`).
- Dictation is the keyboard's; the mic button focuses the prompt.
- "draw" in auto map and "fix on laptop" only point to the editor.
- Calibration end-to-end with a real projector + phone is untested (only the demo and the protocol shapes).
- Not tested on a device yet (simulator only).

## For backend and frontend

- `/preview` must render with a transparent or black page background and finish loading quickly; the phone shows its
  native stand-in until `didFinish`, and on any HTTP error.
- The phone sends `patch` with `d` as the op array, `base`, `id`; it relies on `patched.re` to retire outbox items
  and on `reject.v` to decide whether to re-subscribe.
- `camera.capture` without `requestId` is answered via `/assets` (see protocol §10).
- Named auto-map objects would be nicer than "surface N": an optional `objects` on the calibration result is read.
