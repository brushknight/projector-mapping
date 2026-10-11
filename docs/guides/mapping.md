# Mapping objects

Mapping puts light and animation onto real objects: you draw a surface over each face of an object in the editor,
then give the surfaces effects and timed clips. This guide covers the editor's **map** and **animate** workspaces.
For finding surfaces with the phone camera, see [auto-map.md](auto-map.md).

The wire format behind all of this (surfaces, points, meshes, the `drawing` effect, the timeline) is in
[../protocol.md](../protocol.md); the effect API is in [../effects.md](../effects.md).

## Before you start

- Aim and focus the projector with the **grid** test pattern ([projector-setup.md](projector-setup.md)).
- Put the scene in **objects** mode (the mode switch in the editor, or the objects tab on the phone). Mapped objects
  are drawn only in this mode. To keep a dim backdrop behind them, turn on the **underlay** and pick which backdrop
  mode it comes from and how bright it is.
- Optional: a **reference photo** from next to the lens. The stage shows it behind your surfaces, so you can trace
  objects with the projector off.

## Backstage and live

The top bar switches between **backstage** and **live**.

- **Live** edits change the scene on air right away. Dragging a point moves it on the wall as you drag.
- **Backstage** edits go into your draft. The wall keeps showing the live scene until you **apply** the draft (or
  **discard** it). Agents always work backstage.

⌘Z and ⇧⌘Z undo and redo through the server's history, so undo works across the editor and the phone.

## Objects and surfaces

A scene has **objects** (a NAS, a shelf, a lamp) and each object has **surfaces** (its faces). The tree on the left
lists them; the eye toggles one off while you work. A surface has a role:

- **face**: a flat side of an object;
- **edge**: a line along an edge, for trace effects;
- **detail**: a shape inside a face (a drive bay, a fan). It is clipped to its parent face.

## Drawing tools

| key | tool | draws |
| --- | --- | --- |
| V | select | select and move points and surfaces |
| Q | quad | 4 corners, clockwise from the top left; the usual tool for a flat face |
| T | tri | 3 corners |
| P | poly | any number of corners; Enter finishes |
| C | circle | centre, then a point on the rim |
| W | mesh | a quad with a 4×4 warp mesh, for curved or bent faces |
| L | line | an open polyline (Enter finishes), drawn as a 16 px stroke; good for edges |
| K | mask | a shape that cuts content out of everything below it |

Click to place each corner. Enter finishes a shape with a free number of points; Esc cancels. Draw inside a selected
face and the new shape becomes a **detail** of that face.

## Adjusting corners

- Drag a point to move it. The point readout and the **loupe** (×10 with a 1 px grid) appear while you drag, so you
  can land on the exact projector pixel.
- Arrow keys nudge the selected point or surface by 1 px; with Shift, 10 px.
- Tab cycles through the points of the selected surface.
- Drag inside a surface to move all of it.
- The inspector on the right lists the corners as numbers you can type, and **lock corners** stops accidental drags.
- Zoom with ⌘ or Ctrl plus the scroll wheel (or pinch), pan by dragging the background, and **fit** to see the whole
  output. The view switches between input, output and split.

Work with the projector on and look at the wall, not the screen: move a corner until the light sits exactly on the
object's corner.

## Shared points

Faces of one object meet at shared corners. Drag a point onto another surface's point and the **magnet** welds them:
both surfaces now use the same point, so moving it moves both faces and no gap or overlap opens between them. Shared
points are marked in the inspector's corner list. Hold ⌘ while dragging to turn snapping off for a moment.

## Mesh warp

A quad maps its content with an exact perspective transform, which is right for flat faces. For a curved surface, a
bent sheet or a lens that is not quite flat, use a mesh:

1. Select the surface and set **warp** in the inspector to **mesh** (or **bezier** for smooth curves through the mesh
   points). The W tool draws a quad that already has a 4×4 mesh.
2. Set the mesh size (columns × rows). Alt-click on the surface adds a row and a column through that spot.
3. Drag the inner mesh points until the content follows the surface.
4. **flatten the mesh** resets the inner points; **corner pin** goes back to a plain quad.

## The flat view

The flat view shows one surface straight on, as a flat rectangle in its own content space, instead of warped onto
the wall. Use it to draw directly on a face: what you draw there lands on the real surface with the warp applied.

Drawing tools in the flat view: pen, line, rectangle, ellipse and text, each with a colour and a width (rectangles and
ellipses can be filled). Your strokes are saved as a `drawing` effect on that surface. Its **reveal** amount draws the
strokes on in order, and a timeline clip with the drawing effect animates the reveal, so a drawing can write itself
onto the object.

## Effects on a surface

Effects draw inside a surface; the renderer warps the result onto the object, so an effect never deals with
perspective. The built-ins include grid build, trace, scan, glitch, fill, particles, label and pulse.

- In the **effects** library on the left, click an effect to add it to the selected surface, or drag it onto a
  surface on the stage.
- The inspector shows the surface's effect stack. Each effect gets controls generated from its parameters, and can be
  turned off without removing it.
- The inspector also sets the surface's opacity and soft edge.

These are always-on effects: they run whenever the scene is in objects mode. For timed content, use the timeline.
Agents and power users can write new effects in GLSL or JavaScript; see [../effects.md](../effects.md).

## Timeline

The **animate** workspace adds a timeline at the bottom.

- **Tracks** target everything (`all`), one object or one surface. Add a track for what you want to animate.
- **Clips** are effects with a start and an end. Drop an effect from the library onto a track to add a clip, drag it
  to move it and drag its ends to resize it. Clips snap to cues and to other clips' edges; hold Shift to move freely.
  The inspector sets the clip's effect, timing, fade in, fade out and parameters.
- **Transport**: to start, play and pause (Space), stop, loop and GO. Click or drag on the ruler to scrub.
- Delete removes the selected clip.

## Cues and GO

Cues turn a timeline into a show you step through.

1. Move the playhead to where a moment starts and press **add cue**. Give it a label.
2. When playback reaches a cue it **holds** there, unless the cue is set to **follow on**, which plays straight
   through it.
3. **GO** starts the next cue. **Back** restarts the current cue, or goes to the previous one if you press it within
   a second of the cue starting.

Cues sit on the ruler; drag one to move it, or click it to jump there.

## GO from the phone

**send to phone** in the timeline makes the scene active. On the phone's **objects** tab you get the scene chips, a
progress bar with the cue labels, **back**, **GO** and **stop**, and a list of objects showing which are lit. GO gives
a firm haptic bump. The timeline runs on the server's clock, so the projector and the phone stay in step to within a
few milliseconds.

Tap ▸ next to an object to jump to the first moment it lights up.

## Presets

Presets save and recall a backdrop mode's look (static, live, color or scenery), not the mapping. Save one in the
editor's backdrops library or on the phone.
