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

33 attachments in five groups. Each tile shows a real render of it. Click a tile to put it in front of the light
(it replaces what is there); use the **+** on a tile (hold it on the phone) to add it on top.

- **Windows**: 4-pane, 6-pane, arched, church window with tracery and leaded glass, porthole, French doors,
  skylight, barn window.
- **Blinds**: venetian blinds (fine, standard, wide slats), vertical blinds, plantation shutters.
- **Nature**: leaves (light, medium, dense), palm, a bare branch, ivy, bamboo.
- **Patterns**: dots, lattice, Moroccan screen, honeycomb, stripes, a steel grid window, star field, water ripple.
- **Spots**: round hard, round soft, oval, framing shutters, iris.

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

The Static tab has the same light, attachment browser (thumbnails come from the server), attachment controls, frame
slide and a motion card with the preset chips, a speed slider and play / pause. Drag sideways on the picture to slide
the light; vertical swipes scroll the page.

## For agents

Claude and Codex can do all of this over MCP: `light_set`, `attachment_add`, `attachment_update`,
`attachment_remove`, `gobo_set` and `motion_set`. With **agents edit live** on (Set up, agents) their changes show on
the wall at once. See [agents-mcp.md](agents-mcp.md).
