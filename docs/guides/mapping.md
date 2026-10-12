# Mapping objects

Mapping puts light and animation onto real objects: you draw a surface over each face of an object in the editor,
then give the faces pictures, drawings, effects and timed clips. The editor has two spaces on one screen, **map**
(the warp) and **content** (the faces unfolded flat), with the timeline folded under the stage; **Tab** switches
spaces. The step by step version is [../mapping.md](../mapping.md).
For finding surfaces with the phone camera, see [auto-map.md](auto-map.md).

The wire format behind all of this (surfaces, points, meshes, the `drawing` effect, the timeline) is in
[../protocol.md](../protocol.md); the effect API is in [../effects.md](../effects.md).

## Before you start

- Aim and focus the projector with the **grid** test pattern ([projector-setup.md](projector-setup.md)). The
  projector, the reference photo, auto map and the devices live under **set up** in the top bar.
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
| E | line | an open polyline (Enter finishes), drawn as a 16 px stroke; good for edges |
| M | mask | a shape that cuts content out of everything below it |

The tools sit on the stage bar in the map space. L, J, K, S and F belong to the transport, solo and edit face.

Click to place each corner. Enter finishes a shape with a free number of points; Esc cancels. Draw inside a selected
face and the new shape becomes a **detail** of that face.

## Adjusting corners

- Drag a point to move it. The point readout and the **loupe** (×10 with a 1 px grid) appear while you drag, so you
  can land on the exact projector pixel.
- Arrow keys nudge the selected point or surface by 1 px; with Shift, 10 px.
- **[** and **]** step through the points of the selected surface (Tab switches map and content).
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

## Solo

**S** solos the selection on the stage (everything else dims to 15 %); **Shift+S** also solos it on the wall for
60 s, as a numbered grid through each face's warp, plain white, or its content (the **solo** menu on the stage bar
picks). **Esc** ends both. Use the grid to check that a face's warp sits right on the real object.

## The content space

**Tab** opens the selected object unfolded like a dieline: faces edge to edge at their real proportions, details
inside their faces, rendered live at the editor's playhead, with a picture of the warped stage in a corner.
Double-click a face (or **F**, or **edit face**) to work on it alone; **[** and **]** step through faces and **Esc**
goes back to the unfold.

- **Pictures and videos**: drop or paste them on a face, or across the whole object (hold alt in the unfold, or
  **picture across**). Each is a media layer with fit, crop, offset, scale, rotation, opacity, blend and a reveal wipe;
  drag its box to move it, a corner to scale and the knob to turn it.
- **Drawing**: pen, line, rect, ellipse, text and erase (keys 1 to 6) in a face's view. Strokes are saved as the
  face's `drawing` effect; its **reveal** draws them on in order, and **draw on** adds a clip that animates it.
- **Across the object**: layers on the unfold (a picture, or a **sweep** gradient) run on across shared edges, because
  each face shows its own part of the unfold.
- **Templates**: **template** saves the unfold as a PNG or SVG at its true pixel size, or each face as a PNG in a zip.
  **import artwork** puts a picture painted on the template back across the object.

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

The timeline lives under the stage in both spaces. Folded it is the transport bar; **timeline** opens the tracks.

- **Tracks** target everything (`all`), one object, one surface, or one content layer. Add a track for what you want
  to animate. A layer track takes **reveal** and **sweep** clips (its ⋯ menu adds them at the playhead).
- **Clips** are effects with a start and an end. Drop an effect from the library onto a track to add a clip, drag it
  to move it and drag its ends to resize it. Clips snap to cues and to other clips' edges; hold Shift to move freely.
  The inspector sets the clip's effect, timing, fade in, fade out and parameters.
- **Transport**: the editor plays its own preview. Space plays and pauses, L loops, J and K step a frame (Shift: a
  second), Home goes to the start, and the bar scrubs. The wall keeps going unless **wall follows** is on (top bar);
  in backstage the wall then previews your draft. **go** and **on air** in the top bar's wall group run the show.
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

**play this scene on the wall** in the open timeline makes the scene active. On the phone's **objects** tab you get the scene chips, a
progress bar with the cue labels, **back**, **GO** and **stop**, and a list of objects showing which are lit. GO gives
a firm haptic bump. The timeline runs on the server's clock, so the projector and the phone stay in step to within a
few milliseconds.

Tap ▸ next to an object to jump to the first moment it lights up.

## Presets

Presets save and recall a backdrop mode's look (static, live, color or scenery), not the mapping. Save one in the
editor's backdrops library or on the phone.
