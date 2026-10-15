# Static light: the projector as a spotlight

In **static** mode the projector behaves like a spotlight with a projection attachment, the kind photographers put on
an Aputure, Nanlite or Godox light. You choose the light, put attachments (metal gobo plates) in front of it, set the
focus, and the wall shows believable light: a window patch at golden hour, blinds, leaves, stars, a round spot.

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

Every attachment is a round laser-cut metal plate, like the M-size plates that come with a spotlight attachment. Each
design follows one of the reference photos in `design/refs/gobo-plates` (its **source** names the photo), and nothing
is invented. Light passes through the cut-outs; the metal blocks the rest. Click a tile to put a plate in front of
the light (it replaces what is there); use the **+** on a tile (hold it on the phone) to add it on top.

55 plates in five groups:

- **Windows** (14): 6-pane grid window, arched window, palace window, skewed window, setting sun, slanted window,
  tall grid window, diamond lattice window, window grid III, blinds, slat blinds, fine vertical lines, fine
  horizontal lines (all parametric, below) and the louvre.
- **Nature** (13): bonfire, flames, leaf breakup, foliage breakup, breakup, cracked branches, bare branches, tree
  with leaves, vine leaves, fern leaves, jungle, scattered sticks, water ripples.
- **Sky** (11): moon and stars, stars, eight point stars, stardust, starfield, snowflakes, snowflake field, big
  snowflake, firework burst, lightning, rain lines.
- **Patterns** (10): hearts, rainbow arch, swirl, rings, bubbles, squiggles, dots, maze, pixel cloud, crossed lines.
- **Beams** (7): sunburst, radial, radial burst, fan rays, starburst cross, slit, circle.

Tiles show the plate itself, a grey disc with its cut-outs. Switch **plates show** to **its light** to see what each
one projects. Every plate has:

- **rotation, scale, left / right, up / down**: where it sits in the beam;
- **blocks**: how much light it stops (all of it for metal, less for a glass gobo);
- **light field**: **round** (the default) is the round beam of a spotlight. **Fill frame** scales the pattern to
  cover the whole 16:9 frame, **stretch** stretches it to the frame, **tile** repeats it across the frame;
- **throw**: stretches it away from the light, like a low sun on a wall;
- **keystone**: tilts its horizontals, as when the light comes in from the side;
- **frame depth**: the soft second edge a deep window frame casts.

Every island of metal hangs on a tie bridge, and no bar or opening is thinner than a real plate can hold, so the
shadows look like the real thing.

### Windows you can reshape

The window plates are one parametric window with presets: the 6-pane grid window, the arched window and the palace
window are the same window with different settings, and you can reshape any of them. Pick a window, then open the
**window** section of the attachment card (on the phone, the window section of the attachment controls):

