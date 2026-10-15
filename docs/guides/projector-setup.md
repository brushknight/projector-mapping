# Projector setup

The projector output is a web page, `/out`, that renders the scene locally in WebGL2. The server sends it scene
state (a few KB per change), never video. Anything that runs Chrome and has an HDMI port can drive the projector.

| setup | how | when |
| --- | --- | --- |
| laptop over HDMI | the projector is a second display; `projmap open --out` | the default: lowest latency, one machine |
| mini PC or Raspberry Pi 5 | Chromium in kiosk mode opens `http://<server>:7400/out` | a permanent rig; the laptop moves freely |
| projector's own browser | open `/out` in the built-in (Android TV) browser | no cable, but test the GPU first |
| AirPlay or screen mirroring | not supported | compression and lag blur the line work |

## Laptop over HDMI

1. Connect the projector. In System Settings → Displays, set it to **extend** (not mirror) the desktop, at the
   projector's native resolution (usually 1920×1080) and refresh rate.
2. Open the output on it:

   ```bash
   projmap open --out --display 2
   ```

   This starts a separate Chrome instance (its own profile in the data folder, `chrome-out/`) as an app window with
   no address bar, autoplay allowed and translation off, then moves it onto display 2 and puts the page in full
   screen there by itself (no click, no Chrome bars, through Chrome's DevTools on a loopback port of that profile).
   Display 1 is the main display; if you have more screens, the numbers follow macOS's order. If the display is not
   found it opens on the main one and says so.

   Chrome ignores window positions on a display that sits left of or above the main one, so projmap moves the window
   with the Accessibility API. The first time, macOS asks to let projmap (or your terminal, for `projmap open`)
   control the computer: allow it in System Settings → Privacy & Security → Accessibility. projmap then checks the
   window landed on the display and that `/out` measures exactly that display's pixels (full screen), retries twice,
   and says where the window went or what it measured if it still did not.

   Or, from the editor on this Mac: **put on projector** (in the Show preview's top bar, and in Set up next to
   "open viewer") lists the displays attached to the Mac with their resolutions. Pick one and the server opens the
   same full-screen window there. It works only from the Mac that runs projmap, since it starts Chrome on it.

3. To close the output, focus its window and press ⌘Q (Esc only leaves full screen).

"Open viewer" stays for a windowed preview on your own screen. A Chrome pop-up window keeps its address bar even in
macOS full screen; only the browser's own full screen hides it, so `/view` and `/out` take it like this:

| on `/view` and `/out` | does |
| --- | --- |
| the first click anywhere | goes full screen (on `/out` the same click also enables sound) |
| double-click, or F | switches full screen on or off |
| Esc | leaves full screen |
| 2 s without moving the mouse | hides the cursor (and the viewer's bar) |

Until the page is full screen, a "click for full screen" hint shows for 3 s: in the middle on `/view`, as a small
note in the corner on `/out`. `?headless=1` hides it.

Tips:

- Turn off the screen saver and display sleep for the projector, or the output goes dark. `/out` holds a wake lock
  while it is visible.
- Hide the menu bar on that display (System Settings → Control Center → automatically hide the menu bar) if it shows
  through.
- The output reports its real resolution and fps to the server. The editor and the phone show a warning when it
  drops frames.

## Kiosk mode by hand

On any machine with Chrome or Chromium:

```bash
# macOS
open -na "Google Chrome" --args --kiosk --app=http://127.0.0.1:7400/out \
  --user-data-dir="$HOME/.projmap-out" --no-first-run --autoplay-policy=no-user-gesture-required

# Linux
chromium --kiosk --app=http://studio-mac.local:7400/out --user-data-dir="$HOME/.projmap-out" \
  --no-first-run --autoplay-policy=no-user-gesture-required --disable-features=Translate
```

A separate `--user-data-dir` keeps the output out of your everyday Chrome windows.

## Mini PC or Raspberry Pi 5

Use this for a permanent install: the server runs on a laptop or a home server, and a small computer on the
projector's HDMI shows `/out`.

1. Run the server on a machine on the same network (`projmap serve`, or `projmap install` on a Mac).
2. On the mini PC, start Chromium in kiosk mode at login, pointing at `http://<server>.local:7400/out` (see above).
   On Raspberry Pi OS, add the command to the desktop autostart, and turn off screen blanking in raspi-config.
3. The first time, the output shows a pairing screen. Pair the phone or open the editor, then the output follows the
   active scene.

A client that is not on the server's own machine needs a token. For an output on another machine, open the editor
there with the one-time link from `projmap open` and open `/out` from the same browser profile, or pass
`?token=<device token>` on the `/out` URL.

You can also run the server on the mini PC itself. Linux builds are in every release; `projmap install` only knows
launchd today, so start `projmap serve` with a systemd user unit or your desktop's autostart. Set `PROJMAP_DATA`
(for example `~/.local/share/projmap`), because the default data folder is the macOS path.

## Portrait orientation

For a projector mounted on its side, set the orientation in the setup: in the editor's setup chip or on the phone
under projector settings, pick **portrait cw** or **portrait ccw**. The scene is then authored at 1080×1920 and the
output rotates it 90° onto the projector's 1920×1080 framebuffer, so you draw upright and the wall shows it upright.

Flip horizontal and flip vertical handle rear projection and ceiling mounts. Rotation is applied first, then the
flips.

## Master and blackout

- **Master** scales the brightness of everything.
- **Blackout** (the on-air pill on the phone, or on air / blackout in the editor) fades the output to black over the
  setup's blackout fade: cut, 0.5 s or 2 s. Blackout happens in the output's last pass, so it works even if the
  network drops.

## Test patterns

Test patterns are drawn on top of everything and help you aim and focus:

| pattern | use |
| --- | --- |
| grid | keystone, focus and straight edges |
| white | full-field white to see the throw and hot spots |
| crosshair | centre the image on the wall |
| corners | find the four corners of the image |

Pick one in the editor's setup chip or on the phone under projector settings. A test pattern turns itself off after
60 seconds, so a grid never stays lit by mistake (or in a camera shot); picking it again renews it. Both clients show
the seconds left.

## The reference photo

Take a photo from next to the lens (on the phone: auto map → just take a photo for the laptop, or upload one in the
editor's setup chip). The editor shows it behind the stage so you can trace objects without the projector on. It is
never projected.
