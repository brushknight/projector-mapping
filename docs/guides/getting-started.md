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

The editor has three spaces: **show** (run the wall: what is on air, presets, cues, the soundboard), **map** (draw
and adjust the faces on the stage) and **content** (the faces unfolded flat, to put pictures, drawings and effects on
them). It opens on **show**; **Tab** switches between map and content. The timeline folds under the stage,
and **set up** in the top bar holds the projector, the reference photo and **auto map** (finding surfaces with the
phone camera). The rail at the top left walks through reference, faces, content and play. The editor is made for a desktop browser, 1100 px wide or more.

## 4. Put the output on the projector

```bash
projmap open --out --display 2
```

This opens `/out` in its own Chrome window in kiosk mode (fullscreen, no browser chrome) on display 2. Display 1 is
the main display; the numbers follow macOS's display order. Until a controller connects, the output shows a pairing
screen with a 4-character code and a QR code.

The kiosk window plays sound effects too (Chrome starts with `--autoplay-policy=no-user-gesture-required`). If you
open `/out` by hand, click it once when it says **click to enable sound**; see
[sound-and-video.md](sound-and-video.md).

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
| static | a light with attachments in front of it (windows, blinds, leaves, spots…), one focus ring, colour, motion |
| live | a stack of moving layers: tree sway, clouds, rain on glass, caustics, day cycle |
| color | a gradient wash with drift and grain |
| scenery | a blurred photo or a looping video, built in or one of yours (files or YouTube) |
| objects | the mapped objects and their timeline, with GO, back and stop |

Each mode keeps its own settings, so switching from live to static and back brings the live stack back as you left
it. Presets save and recall one mode's look. The on-air pill at the top toggles blackout.

The editor's **show** space has the same tabs, pickers and presets in the browser, with a big live picture of the
wall, on air and blackout, and the soundboard. You need nothing about mapping to run a show from there. Static light
(attachments, focus, the frame slide and motion) has its own guide: [static-light.md](static-light.md).

### The viewer

**open viewer** (in the top bar, in the show preview and in Set up) opens a window that shows exactly what the
projector shows: the same picture and clock, test patterns, solo, videos and live animation. It is read only and never
the output, so you can keep it on a second screen, or on the projector computer instead of `/out` while you try
things. Hover it for a small bar with the scene, the mode, a sound toggle, fullscreen and close.

### Scenes

A scene is one complete look: its mode stacks, mapped objects, timeline and soundboard. Each scene has a **kind**
that says what it is for: **static** (a light through an attachment), **live** (animated backdrops), **colour**,
**scenery** or **mapping** (objects and a timeline). Putting a scene on the wall puts its kind on air, and the show
space opens the matching controls (a mapping scene opens the objects tab).

The show space lists the scenes grouped by kind, with filter chips and small live pictures of each one. Hover a
picture (or click it) for a bigger animated preview that does not touch the wall, with **put on the
wall**. **new scene** starts from a template: a static scene is a 4-pane window at golden 3200 K with the sun pass
ready but off, a live scene is a window with a tree swaying in front of it, a mapping scene opens the map space with
the reference photo step. **duplicate** copies a scene; you can rename any scene and delete any but the active one.
On the phone the scene picker is grouped the same way; hold a scene to preview it.

The editor also edits a scene that is not on the wall: open it from the switcher in the map or content space. To map real objects, continue with [mapping.md](mapping.md). To
let the phone camera find the surfaces for you, see [auto-map.md](auto-map.md).

### Put something on a face

The editor opens on **show**, which runs the wall. To dress an object, click **content** in the top bar (or **add
content** on a selected face). The first visit plays a 4-step tour; the **?** button plays it again. The title says
what you edit ("zimacube · right face"), the breadcrumbs take you back to all faces, and the "where you are" map at
the top right shows the object as it sits on the stage: click a face to open it. An empty face offers **add
picture**, **draw** and **add effect**; the stage picture in the corner shows the result on the object, live.

## Next

- [projector-setup.md](projector-setup.md): HDMI, kiosk, a mini PC by the projector, portrait mounts, test patterns
- [mapping.md](mapping.md): faces, corners, mesh warp, solo, the content space, templates, effects, timeline and cues
- [sound-and-video.md](sound-and-video.md): sound effects, the soundboard, sound on the timeline, video loops and
  YouTube
- [static-light.md](static-light.md): the light, attachments, focus, the frame slide and motion
- [agents-mcp.md](agents-mcp.md): connect Claude Code or Codex, and let them change the wall live
- [troubleshooting.md](troubleshooting.md)
