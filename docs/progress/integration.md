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
