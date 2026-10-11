# projector-mapping (working name `projmap`)

A projector as a creative light and a mapping tool. One Go server owns every scene, setup, preset and asset. The
projector output, the laptop editor (React) and the iPhone app (SwiftUI) are clients of it, and Claude/Codex reach it
over MCP.

Read first: `docs/implementation-plan.html` (architecture and milestones), `docs/protocol.md` (the wire contract),
`docs/mcp-plan.md`, `docs/effects.md`.

## Layout

| folder | what | conventions from |
| --- | --- | --- |
| `backend/` | Go 1.24 module `projmap`: server, MCP, agent runner, calibration | `~/dev/brushknight/content-media-manager` (`docs/architecture.md` there) |
| `frontend/` | React 18 + TS + Vite + TanStack Router: `/out`, `/preview`, `/editor`, `/components`; builds into `backend/internal/web/dist` | `~/dev/brushknight/content-media-manager/web` (`web/CLAUDE.md` there) |
| `ios/` | SwiftUI iOS 26 app, xcodegen, local package `PM` (PMKit, PMStore, PMLive, PMDesign, PMCamera, PMPreview) | `~/dev/brushknight/cmm-ios`, `~/dev/brushknight/warden-ios` |
| `contract/` | `catalog.json` (built-in gobos, layers, gradients, scenery, effects) and `fixtures/*.json`; every client decodes every fixture in its tests | — |
| `design/` | `boards/*.png` (phone v4 and editor v2 at 2x), `html/` (exact sources: colours, sizes, copy), `photos/` | — |

## Rules

- The protocol is the contract. Changing a message or entity means updating `docs/protocol.md`, `contract/fixtures`
  and all three decoders in the same change.
- The backend is the only source of truth. Clients never invent ids for server entities except as optimistic
  temporaries, and never persist scene data anywhere but through the server.
- Design: match the boards in `design/`: black ground, ink `#F5F4F0`, dim `#8C8A85`, one red `#FF3B30` for on air,
  Share Tech Mono + Roboto Mono, rounded modern iOS on the phone and rounded panels in the editor.
- Copy: active voice, no em dashes, controls say what happens.
- Port 7400. Data folder `~/Library/Application Support/projmap/` (override with `PROJMAP_DATA`).
