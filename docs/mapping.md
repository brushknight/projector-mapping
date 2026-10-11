# How to map an object

This guide walks through mapping a real object (a box, a lamp, a shelf) in the laptop editor so the projector lights
each face on its own. Open the editor with `projmap open` (or http://localhost:7400/editor on the Mac that runs the
server) and pick the **map** workspace.

## 1. See the object

- Add a reference photo taken from the projector's position: the projector chip in the top bar (`16:9 · 1920×1080`)
  → **reference photo** → upload. The editor shows it behind the stage; the projector never shows it.
- Or turn on the grid: **test grid** on the stage bar, or a test pattern in the projector chip. The projector draws
  the grid on the wall so you can see where each projector pixel lands. A test pattern turns itself off after 60 s so
  it never stays lit on camera; the chip in the top bar shows the seconds left, and clicking it keeps the pattern on
  for another 60 s.

## 2. Create a face

1. Press **Q** (or **+ face** in the surfaces panel). The tip panel on the stage tells you what to click.
2. Click the 4 corners of one face of the object, clockwise from the top left. The 4th click creates the face,
   selects it and shows its corners in the inspector on the right.
3. Repeat for the other faces. Corners snap to nearby points (the **magnet**), so two faces that share an edge share
   its points; moving one moves both. Hold **⌘** while dragging to skip the snap.

Other shapes: **T** triangle, **P** polygon (click the first point again or press **Enter** to close it), **C**
circle (centre, then rim), **W** a quad with a 4×4 mesh for curved faces, **L** a line along an edge (**Enter**
finishes), **K** a mask that keeps an area dark.

To add a detail (a drive bay, a fan, a logo), select its face first and draw inside it. The new surface becomes a
detail of that face and is clipped to it.

## 3. Adjust it

- Drag a corner to move it. **Tab** cycles through the selected surface's points, the arrow keys nudge the selected
  point 1 px (**Shift** + arrow: 10 px). The loupe shows the pixels under the point at ×10.
- Type exact coordinates in the inspector (P1 to P4, in scene pixels).
- Drag inside a face to move the whole face.
- For a face that does not sit flat, switch its warp to **mesh** or **bezier** in the inspector and drag the mesh
  points. **Alt**-click a quad adds a mesh row and column.
- Scroll to pan, **⌘** + scroll (or pinch) to zoom, **fit** to see the whole frame.

## 4. Draw on a face flat

Select a face and press **flat · draw** in the inspector (or **flat** on the stage chip, or double-click the face).
The editor shows the face unwarped at its real proportions, exactly as its content looks before the warp, with any
effects and clips at the current playhead.

- Tools: **pen** (P, freehand), **line** (L), **rect** (R), **ellipse** (E), **text** (T, click, type, press
  Enter), **erase** (X, click a stroke). Pick the colour, the stroke width in pixels of the surface, and fill for
  rectangles and ellipses.
- Every stroke goes onto the wall at once, through the warp. **undo stroke** removes the last one, **clear** removes
  them all.
- **reveal** draws the strokes on partway. **draw on** adds a timeline clip at the playhead that draws them on over
  3 s, and switches the always-on drawing off so the clip shows it.
- **Esc** or **back to stage** returns to the stage.

**unfold** (on the stage chip with an object selected, or in the flat view) lays out every face and detail of the
object side by side, like a UV atlas. Click one to open it flat and draw on it.

## 5. Put the objects on air

The wall shows one mode at a time: **static**, **live**, **color**, **scenery** (the backdrops) or **objects** (the
mapped faces and the timeline). The stage always previews objects while you map; the chip on the stage says what the
wall shows, and **put objects on air** switches the wall to the mapping. The mode picker in the top bar and the
iPhone's tabs switch modes too.

In objects mode the backdrop stays dark, so the mapping reads clearly. To keep some light around the object, turn on
**backdrop under objects** on the stage chip, pick which backdrop (static, live, color or scenery) and set its level.

## 6. Animate

The **animate** workspace has the same stage and a larger timeline: add a track for an object or a face, drag effects
from the library onto it, and add cues. **GO** on the phone or in the timeline plays to the next cue.
