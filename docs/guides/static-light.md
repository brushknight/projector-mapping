# Static light: the projector as a spotlight

In **static** mode the projector behaves like a spotlight with a projection attachment, the kind photographers put on
an Aputure, Nanlite or Godox light. You choose the light, put attachments (gobos) in front of it, set one focus ring,
and the wall shows soft, believable light: a window patch at golden hour, blinds, leaves, a framed spot.

Everything here works the same in the editor's **show** space (the static tab) and on the phone's **Static** tab.

## How it works

- **The light** lights the whole frame (16:9, or 9:16 when the projector is portrait). With nothing in front of it,
  the whole wall is lit in its colour.
- **Attachments block light**, like metal or glass gobos in the gate. Each one you add blocks more: a window and a
  leaf breakup on top give leaf shadows inside the window patch.
- **One focus ring** softens the whole picture, as on a real spotlight. Sharp for a framed spot, soft for sunlight.
- **The frame slide** pans the whole picture inside the frame; what slides out is gone and the rest of the wall goes
  dark.
- **Motion** moves the light or one attachment across the wall on its own, like the sun moving, even when the
  timeline is stopped.

## The light

| control | what it does |
| --- | --- |
| intensity | how bright the light is |
| focus | the focus ring: low is soft, high is sharp |
| colour: white | colour temperature in kelvin (tungsten 2700, golden 3200, daylight 5600, overcast 6500) and tint |
| colour: colour | any hue and saturation |
| colour: gradient | a gradient gel in front of the light |
| colour: animated | an animated colour: hue cycle, colour flow, colour pulse, aurora, daylight cycle |
| light fx | candle, fire, lightning, paparazzi, tv, breathe, strobe, police |
| colour fringe | the coloured edge cheap lenses give, strongest at the frame edges |
| vignette | the beam falling off towards the corners |
| dust and haze | lens blotches, grain in the air and light scattered around bright areas |
| slide | pans the whole picture left and right (up and down in portrait); reset centres it |

A new static scene starts at 3200 K: warm, like late afternoon sun. Without a template the light is 5600 K daylight.

## Attachments

76 attachments in six groups. Each tile shows a real render of it. Click a tile to put it in front of the light
(it replaces what is there); use the **+** on a tile (hold it on the phone) to add it on top.

- **Windows**: 4-pane, 6-pane, arched, church window with tracery and leaded glass, porthole, French doors,
  skylight, barn window.
- **Blinds**: venetian blinds (fine, standard, wide slats), vertical blinds, plantation shutters.
- **Nature**: leaves (light, medium, dense), palm, a bare branch, ivy, bamboo.
- **Patterns**: dots, lattice, Moroccan screen, honeycomb, stripes, a steel grid window, star field, water ripple.
- **Spots**: round hard, round soft, oval, framing shutters, iris.
- **Plates**: 43 round metal gobo plates (below).

Every attachment has:

- **rotation, scale, left / right, up / down**: where it sits in the beam;
- **blocks**: how much light it stops (all of it for metal, less for a glass gobo);
- **throw**: stretches it away from the light, like a low sun on a wall;
- **keystone**: tilts its horizontals, as when the light comes in from the side;
- **frame depth**: the soft second edge a deep window frame casts.

Then its own shape: panes and mullion thickness for windows, slats and how far they are open for blinds, density
and leaf size for leaves, cells for patterns, roundness and edge for spots.

### Framing shutters

The framing shutters attachment works like the four blades of an ellipsoidal spot. Drag a blade into the beam to cut
it; drag its round knob to angle it. The beam keeps its round edges where no blade reaches.

### Plates

A plate is a round laser-cut steel gobo, like the M-size plates that come with a spotlight attachment. Light passes
through its cut-outs inside a round light field; the metal blocks the rest. Every island of metal hangs on a thin
tie bridge, as on a real plate, so the shadows look like the real thing.

- **20 plates follow a common M-size set**: sunburst, louvre, rain lines, fan rays, skewed window, 6-pane grid
  window, arched window, crossed lines, scattered sticks, pixel cloud, water ripples, snowflakes, lightning,
  starfield, flames, firework burst, bare branches, fern leaves, foliage breakup and rings.
