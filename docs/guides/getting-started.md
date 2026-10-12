# Getting started

This guide takes you from nothing to a backdrop on the wall and the phone as a remote. It takes about ten minutes.

You need:

- a Mac (Apple Silicon or Intel) or a Linux machine to run the server;
- a projector connected as a second display (HDMI or USB-C);
- Google Chrome (or Chromium) for the projector output;
- optionally an iPhone with iOS 26, for the remote and auto map. The app is built from source for now; see
  [iphone-app.md](iphone-app.md).

Everything stays on your local network. The server needs no internet.

## 1. Install

```bash
curl -fsSL https://raw.githubusercontent.com/brushknight/projector-mapping/main/install.sh | sh -s -- --service
```

The installer picks the build for your platform, checks it against the release's `SHA256SUMS` and installs
`projmap` to `~/.local/bin`. With `--service` on macOS it runs `projmap install`, which registers the launchd agent
`dev.projmap.server`: the server starts now and at every login, and restarts if it stops. Logs go to
`~/Library/Application Support/projmap/projmap.log`.

If `~/.local/bin` is not on your `PATH`, the installer prints the line to add to `~/.zshrc`.

Other options:

```bash
curl -fsSL .../install.sh | sh                          # install only; run projmap serve yourself
curl -fsSL .../install.sh | sh -s -- --version v0.1.0   # a specific release
```

To build from source instead, see the README.

## 2. Run the server

With `--service` it is already running. Otherwise:

```bash
projmap serve
```

It listens on port 7400 on every interface (so the phone can reach it), keeps its data in
`~/Library/Application Support/projmap` (`PROJMAP_DATA` changes that) and advertises itself over Bonjour as
`_projmap._tcp`. On first run it creates a sample setup, a desk scene and seven presets.

Check it:

```bash
projmap version
curl -s http://127.0.0.1:7400/api/v1/info
```

## 3. Open the editor

```bash
projmap open
```

This opens `http://127.0.0.1:7400/editor` in your browser. A browser on the same Mac needs no login. The command
also prints a one-time link (valid 5 minutes) for an editor on another computer on the network.

The editor has two spaces on one screen: **map** (draw and adjust the faces on the stage) and **content** (the faces
unfolded flat, to put pictures, drawings and effects on them); **Tab** switches. The timeline folds under the stage,
and **set up** in the top bar holds the projector, the reference photo and **auto map** (finding surfaces with the
phone camera). The rail at the top left walks through reference, faces, content and play. The editor is made for a desktop browser, 1100 px wide or more.

## 4. Put the output on the projector

```bash
projmap open --out --display 2
```

This opens `/out` in its own Chrome window in kiosk mode (fullscreen, no browser chrome) on display 2. Display 1 is
the main display; the numbers follow macOS's display order. Until a controller connects, the output shows a pairing
screen with a 4-character code and a QR code.

On Linux, or to do it by hand, open `http://<server>:7400/out` fullscreen in Chrome. More options (mini PC,
portrait, test patterns) are in [projector-setup.md](projector-setup.md).

## 5. Pair the phone

1. Put the iPhone on the same Wi-Fi as the server.
2. Open the projmap app. It lists servers it finds over Bonjour; tap yours, or type the address
   (`macbook.local:7400` or an IP address).
3. Type the 4-character code the projector shows, or scan its QR code. `projmap pair` prints the same code.
   A code is valid for 5 minutes and works once.

The phone keeps its token in the Keychain, so you pair once. Allow Local Network access when iOS asks; without it
the app cannot find or reach the server.

No projector yet? "look around without a projector" on the connect screen opens a demo with sample data.

## 6. Make some light

On the phone, each tab is a mode, and opening a tab puts that mode on air. One mode is on air at a time:

| tab | what the wall shows |
| --- | --- |
| static | one gobo (window, blinds, leaves…) with intensity, softness, angle, colour and light effects |
| live | a stack of moving layers: tree sway, clouds, rain on glass, caustics, day cycle |
| color | a gradient wash with drift and grain |
| scenery | a blurred photo, built in or one of yours |
| objects | the mapped objects and their timeline, with GO, back and stop |

Each mode keeps its own settings, so switching from live to static and back brings the live stack back as you left
it. Presets save and recall one mode's look. The on-air pill at the top toggles blackout.

The editor shows the same scene and a mode switch. To map real objects, continue with [mapping.md](mapping.md). To
let the phone camera find the surfaces for you, see [auto-map.md](auto-map.md).

## Next

- [projector-setup.md](projector-setup.md): HDMI, kiosk, a mini PC by the projector, portrait mounts, test patterns
- [mapping.md](mapping.md): faces, corners, mesh warp, solo, the content space, templates, effects, timeline and cues
- [agents-mcp.md](agents-mcp.md): connect Claude Code or Codex
- [troubleshooting.md](troubleshooting.md)