| group | controls |
| --- | --- |
| grid | **sashes** side by side, **columns** and **rows** of panes per sash, **pane gap** (the glazing bars) |
| frame | **width** and **height** of the window, **frame width**, **mullion width** (the bar between sashes) |
| arch | **arch** on or off, **arch height**, **arch spokes** (the fan light's bars), **arch hub** (a small half wheel) |
| shape | **round window**, **top width** (narrower or wider than the bottom), **right height** (shorter or taller than the left), **slant**, **rise**: perspective, as when the window is seen at an angle |
| lattice | **diamond lattice** on or off, **lattice density**, **inner squares** (framed squares on the lattice, as in window grid III) |
| blinds | **slats** (0 for glass panes), **slat width** (how much of each slat is metal), **vertical slats** |

A control that only matters with a switch on (the arch height with the arch) shows when the switch is on.
**Reset to preset** puts the preset's geometry back. The presets:

| preset | what it is | reference |
| --- | --- | --- |
| 6-pane grid window | two sashes of 2 × 4 panes | Amaran MO10 |
| arched window | 3 × 4 panes under a round head with four spokes and a hub | Amaran MO11 |
| skewed window | 4 × 5 panes seen at an angle | Amaran MO09 |
| palace window | 4 × 5 panes under an arch split by two spokes | set B, Palace Window |
| setting sun | a low 4 × 4 window rising to the right | set B, Setting sun |
| slanted window | 4 × 4 panes cast at a slant, wide at the top | set 4 |
| tall grid window | 5 × 5 tall panes | set 4 |
| diamond lattice window | three sashes of leaded diamonds | set 4 |
| window grid III | a round diamond lattice with inner squares | set B |
| blinds | 22 slats with two ladder tapes | set B |
| slat blinds | 12 wide slats with thin bars | set 4 |
| fine vertical lines | 64 very fine vertical slits | set 4 |
| fine horizontal lines | 60 very fine horizontal slits | set 4 |

### Add a plate

Plates live in `frontend/src/render/plates/`: `replicas.ts` (the Amaran sets), `refsA23.ts` (set A, set 2, set 3),
`refsB.ts` (set B), `windows.ts` (the parametric window and its presets), `geom.ts` (the drawing helpers) and
`index.ts` (the list and the rasterizer).

1. Put the reference photo in `design/refs/gobo-plates` and say in its README which part is light.
2. Write a function that returns the plate's shapes in plate space: the plate is the unit circle, x right, y down,
   (0, 0) its centre. `cut(path)` opens metal, `metal(path)` closes it again, painted in order; `cutLine` and
   `metalLine` stroke a path. Helpers make the SVG path data: `poly`, `circle`, `rect`, `sector`, `ribbon` (a
   tapered stroke), `leaf`, `blob`, `jag`, `cells` (a Voronoi breakup) and `Room` (keeps scattered items apart).
   Randomness comes only from the `r` it gets, so the plate is the same every time.
3. Keep it cuttable: no metal may float. Give every island a tie bridge, keep openings and metal at least about
   0.012 wide (window bars at least 0.006), and keep scattered items clear of each other.
4. Add it to one of the lists with an id `plate-<name>`, a plain name, a description, a `category` (windows, nature,
   sky, patterns, beams), `source` (`<photo file>, <label>`), `field` (the radius of its round light field, default
   0.84) and a `seed`. A new window is a preset in `windows.ts`: only the geometry values that differ from the plain
   window.
5. Run `npm run catalog` (writes the plates into `contract/catalog.json`), `npm test` (the plate tests check the
   catalog and the sources), `npm run thumbs -- plate-<name>` (its two thumbnails) and `cd ../backend && make
   catalog`.

`plateSvg(def, 'metal' | 'mask', hole, params)` turns a plate into a standalone SVG when you want to look at it
outside the app.

### Older scenes

Scenes from before the plate library open with each removed attachment moved to the closest plate or window preset
(a 4-pane window becomes the grid window with one sash of 2 × 2 panes, blinds become slat blinds with the same
slats, a spot becomes the circle). The server logs every move once, on start.

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

The Static tab has the same light, attachment browser (thumbnails come from the server, as the metal plate or its
light), attachment controls (the light field is a segmented control; a window preset has the window section with the
same groups and sliders), frame slide and a motion card with the preset chips, a speed slider and play / pause. Drag
sideways on the picture or a slider to change it; vertical swipes always scroll the page and never move a control.

## For agents

Claude and Codex can do all of this over MCP: `catalog_get { section: "gobos" }` lists the plates with their
category, source and, for the window presets, their geometry and the window params; `light_set`, `attachment_add`,
`attachment_update` (window geometry goes in `params`), `attachment_remove`, `gobo_set` and `motion_set`. With **agents edit live** on (Set up, agents) their changes show on
the wall at once. See [agents-mcp.md](agents-mcp.md).

Live layers (swaying trees, clouds, rain) block the light the same way in live mode; to add one, see
[live-layers.md](live-layers.md).