- **23 are new backdrops**: curved venetian, bamboo stalks, palm silhouette, monstera leaves, jungle breakup,
  stained-glass grid, Moroccan arch lattice, honeycomb, concentric circles, spiral, cityscape skyline, starburst
  fine and bold, Art Deco fan, diagonal blinds, porthole grid, god rays, wave lines, abstract triangles, dappled
  light fine and bold, mesh fence and a window with curtains.
- **Tiles show the plate itself**, a grey disc with its cut-outs. Switch **plates show** to **its light** to see
  what each one projects.
- **Light field**: **round** (the default) is the round beam of a spotlight. **Fill frame** scales the pattern to
  cover the whole 16:9 frame, **stretch** stretches it to the frame, **tile** repeats it across the frame at its
  size. Scale, rotation, throw, keystone and the focus ring work as on every other attachment.

#### Add a plate

Plates live in `frontend/src/render/plates/`: `replicas.ts` (the 20 that follow a real set), `originals.ts` (the
rest), `geom.ts` (the drawing helpers) and `index.ts` (the list and the rasterizer).

1. Write a function that returns the plate's shapes in plate space: the plate is the unit circle, x right, y down,
   (0, 0) its centre. `cut(path)` opens metal, `metal(path)` closes it again, painted in order; `cutLine` and
   `metalLine` stroke a path. Helpers make the SVG path data: `poly`, `circle`, `rect`, `sector`, `ribbon` (a
   tapered stroke), `leaf`, `blob`, `jag`, `cells` (a Voronoi breakup) and `Room` (keeps scattered items apart).
   Randomness comes only from the `r` it gets, so the plate is the same every time.
2. Keep it cuttable: no metal may float. Give every island a tie bridge (a `metalLine` across the opening), keep
   openings and metal at least about 0.012 wide, and keep scattered items clear of each other.
3. Add it to `REPLICAS` or `ORIGINALS` with an id `plate-<name>`, a name, a description, `field` (the radius of
   its round light field, default 0.84), a `seed`, and `source` when it follows a real plate.
4. Add the same item to `contract/catalog.json` (category `plates`, `thumb`, `metalThumb`, the `field` param, see
   the other plates), then run `npm test` (the plate test checks the two lists match) and
   `npm run thumbs -- plate-<name>` to render its two thumbnails.

`plateSvg(def, 'metal' | 'mask')` turns a plate into a standalone SVG when you want to look at it outside the app.

## Motion

Pick a move from the chips, then shape it:

| preset | what it does |
| --- | --- |
| sun passes left to right | the light slides across the wall in a gentle arc |
| sun passes right to left | the same the other way |
| slow drift | a barely visible drift, like clouds passing the sun |
| sway | a small back and forth, like a lamp on a chain |
| rise | the patch climbs, its shadows shorten and it cools from 2300 K to 4300 K |
| set | the patch sinks, stretches and warms |

- **What moves**: the selected attachment, or the whole light (the slide).
- **The path editor** is a small picture of the frame: drag **from** and **to**, drag the middle point to curve the
  path, double click to add or remove it. The bright dot shows where the light is now.
- **speed**: from once every 5 seconds to once every 2 hours. Changing it keeps the light where it is.
- **easing** and **repeat** (once, loop, back and forth), **turn over the move**, **size at start and end** (the sun
  rising shortens shadows), and **warm to cool over the move**.
- **play / pause** holds the light where it is; **no motion** puts it back where it started.

Motion runs on the server's clock, so the wall, the editor, the viewer and the phone show the same place at the same
moment. Photos and video loops in scenery have the same motion card.

## On the phone

The Static tab has the same light, attachment browser (thumbnails come from the server, plates as the metal plate or
its light), attachment controls (a plate's light field is a segmented control), frame slide and a motion card with the preset chips, a speed slider and play / pause. Drag sideways on the picture to slide
the light; vertical swipes scroll the page.

## For agents

Claude and Codex can do all of this over MCP: `light_set`, `attachment_add`, `attachment_update`,
`attachment_remove`, `gobo_set` and `motion_set`. With **agents edit live** on (Set up, agents) their changes show on
the wall at once. See [agents-mcp.md](agents-mcp.md).
