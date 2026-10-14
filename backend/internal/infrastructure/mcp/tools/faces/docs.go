// Package faces holds the MCP tools that dress mapped objects: read an object's unfold and a face's UV frame, look
// at faces flat (renders and templates), and draw on them (drawing layers, content layers, uploaded pictures) in the
// session's draft.
package faces

// UV is the face UV convention, repeated in tool descriptions so a model cannot miss it.
const UV = "Face UV: (0,0) is the face's FIRST point (corner 1, the top left of its content); u grows toward corner 2 and v grows " +
	"toward the 3rd/4th points, so (1,0) = corner 2, (1,1) = corner 3, (0,1) = corner 4. u is left to right and v top to bottom " +
	"in face_render and face_template_get images, however the face is turned on the wall or in the atlas. u and v are fractions " +
	"(0..1) of the face's flat width and height (sizePx); a shape that should look square needs du·width = dv·height."

// Strokes is how strokes are written, for tool descriptions.
const Strokes = "A stroke is {tool, points, color, width, fill, text, size}. tool: pen (2+ points, a polyline), line (exactly 2), " +
	"rect (2: opposite corners), ellipse (2: opposite corners of its box), circle (2: centre, then a point on the rim; stays " +
	"round on any aspect), polygon (3+ points, closed), text (1: its top left; set text and size). points are [u, v] pairs in " +
	"the face's UV (0..1 inside the face; -1..2 is accepted for shapes that run off the edge, the face clips them). color is " +
	"#rrggbb (default #ffffff). width is the line width and size the text height, both in the face's scene pixels (the " +
	"units of sizePx), not UV: width 4 on a face 300 px wide is 4/300 of its width. fill: true fills rect, ellipse, circle " +
	"and polygon with color (set width 0 for no outline). Strokes draw in order, later on top."

