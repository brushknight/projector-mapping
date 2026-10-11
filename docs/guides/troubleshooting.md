# Troubleshooting

Start with these three checks:

```bash
projmap version
curl -s http://127.0.0.1:7400/api/v1/info        # does the server answer?
tail -n 50 ~/Library/Application\ Support/projmap/projmap.log   # the launchd agent's log
```

## The server

**`projmap open` or `projmap pair` says the server is not running.** Start it with `projmap serve`, or install the
login item with `projmap install`. If you run it on another port or machine, set `PROJMAP_URL`
(`PROJMAP_URL=http://studio-mac.local:7401 projmap pair`).

**Port 7400 is in use.** Another projmap is probably running (often the launchd agent). Check with
`lsof -nP -iTCP:7400 -sTCP:LISTEN`. Run a second one on another port with its own data:
`PROJMAP_DATA=/tmp/projmap-test projmap serve --port 7401 --no-bonjour`.

**The launchd agent.** `launchctl print gui/$(id -u)/dev.projmap.server` shows its state. `projmap install` again
restarts it (and picks up a new binary). To remove it:

```bash
launchctl bootout gui/$(id -u)/dev.projmap.server
rm ~/Library/LaunchAgents/dev.projmap.server.plist
```

**macOS blocks the binary** ("cannot be opened because the developer cannot be verified"). Release builds are not
notarized yet. Clear the quarantine flag: `xattr -d com.apple.quarantine ~/.local/bin/projmap`. The installer uses
curl, which does not set the flag, so this only happens with a browser download.

**macOS asks to allow incoming connections.** Allow it, or the phone and other machines cannot reach the server.

**Start over with an empty scene.** Stop the server and move the data folder away
(`~/Library/Application Support/projmap`). The next start seeds the sample scene again (`PROJMAP_SEED=0` skips that).

**The editor shows "The web app is not built into this binary".** You built the Go binary without the web app.
Use `make build` in `backend/` (it builds `../frontend` first), or run `make dev` plus `npm run dev` in `frontend/`.

## The projector output

**`projmap open --out` opens on the wrong screen.** Displays are numbered in macOS's order, 1 being the main display.
Try `--display 3`, or drag the window and press ⌘⇧F. The projector must extend the desktop, not mirror it.

**The output stays on the pairing screen.** Nothing has made a scene active yet, or the output cannot reach the
server. Open the editor or pair the phone. An output on another machine needs a token (see
[projector-setup.md](projector-setup.md#mini-pc-or-raspberry-pi-5)).

**The output is black.** Check the on-air pill (blackout), the master level and the mode: mapped objects show only in
objects mode, and a backdrop mode shows only its own stack. In objects mode without surfaces or effects the wall is
black on purpose.

**Choppy output.** The editor and the phone show a warning when the output drops frames. Close other GPU-heavy apps,
use the projector's native resolution, and avoid AirPlay or mirroring. Check that Chrome uses hardware acceleration
(`chrome://gpu`).

**A test pattern disappeared.** Test patterns turn off after 60 seconds. Pick it again to renew it.

## The phone

**The app does not find the server.** The phone and the server must be on the same network, and Local Network access
must be on (Settings → Privacy & Security → Local Network → projmap). Guest networks and some mesh Wi-Fi systems block
Bonjour; type the address instead (`studio-mac.local:7400` or the IP address). The server must not run with
`--no-bonjour` or `PROJMAP_BONJOUR=0`.

**The pairing code does not work.** Codes are valid for 5 minutes and work once. Get a fresh one with
`projmap pair` or from the projector's pairing screen.

**Sliders say "not connected".** The phone lost the server. Drags are never queued offline (so an old move can never
replay on the wall); other edits wait and are sent when it reconnects.

**Auto map will not start.** The server needs both an output (`/out`) and the phone's camera connected. Keep the app in
the foreground on auto map while it runs.

## Agents

**`output_render` fails.** It renders in a browser: keep the editor or `/out` open on the server's machine.

**The agent cannot show anything on the projector.** Turn on "agent may preview on projector" in the editor's agent
panel. Transport control needs "agent may go live". Both are off by default.

**Starting Claude or Codex from the phone fails.** The `claude` or `codex` CLI must be installed and logged in on the
server's machine and on the server's `PATH`. The launchd agent's `PATH` includes `~/.local/bin`, `/opt/homebrew/bin`
and `/usr/local/bin`.

**Claude Code does not list the tools.** `claude mcp list` should show projmap as connected. Use the full path to the
binary in `claude mcp add`, and check that `projmap mcp` starts on its own in a terminal (it waits for input; Ctrl-C
quits).

## Building from source

**`make build` fails in npm.** Use Node 22 or newer. `npm ci` needs `frontend/package-lock.json` in sync with
`package.json`.

**`go` wants another toolchain.** The Makefile runs Go with `GOTOOLCHAIN=local`; install Go 1.24 or newer.

**`swift test` or `xcodebuild` picks the wrong toolchain.** If another Swift (swiftly, a Homebrew toolchain) comes
first on your `PATH`, run with Xcode's: `PATH=/usr/bin:$PATH swift test --package-path Packages/PM`, and check
`xcode-select -p` points at Xcode 27.

**The Xcode project is missing or out of date.** It is generated: `cd ios && xcodegen generate`.

**Signing errors on a device.** Set your own team and, if needed, bundle id; see
[iphone-app.md](iphone-app.md#your-iphone).
