# Auto map

Auto map uses the iPhone camera to learn exactly which projector pixel lights which spot in the room, then proposes
surfaces to map. You can keep the proposals as they are, fix them in the editor, or ask Claude or Codex to do the
mapping.

## How it works

1. The projector shows white, then black, then a series of **Gray-code** stripe patterns: vertical stripes for x and
   horizontal stripes for y, each followed by its inverse.
2. For every pattern the server asks the phone for a still with locked exposure, focus and white balance.
3. The server decodes the stills into a **dense camera to projector map**: for every camera pixel, the projector pixel
   that lights it. Because it is per pixel, it is exact on 3D objects too, not only on a flat wall.
4. From the map it fits planes and proposes **candidate surfaces** (the wall, the faces of a box…) with a confidence
   score.

A calibration takes about 20 seconds with a real projector and phone. It reports **coverage** (how much of the
projector image the camera saw) and **error** in projector pixels.

## What you need

- the server running, the projector output (`/out`) open on the projector and the phone paired;
- a stand or tripod for the phone next to the projector, pointing at the area you want to map;
- a dim room: the stripes need contrast. A ceiling light or a bright monitor can drown the projector out.

The server refuses to start a calibration without an output (409 "No projector output is connected…") or a phone
with a camera (409).

## Run it from the phone

1. Open the **objects** tab and tap **auto map**.
2. **Mount.** Put the phone on its stand. While this screen is open the projector shows white so you can aim; the
   camera view outlines the projected area.
   - The **pre-flight** card checks, live from the server, that the projector output is connected (with its
     resolution), that the camera preview reaches the server (with its fps) and that the server answers. Each
     failing line says how to fix it. "start auto map" stays disabled, with the reason under it, until the output
     and the preview pass. If the output window is not the projector's size it warns you to make it full screen.
   - **check the light** flashes white, black, white and reports "projector visible: strong / weak / none". Weak
     means calibration may map only part of the scene: darken the room first.
   - **mark the object**: drag a box over the object you focused the projector on. Calibration then measures that
     area, meters the camera on it, and (after a first calibration) lights only that area on the projector.
   - "Phone is steady" means it turned less than 0.5° in the last 1.5 s. It does not block the start: the server
     re-takes the white image at the end and fails with "The phone moved during calibration" if the view shifted
     more than about 6 px.
3. **Calibrate.** Tap start. The phone meters exposure on the projected white, locks it, and the projector flashes
   the patterns while the progress follows each step. If the projector or phone lags, the server notices that a
   photo still shows the previous pattern and waits longer per pattern ("the projector lags, waiting 500 ms").
   A failure stays on screen with the server's reason, the image of what the camera saw of the projector, and
   **try again**, **darker room tips** and **mark the object**.
4. **Pick.** The phone shows the proposed surfaces over the live camera image and the quality ("sharp area mapped
   87 % · 0.8 px"). Type what to map, choose Claude or Codex (an agent whose CLI is not installed on the Mac is marked
   "not installed"), and send. The agent's log streams back to the phone.
5. **Keep or fix.** Keep applies the agent's draft; fix on laptop sends you to the editor.

"just take a photo for the laptop" skips the calibration and sends one photo to the editor as a reference.

## Focus and blur

A projector is sharp at one distance. On a desk full of objects only the object you focused on gets crisp stripes;
the rest blurs the finest stripes to grey. The decoder keeps the bits it can read per pixel: blurred pixels get a
coarser position (up to 4 px) or none at all, never a confident wrong one. The quality reports how much of the
marked area was sharp, and agents see a confidence map (`calibration_get`) and cannot place surface corners on
pixels without a correspondence.

## Run it from the editor

**auto map** (under **set up** in the editor's top bar) shows the phone's status and camera feed beside the output, with the outlines on top.
**run** starts a calibration (or **recalibrate**); the panel shows the progress, the quality and the candidates. Add a
candidate as a surface with one click, then adjust it in the map space ([mapping.md](mapping.md)). The agent
panel on the right takes a prompt for Claude or Codex.

Other entries in the editor:

- **snapshot** and **use as reference**: take the current camera frame as the reference photo.
- **new scene from photo**: upload, paste or drop a photo, take one with the iPhone, or grab a camera frame; say
  whether it was taken next to the lens or anywhere, and optionally ask an agent to map it.

## Without hardware

`projmap sim` plays both the projector output and the phone camera against a running server, with a synthetic desk
and cube:

```bash
projmap serve          # in one terminal (or the launchd service)
projmap sim            # in another
```

Then start a calibration from the editor's auto map (set up → auto map with the iphone). Against the sim it takes about 6 seconds and finds the
wall and three faces of the cube. Use `--no-output` to keep a real `/out` as the output and only fake the camera.

## After calibrating

The calibration is stored on the setup. Agents use it through MCP: they pick corners in camera pixels and
`surface_create_from_camera` converts them to projector pixels; `alignment_error` and `camera_compare` project an
outline, photograph it and report the error per edge so the agent can nudge until it is under about a pixel. See
[agents-mcp.md](agents-mcp.md).

Recalibrate whenever the projector or the phone moves.

## Tips

- Turn off room lights and screens that shine onto the area.
- Very dark or shiny surfaces (black plastic, glass, mirrors) decode poorly; expect lower coverage there.
- If coverage is low, check that the whole projected image is in the camera's view and that the phone did not move.
- "The projector light is only N% brighter than the room": turn off the lights, close the blinds, turn away
  monitors. The failure screen shows what the camera saw of the projector.
- Slow projector or AirPlay: the server learns the delay itself; `PROJMAP_CALIB_SETTLE_MS` sets the starting value.
