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

- the server running, the projector output (`/out`) open and the phone paired;
- a stand or tripod for the phone next to the projector, pointing at the area you want to map;
- a dim room: the stripes need contrast.

The server refuses to start a calibration when no output or no phone with a camera is connected.

## Run it from the phone

1. Open the **objects** tab and tap **auto map**.
2. **Mount.** Put the phone on its stand. The checklist waits until the phone is steady (3 seconds without moving)
   and level, the projected area is in view and the room is dim.
3. **Calibrate.** Tap start. The projector flashes the patterns and the progress bar follows each step. Do not move
   the phone or the projector, and keep people out of the beam.
4. **Pick.** The phone shows the proposed surfaces over the camera image. Type what to map ("the three faces of the
   cube, the four drive bays and the fan"), choose Claude or Codex, and send. The agent's log streams back to the phone.
5. **Keep or fix.** Keep applies the agent's draft; fix on laptop sends you to the editor.

"just take a photo for the laptop" skips the calibration and sends one photo to the editor as a reference.

## Run it from the editor

The **auto map** workspace shows the phone's status and camera feed beside the output, with the outlines on top.
**run** starts a calibration (or **recalibrate**); the panel shows the progress, the quality and the candidates. Add a
candidate as a surface with one click, then adjust it in the map workspace ([mapping.md](mapping.md)). The agent
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

Then start a calibration from the editor's auto map workspace. Against the sim it takes about 6 seconds and finds the
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
