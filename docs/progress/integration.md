# Integration check (2026-10-11)

Run on one Mac with `backend/projmap` built by `make build` (the React app embedded) and a fresh data folder.

| check | result |
| --- | --- |
| server boots, seeds the desk setup and scene and the presets | ok |
| `/out`, `/editor`, scenery photos served from the binary | ok |
| `/out?headless=1` renders the backdrop (window + tree) and the Zima cube reveal at t=5 s (trace) and t=10.5 s (bays, cpu, fan, lamp) | ok, by Playwright screenshots |
| editor loads the live scene: surfaces tree, stage with points, inspector, timeline with cues | ok |
| `projmap sim` + `POST /calibrations`: Gray-code calibration | done, coverage 97.6 %, error 0.71 px, 4 surface candidates |
| iPhone app (simulator) pairs with a real code over `projmap://connect`, shows up online in `/devices`, hero preview renders the real scene through `/preview` | ok |

Not covered yet: a real projector, a real iPhone (iOS 27 needs Xcode 27, which is installed), a Codex agent session
(Codex is not installed), on-wall calibration.

# Integration check (2026-10-15): light model, kinds, viewer

Server built from this tree (web app embedded), fresh `PROJMAP_DATA`, on a side port (never 7400).

| check | result |
| --- | --- |
| fresh server seeds the desk scene (kind mapping) with the §15 static and live stacks | ok |
| `POST /scenes { kind }` for static, live, color, scenery builds the templates; `show.activate` puts the kind's mode on air | ok |
| `/out?headless=1` draws window 4-pane, blinds, leaves, framing shutters, porthole, church window and palm attachments | ok, Playwright screenshots (`gobos/out-*.png`) |
| a 9 s sun pass (motion on the attachment, warm to cool) moves the window across `/out` | ok, `gobos/motion-1..3.png` |
| editor Show: attachment browser with server thumbnails, scenes grouped by kind with live thumbnails and quick preview | ok |
| `/view`: the wall, read only, with the hover bar | ok |
| iPhone (simulator) on the Mac's LAN IP: Static tab with thumbnails, motion card, scene picker by kind, long-press preview, hero recovers after a failed first load | ok, `gobos/ios-*.png` |
