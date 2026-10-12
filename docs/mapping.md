# How to map an object

This guide walks through mapping a real object (a box, a lamp, a shelf) in the laptop editor so the projector lights
each face on its own. Open the editor with `projmap open` (or http://localhost:7400/editor on the Mac that runs the
server).

The editor has two spaces on one screen, and **Tab** switches between them:

- **Map**: the stage. You place the faces on the object here, warped as the projector sees them.
- **Content**: the selected object unfolded flat, its faces edge to edge at their real proportions. You put pictures,
  drawings and effects on the faces here, and they land on the object through the warp.

The rail at the top left shows the four steps: **1 reference**, **2 faces**, **3 content** and **4 play**. A step
lights up when it is done, and clicking a step takes you there. The line under the rail says what to do next.

## 1. See the object

- Open **set up** in the top bar. Add a reference photo taken from the projector's position. The editor shows it
  behind the stage; the projector never shows it.
- Or turn on the grid: **grid** on the stage bar, or a test pattern in set up. The projector draws the grid on the
  wall so you can see where each projector pixel lands. A test pattern turns itself off after 60 s so it never stays
  lit on camera. The **wall** group in the top bar shows the seconds left; click the chip to keep it on for another
  60 s.
- **auto map with the iphone** (in set up) finds faces with the phone camera instead; see
  [guides/auto-map.md](guides/auto-map.md).

## 2. Create a face

1. Press **Q** (or **+ face** in the surfaces panel). The line under the rail tells you what to click.
2. Click the 4 corners of one face of the object, clockwise from the top left. The 4th click creates the face,
   selects it and shows its corners in the inspector on the right.
3. Repeat for the other faces. Corners snap to nearby points (the **magnet**), so two faces that share an edge share
   its points; moving one moves both. Hold **⌘** while dragging to skip the snap.

The tools sit on the stage bar: **V** select, **Q** quad, **T** triangle, **P** polygon (click the first point again
or press **Enter** to close it), **C** circle (centre, then rim), **W** a quad with a 4×4 mesh for curved faces, **E**
a line along an edge (**Enter** finishes), **M** a mask that keeps an area dark.

To add a detail (a drive bay, a fan, a logo), select its face first and draw inside it. The new surface becomes a
detail of that face and is clipped to it.

## 3. Adjust it

- Drag a corner to move it. **[** and **]** step through the selected surface's points, the arrow keys nudge the
  selected point 1 px (**Shift** + arrow: 10 px). The loupe shows the pixels under the point at ×10.
- Type exact coordinates in the inspector (P1 to P4, in scene pixels).
- Drag inside a face to move the whole face.
- For a face that does not sit flat, switch its warp to **mesh** or **bezier** in the inspector and drag the mesh
  points. **Alt**-click a quad adds a mesh row and column.
- Scroll to pan, **⌘** + scroll (or pinch) to zoom. The zoom button on the stage bar fits the whole frame.

### Solo

- **S** solos the selected face (or every face of the selected object) on the stage: the rest dims to 15 %. **S**
  again or **Esc** ends it. The transport bar shows a **solo** chip while it is on.
- **Shift+S** also solos it on the wall for 60 s, so you can check the alignment on the real object. Pick what the
  wall draws in the **solo** menu on the stage bar: a **numbered grid** drawn through each face's warp (the default),
  plain **white**, or **its content**. The wall group shows the seconds left; click it to keep the solo for another
  60 s, and **Esc** ends it.

## 4. Put content on a face

Press **Tab** (or step **3 content** on the rail) to open the **content** space. It shows the selected object
unfolded like a dieline: for a box, the top sits above the left face and the right face sits beside the left one,
sharing their edges. Details (bays, a fan) sit inside their face. Everything renders live at the editor's playhead,
and a small picture of the warped stage sits in the corner (drag its title to move it, **–** hides it).

- Click a face to select it. Double-click it, press **F**, or press **edit face** on its row in the surfaces panel or
  in the inspector to open it alone. **[** and **]** go to the previous and next face, **Esc** goes back to the
  unfold.
- **Pictures and videos.** Drop an image or a video on a face (in content, or on the stage in map), paste one with
  **⌘V**, or press **picture**. It uploads and becomes a media layer of that face. In the unfold, hold **alt** while
  dropping (or drop between faces), or press **picture across**, to lay it across the whole object instead: it then
  runs on across the shared edges. Library tiles under **media** drag onto faces too.
- **Move, scale, turn.** With **move** (**V**) and a layer selected, drag the dashed box to move it, a corner to scale
  it and the knob above it to turn it (**Shift** snaps to 15°). The inspector sets fit (**fill**, **fit**,
  **stretch**), crop, offset, scale, rotation, opacity, blend and a **reveal** wipe.
- **Draw.** In a face's view, pick **pen** (1), **line** (2), **rect** (3), **ellipse** (4), **text** (5) or **erase**
  (6). Pick the colour, the stroke width in pixels of the face, and fill for rectangles and ellipses. Every stroke goes
  onto the wall at once, through the warp. **draw on** adds a clip at the playhead that draws the strokes on over 3 s.
- **Effects.** Click an effect in the library to add it to the selected face, or drag it onto a face on the stage.
- **Sweep.** **sweep** in the unfold adds a band of light across every face of the object. **sweep** in its inspector
  adds a clip that moves the band across; **wipe on** adds one that reveals it.

What a face shows, bottom to top: the layers across the object, the face's own pictures, its always-on effects, then
the timeline clips.

### Templates

**template** in the unfold saves the object's layout at its true pixel size, with the face outlines and names:

- **save the template as PNG** or **as SVG** (for example 618×609 for the sample cube);
- **save each face as a PNG (zip)**: the atlas and one picture per face, each the right way up.

Paint on it in any app, then **import artwork made on the template**: it comes back as a picture across the object,
stretched to the unfold, so each part lands on its face. Saving a template pins the layout, so the artwork stays put
when you nudge corners later; **re-layout from the mapping** recomputes it, and **arrange faces** lets you drag faces
(and **turn 90°**) by hand.

## 5. Preview and play

The editor has its own playhead. **Space** plays and pauses it, **L** loops, **J** and **K** step a frame back and
forward (**Shift**: a second), **Home** goes to the start, and the transport bar under the stage scrubs. The stage,
the content view and the little stage picture all play at the editor's time; **the wall keeps doing what it was
doing.** The top bar shows both clocks: the editor's next to its play button, the wall's in the **wall** group.

- **wall apart / wall follows** (next to the editor's time): with **wall follows** on, play, pause and scrub move the
  wall too. In backstage the wall previews your draft instead of the live scene.
- **timeline** on the transport bar opens the tracks: add a track for an object, a face or a layer, drop effects onto
  it, add cues. A layer track takes **reveal** and **sweep** clips (its ⋯ menu adds them).
- The **wall** group on the right is the show itself: what mode is on air, the wall's playhead, **go** (jump to the
  next cue and play) and **on air** (blackout).

## 6. Put the objects on air

The wall shows one mode at a time: **static**, **live**, **color**, **scenery** (the backdrops) or **objects** (the
mapped faces and the timeline). The stage always previews objects while you map; the chip on the stage says what the
wall shows, and **put objects on air** switches the wall to the mapping. The mode picker in the wall group and the
iPhone's tabs switch modes too.

In objects mode the backdrop stays dark, so the mapping reads clearly. To keep some light around the object, turn on
**backdrop under objects** on the stage chip, pick which backdrop (static, live, color or scenery) and set its level.