// DrawingDoc is docs://drawing.
const DrawingDoc = `# Drawing on faces (projmap)

The projector warps each face's flat content onto the real object. You draw on the flat, unwarped face, in the face's
own UV space, and the renderer does the perspective. So you never think about the wall, only about the face.

## The face's UV frame

` + UV + `

- face_get(surface_id) gives a face's sizePx (its real flat width and height in scene pixels, so its aspect), its
  corners (point ids, scene px, uv), its edges (top = corner 1 to 2 at v = 0, right = corner 2 to 3 at u = 1,
  bottom = corner 3 to 4 at v = 1, left = corner 4 to 1 at u = 0) with the face across each edge, and its details
  (drive bays, fans, logos mapped as their own surfaces) with their box in the face's UV.
- object_unfold_get(object_id) gives every face of an object and its atlas: the faces laid out flat, edge to edge,
  like a dieline. The atlas is in atlas pixels; each face has a rect {x, y, w, h, rotation}. rotation turns the face's
  UV inside the rect (0: u right, v down; 90: u down, v left; 180: u left, v up; 270: u up, v right).
- face_template_get shows the face (or the whole unfold) with its outline, a 0, .25, .5, .75, 1 grid, corner numbers,
  details and neighbours. Look at it before you draw.

## Strokes

` + Strokes + `

face_draw(surface_id, strokes, mode, layer_name) writes them into a named drawing layer on the face, in your draft.
mode append (default) adds to the layer, replace swaps the layer's strokes. Use one layer per idea ("panel",
"bays", "logo", "leds") so you can redo one without touching the others. face_drawing_clear removes a layer (or all
of them). object_draw takes the same strokes in atlas pixels across the whole unfold and splits them onto the faces.

## Look and iterate

face_render(surface_id) shows the face flat at its true aspect, as the renderer draws it, from your draft.
with_outline adds the face outline, details and the .25 grid. object_unfold_render shows the whole unfold, and
output_render the warped frame the projector shows. Compare with reference_photo_get (the real object from the
lens) and fix what is off. When it looks right, proposal_submit.

## Worked example: four drive bays on the right face

Say face_get("srf_right") returns sizePx [309, 300] (aspect 1.03) and the real device has four vertical drive bays
side by side in its lower 70 %, with a 6 % margin. Four bays, each 0.19 wide with 0.04 gaps:
u from 0.06 to 0.94 (0.88 wide = 4 × 0.19 + 3 × 0.04), v from 0.22 to 0.94.

` + "```json" + `
{ "surface_id": "srf_right", "layer_name": "bays", "mode": "replace", "strokes": [
  { "tool": "rect", "points": [[0.06, 0.22], [0.25, 0.94]], "color": "#d8d8d8", "width": 3 },
  { "tool": "rect", "points": [[0.29, 0.22], [0.48, 0.94]], "color": "#d8d8d8", "width": 3 },
  { "tool": "rect", "points": [[0.52, 0.22], [0.71, 0.94]], "color": "#d8d8d8", "width": 3 },
  { "tool": "rect", "points": [[0.75, 0.22], [0.94, 0.94]], "color": "#d8d8d8", "width": 3 },
  { "tool": "line", "points": [[0.10, 0.30], [0.21, 0.30]], "color": "#8c8a85", "width": 2 },
  { "tool": "line", "points": [[0.33, 0.30], [0.44, 0.30]], "color": "#8c8a85", "width": 2 },
  { "tool": "line", "points": [[0.56, 0.30], [0.67, 0.30]], "color": "#8c8a85", "width": 2 },
  { "tool": "line", "points": [[0.79, 0.30], [0.90, 0.30]], "color": "#8c8a85", "width": 2 },
  { "tool": "circle", "points": [[0.155, 0.88], [0.165, 0.88]], "color": "#34c759", "width": 0, "fill": true },
  { "tool": "circle", "points": [[0.385, 0.88], [0.395, 0.88]], "color": "#34c759", "width": 0, "fill": true },
  { "tool": "circle", "points": [[0.615, 0.88], [0.625, 0.88]], "color": "#34c759", "width": 0, "fill": true },
  { "tool": "circle", "points": [[0.845, 0.88], [0.855, 0.88]], "color": "#34c759", "width": 0, "fill": true }
] }
` + "```" + `

Each LED is a circle of radius 0.01 × 309 ≈ 3 px. Then face_render(surface_id: "srf_right", with_outline: true) to
check the bays line up with the mapped bay details (dashed outlines), adjust, and render again.

## Pictures

asset_upload takes a PNG, JPEG or SVG (base64, or a file path under your home folder on this Mac) and returns
asset:<sha>. layer_add(target_kind: "surface", target_id, kind: "media", src: "asset:<sha>") puts it on a face
(fit fill, fit or stretch; x, y, scale, rotation to place it). A gradient layer (kind "gradient", stops, angle) makes a
panel tint or a sheen. Layers draw under the drawing layers.
`

// Prompt is the dress-object prompt.
const Prompt = `Make the mapped object "%s" look like the real %s by drawing its details on its faces in projmap.

1. object_unfold_get(object_id: "%s"): the faces, their real aspect (sizePx), which edge touches which, and the mapped details. Read docs://drawing once.
2. reference_photo_get (if there is one) to see the real object from the lens. Recall what the %s looks like: panels, seams, drive bays, vents and fan grilles, logo, LEDs, ports, screws.
3. face_template_get(object_id) for the whole unfold, then face_template_get(surface_id) for each face you dress, so you know where u and v run.
4. Per face, draw with face_draw in separate named layers ("panel", "bays", "vents", "logo", "leds"): outlines and seams first, then the features, then small lights. Keep features inside the face (u, v in 0..1) and line them up with the mapped details. Use the real proportions: sizePx gives each face's aspect.
5. face_render(surface_id, with_outline: true) after each face. Compare with the reference and your idea of the device; fix with mode "replace" on the layer that is off. Repeat until it reads as the device.
6. object_unfold_render to check the faces together (seams line up across shared edges), and output_render to see it warped as the projector shows it.
7. proposal_submit with a one-line summary. (If the user allowed it, draft_apply puts it on the wall.)

House style: black ground, crisp light lines, one accent colour. Light only where the real object has a feature; the projector cannot draw black on a lit object.`
