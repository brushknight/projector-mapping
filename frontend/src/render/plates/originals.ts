/**
 * Original plates for creator backdrops, drawn like laser-cut steel gobos: every island of metal hangs on a tie
 * bridge, openings keep a sensible minimum width (about 0.012 plate units, 0.35 mm on an M-size plate) and so does the
 * metal between them. Plate space: the unit circle, y down (see geom.ts).
 */
import {
  blob, circle, clearOfEdge, cubic, cut, cutLine, ellipse, leaf, lerp, line, metal, metalLine, noise2, open,
  poly, polar, quad, rect, ribbon, Room, sector, turn, type Pt, type Rng, type Shape,
} from './geom'
import type { PlateDef } from './types'

const TAU = Math.PI * 2

/** Venetian blinds seen on a curved wall: bowed slats that open up towards the bottom. */
function curvedVenetian(): Shape[] {
  const out: Shape[] = []
  for (let k = -11; k <= 11; k++) {
    const y0 = k * 0.118 + 0.006 * k * Math.abs(k)
    const pts: Pt[] = []
    for (let x = -1.25; x <= 1.2501; x += 0.05) pts.push([x, y0 + 0.2 * x * x - 0.08 + 0.04 * x])
    out.push(cutLine(line(pts), 0.074 + 0.002 * k, 'butt'))
  }
  return out
}

/** Bamboo stalks with node rings and sprays of narrow leaves, against the light. */
function bambooStalks(r: Rng): Shape[] {
  const out: Shape[] = [open()]
  const stalks: Array<[number, number, number]> = [[-0.82, 0.06, 0.05], [-0.5, 0.075, -0.04], [-0.14, 0.065, 0.03], [0.2, 0.08, -0.05], [0.52, 0.06, 0.04], [0.84, 0.07, -0.02]]
  for (const [x, w, lean] of stalks) {
    const a: Pt = [x - lean, 1.25], c: Pt = [x + lean * 0.4, 0], b: Pt = [x + lean, -1.25]
    const axis = quad(a, c, b, 60)
    out.push(metal(ribbon(axis, () => w / 2)))
    // nodes: a slit across the stalk that leaves two side bridges, and a swelling ring
    let t = r.range(0.04, 0.12)
    while (t < 0.96) {
      const i = Math.round(t * 60)
      const p = axis[i], q = axis[Math.min(60, i + 1)]
      const ang = Math.atan2(q[1] - p[1], q[0] - p[0]) + Math.PI / 2
      out.push(metal(rect(p[0], p[1], 0.024, w + 0.022, ang)))
      out.push(cut(rect(p[0], p[1] + 0.022, 0.011, w * 0.62, ang)))
      // a spray of leaves on a thin twig
      if (r() < 0.6 && Math.abs(p[1]) < 0.9) {
        const side = r() < 0.5 ? -1 : 1
        const tw = polar(r.range(0.12, 0.2), (side > 0 ? 0 : Math.PI) + side * r.range(-0.6, -0.2), p)
        out.push(metalLine(line([p, tw]), 0.014, 'round'))
        const n = r.int(3, 5)
        for (let k = 0; k < n; k++) {
          const da = side * r.range(0.2, 1.1) + Math.PI / 2 + (side > 0 ? -0.5 : 0.5)
          out.push(metal(leaf(tw, polar(r.range(0.22, 0.32), da, tw), r.range(0.045, 0.06), side * r.range(0.04, 0.1), 0.35)))
        }
      }
      t += r.range(0.12, 0.17)
    }
  }
  return out
}

/** One palm: a curved trunk with ring slits on bridges and a crown of feathered fronds. */
function palm(out: Shape[], r: Rng, foot: Pt, crown: Pt, w: number, fronds: number, len: number) {
  const mid = lerp(foot, crown, 0.5)
  const trunk = quad(foot, [mid[0] + (crown[0] - foot[0]) * 0.35, mid[1]], crown, 40)
  out.push(metal(ribbon(trunk, (t) => (w * (1 - 0.35 * t)) / 2)))
  for (let i = 3; i < 38; i += 3) {
    const p = trunk[i], q = trunk[i + 1]
    const ang = Math.atan2(q[1] - p[1], q[0] - p[0]) + Math.PI / 2
    out.push(cut(rect(p[0], p[1], 0.009, w * (1 - 0.35 * (i / 40)) * 0.6, ang)))
  }
  for (let k = 0; k < fronds; k++) {
    const a0 = -Math.PI / 2 + ((k + 0.5) / fronds - 0.5) * 3.6 + r.range(-0.12, 0.12)
    const L = len * r.range(0.8, 1.05)
    const tip = polar(L, a0, crown)
    const droop: Pt = [tip[0], tip[1] + L * 0.55 * Math.abs(Math.cos(a0)) + 0.1]
    const ctrl = polar(L * 0.6, a0 - 0.15 * Math.sign(Math.cos(a0)), crown)
    const axis = quad(crown, ctrl, droop, 30)
    out.push(metal(ribbon(axis, (t) => 0.012 * (1 - t) + 0.004)))
    for (let i = 2; i < axis.length - 1; i += 2) {
      const p = axis[i], q = axis[i + 1]
      const t = i / axis.length
      const tang = Math.atan2(q[1] - p[1], q[0] - p[0])
      for (const side of [-1, 1]) {
        const la = tang + side * 0.75 + 0.3
        out.push(metal(leaf(p, polar(0.2 * (1 - 0.6 * t) + 0.03, la, p), 0.024 * (1 - 0.4 * t), side * 0.06, 0.3)))
      }
    }
  }
}

/** Palm trees against a bright sky. */
function palmSilhouette(r: Rng): Shape[] {
  const out: Shape[] = [open()]
  palm(out, r, [0.42, 1.25], [-0.02, -0.28], 0.1, 10, 0.62)
  palm(out, r, [-0.82, 1.25], [-0.58, 0.12], 0.07, 8, 0.4)
  return out
}

/** A monstera leaf in metal: heart shaped with slits from the edge and holes by the midrib, on a stalk. */
function monsteraLeaf(out: Shape[], r: Rng, base: Pt, size: number, ang: number, stalkTo: Pt) {
  const half: Pt[] = [[0.0, 0.04], [0.16, 0.16], [0.38, 0.14], [0.52, -0.04], [0.56, -0.34], [0.5, -0.66], [0.3, -0.92]]
  const outline = [...half, [0, -1.02] as Pt, ...half.slice().reverse().map(([x, y]) => [-x, y] as Pt)].slice(0, -1)
  const P = (p: Pt) => turn([p[0] * size, p[1] * size], ang, base)
  out.push(metalLine(line([base, stalkTo]), 0.03 * size + 0.012, 'round'))
  out.push(metal(blob(outline.map(P))))
  for (const side of [-1, 1]) {
    for (let k = 0; k < 6; k++) {
      // slits fan out from the midrib: down and out near the stalk, up and out near the tip
      const y = -0.12 - k * 0.135
      const phi = -0.45 + (k / 5) * 1.25 + r.range(-0.06, 0.06)
      const d: Pt = [side * Math.cos(phi), -Math.sin(phi)]
      const n: Pt = [-d[1], d[0]]
      const I: Pt = [side * 0.12, y]
      const O: Pt = [I[0] + d[0] * 0.8, I[1] + d[1] * 0.8]
      const w = 0.045 + 0.02 * r()
      out.push(cut(poly([P([I[0] - n[0] * 0.012, I[1] - n[1] * 0.012]), P([O[0] - n[0] * w, O[1] - n[1] * w]), P([O[0] + n[0] * w, O[1] + n[1] * w]), P([I[0] + n[0] * 0.012, I[1] + n[1] * 0.012])])))
      if (k < 5 && r() < 0.85) {
        const c = P([side * 0.25, y - 0.075])
        out.push(cut(ellipse(c[0], c[1], 0.032 * size, 0.017 * size, ang + side * (phi + 0.3))))
      }
    }
  }
}

/** Monstera leaves on stalks from the rim. */
function monstera(r: Rng): Shape[] {
  const out: Shape[] = [open()]
  // the leaves never overlap: a slit in a front leaf must not open a leaf behind it
  monsteraLeaf(out, r, [-0.34, 0.3], 0.63, -0.8, [-1.2, 1.0])
  monsteraLeaf(out, r, [0.38, 0.22], 0.6, 0.75, [1.2, 0.95])
  monsteraLeaf(out, r, [0.02, 0.82], 0.4, 0.05, [0.06, 1.3])
  monsteraLeaf(out, r, [0.1, -0.78], 0.5, Math.PI + 0.25, [0.3, -1.3])
  return out
}

/** Jungle: vines from the rim carrying big leaves of three kinds, dense enough to read as a canopy. */
function jungleBreakup(r: Rng): Shape[] {
  const out: Shape[] = [open()]
  for (let v = 0; v < 16; v++) {
    const a = (v / 16) * TAU + r.range(-0.15, 0.15)
    const from = polar(1.3, a)
    const to = polar(r.range(0.35, 0.7), a + r.range(-0.9, 0.9))
    const c1 = polar(r.range(0.7, 1.0), a + r.range(-0.5, 0.5)), c2 = lerp(c1, to, 0.5)
    const vine = cubic(from, c1, c2, to, 30)
    out.push(metal(ribbon(vine, (t) => 0.012 * (1 - t) + 0.006)))
    for (let i = 3; i <= 30; i += 2) {
      const p = vine[i]
      const tang = Math.atan2(vine[Math.min(30, i + 1)][1] - p[1], vine[Math.min(30, i + 1)][0] - p[0])
      const side = (i % 4) - 2 < 0 ? 1 : -1
      const la = tang + side * r.range(0.5, 1.2)
      const kind = r()
      const L = r.range(0.16, 0.3)
      if (kind < 0.55) {
        out.push(metal(leaf(p, polar(L, la, p), L * r.range(0.38, 0.5), side * r.range(-0.08, 0.08), 0.42)))
      } else if (kind < 0.85) {
        // a split leaf: four narrow fingers
        for (let f = -1.5; f <= 1.5; f++) out.push(metal(leaf(p, polar(L * 1.1, la + f * 0.22, p), L * 0.16, 0.05, 0.4)))
      } else {
        out.push(metal(leaf(p, polar(L * 0.7, la, p), L * 0.6, 0, 0.3)))
      }
    }
  }
  return out
}

/** Stained glass: square panes with a diamond came and a ringed boss tied to it, all held by the grid. */
function stainedGlass(): Shape[] {
  const out: Shape[] = []
  const pitch = 0.34, came = 0.03
  for (let j = -3; j <= 3; j++) {
    for (let i = -3; i <= 3; i++) {
      const cx = i * pitch, cy = j * pitch
      const h = pitch / 2 - came / 2
      out.push(cut(rect(cx, cy, h * 2, h * 2)))
      // the diamond touches the pane edges, so it hangs on the grid
      const d: Pt[] = [[cx, cy - h], [cx + h, cy], [cx, cy + h], [cx - h, cy]]
      out.push(metalLine(poly(d), came * 0.8, 'butt', 'miter'))
      // the boss: a ring tied to the diamond's corners by four bridges
      const rr = h * 0.32
      out.push(metalLine(circle(cx, cy, rr), came * 0.7))
      for (const p of d) out.push(metalLine(line([lerp([cx, cy], p, rr / h), p]), 0.016, 'butt'))
      out.push(metal(circle(cx, cy, rr * 0.3)))
      out.push(metalLine(line([[cx - rr, cy], [cx + rr, cy]]), 0.014, 'butt'))
    }
  }
  return out
}

/** A pointed horseshoe arch, the opening of a Moroccan screen: narrow jambs, a bulging head, a pointed crown. */
function moorishArch(cx: number, cy: number, w: number, h: number): string {
  const R = w * 0.6, off = w * 0.1
  const spring = cy - h / 2 + R
  const apex = Math.acos(-off / R)
  const left: Pt[] = []
  for (let i = 0; i <= 18; i++) {
    const a = Math.PI + 0.32 + ((apex - Math.PI - 0.32) * i) / 18
    left.push([cx + off + R * Math.cos(a), spring - R * Math.sin(a)])
  }
  const right = left.slice().reverse().map(([x, y]) => [2 * cx - x, y] as Pt)
  const jamb = left[0][0]
  return poly([[jamb, cy + h / 2], ...left, ...right.slice(1), [2 * cx - jamb, cy + h / 2]])
}

/** An eight pointed star. */
const star8 = (cx: number, cy: number, R: number) => poly(Array.from({ length: 16 }, (_, k) => polar(k % 2 ? R * 0.55 : R, (k * Math.PI) / 8, [cx, cy])))

/** Moroccan arch lattice: rows of pointed horseshoe arches with eight pointed stars between them. */
function moroccanArches(): Shape[] {
  const out: Shape[] = []
  const px = 0.3, py = 0.52
  for (let j = -3; j <= 3; j++) {
    for (let i = -5; i <= 5; i++) {
      const x = i * px + (j % 2 ? px / 2 : 0), y = j * py
      out.push(cut(moorishArch(x, y, 0.2, 0.4)))
      out.push(cut(star8(x + px / 2, y - py / 2 + 0.02, 0.045)))
    }
  }
  return out
}

/** Honeycomb: hexagon cells with an even web. */
function honeycomb(): Shape[] {
  const out: Shape[] = []
  const R = 0.105, web = 0.026
  const w = Math.sqrt(3) * R
  for (let j = -7; j <= 7; j++) {
    for (let i = -7; i <= 7; i++) {
      const cx = i * w + (j % 2 ? w / 2 : 0), cy = j * R * 1.5
      const rr = R - web / Math.sqrt(3)
      out.push(cut(poly(Array.from({ length: 6 }, (_, k) => polar(rr, Math.PI / 6 + (k * Math.PI) / 3, [cx, cy])))))
    }
  }
  return out
}

/** Concentric circles: ring slots, each held by three bridges, staggered from ring to ring. */
function concentric(): Shape[] {
  const out: Shape[] = [cut(circle(0, 0, 0.055))]
  for (let k = 0; k < 12; k++) {
    const rc = 0.15 + k * 0.105
    out.push(cutLine(circle(0, 0, rc), 0.05))
    for (let b = 0; b < 3; b++) {
      const a = (b / 3) * TAU + k * 0.55
      out.push(metalLine(line([polar(rc - 0.04, a), polar(rc + 0.04, a)]), 0.022 + 0.004 * Math.min(k, 6), 'butt'))
    }
  }
  return out
}

/** A spiral slot from the centre out past the rim. */
function spiral(): Shape[] {
  const pts: Pt[] = []
  for (let a = 0; a < TAU * 8; a += 0.03) {
    const rr = 0.03 + (0.22 * a) / TAU
    if (rr > 1.45) break
    pts.push(polar(rr, a))
  }
  return [cutLine(line(pts), 0.05, 'round'), cutLine(line(pts.map(([x, y]) => [-x, -y] as Pt)), 0.05, 'round')]
}

/** A city skyline: open sky, metal towers with lit windows, spires and a water tower. */
function skyline(r: Rng): Shape[] {
  const out: Shape[] = [cut('M-1.2 -1.2H1.2V1.2H-1.2Z')]
  let x = -1.2
  let roof: { x: number; w: number; top: number } | null = null
  while (x < 1.2) {
    const w = r.range(0.1, 0.22)
    const top = r() < 0.15 ? r.range(-0.6, -0.4) : r.range(-0.3, 0.32)
    const steps = r() < 0.35
    out.push(metal(poly([[x, 1.2], [x, top], [x + w, top], [x + w, 1.2]])))
    if (!roof && !steps && x > -0.55 && top > -0.1 && top < 0.15) roof = { x, w, top }
    if (steps) out.push(metal(rect(x + w / 2, top - 0.04, w * 0.6, 0.09)))
    if (r() < 0.25) out.push(metalLine(line([[x + w / 2, top - (steps ? 0.08 : 0)], [x + w / 2, top - r.range(0.12, 0.24)]]), 0.014, 'butt'))
    // windows, a few dark
    const cols = Math.max(2, Math.floor((w - 0.03) / 0.04))
    const gx = (w - 0.02) / cols
    for (let yy = top + 0.05; yy < 0.95; yy += 0.055) {
      for (let c = 0; c < cols; c++) if (r() < 0.55) out.push(cut(rect(x + 0.01 + gx * (c + 0.5), yy, gx * 0.55, 0.026)))
    }
    x += w + r.range(-0.01, 0.025)
  }
  // a water tower on a roof, its legs make the bridges
  if (roof) {
    const cx = roof.x + roof.w / 2, base = roof.top + 0.01, tank = roof.top - 0.2
    out.push(metal(rect(cx, tank, 0.12, 0.09)), metal(poly([[cx - 0.075, tank - 0.04], [cx, tank - 0.12], [cx + 0.075, tank - 0.04]])))
    out.push(metalLine(line([[cx - 0.05, tank], [cx - 0.06, base]]), 0.013, 'butt'), metalLine(line([[cx + 0.05, tank], [cx + 0.06, base]]), 0.013, 'butt'))
    out.push(metalLine(line([[cx - 0.055, tank + 0.1], [cx + 0.055, tank + 0.1]]), 0.01, 'butt'))
  }
  return out
}

/** Wedge rays from the centre: n openings, each `fill` of its share. */
function starburst(n: number, fill: number): Shape[] {
  const out: Shape[] = []
  const step = TAU / n
  for (let i = 0; i < n; i++) {
    const a0 = i * step - (step * fill) / 2, a1 = i * step + (step * fill) / 2
    out.push(cut(poly([polar(0.09, a0), polar(1.6, a0), polar(1.6, a1), polar(0.09, a1)])))
  }
  return out
}

/** Art Deco fan: a rising sun of cells in three bands, rays above, stripes below. */
function decoFan(): Shape[] {
  const out: Shape[] = []
  const c: Pt = [0, 0.5]
  const gap = 0.028
  out.push(cut(sector(c[0], c[1], 0, 0.16, Math.PI, TAU)))
  const bands: Array<[number, number, number]> = [[0.2, 0.36, 5], [0.4, 0.57, 9], [0.61, 0.8, 13]]
  for (const [r1, r2, n] of bands) {
    for (let k = 0; k < n; k++) {
      const a0 = Math.PI + (k / n) * Math.PI + gap / 2 / r1, a1 = Math.PI + ((k + 1) / n) * Math.PI - gap / 2 / r1
      out.push(cut(sector(c[0], c[1], r1, r2, a0, a1)))
    }
  }
  for (let k = 1; k < 16; k++) {
    const a = Math.PI + (k / 16) * Math.PI
    out.push(cut(poly([polar(0.86, a - 0.03, c), polar(1.7, a - 0.06, c), polar(1.7, a + 0.06, c), polar(0.86, a + 0.03, c)])))
  }
  for (let k = 0; k < 4; k++) out.push(cut(rect(0, c[1] + 0.07 + k * 0.08, 1.7 - k * 0.3, 0.04)))
  return out
}

/** Blinds at a slant. */
function diagonalBlinds(): Shape[] {
  const out: Shape[] = []
  const a = (-35 * Math.PI) / 180
  for (let k = -14; k <= 14; k++) out.push(cut(rect(...turn([0, k * 0.12], a), 3.2, 0.074, a)))
  return out
}

/** Round portholes in a hex grid, each crossed by a pair of glazing bars. */
function portholes(): Shape[] {
  const out: Shape[] = []
  const p = 0.29, R = 0.105
  for (let j = -5; j <= 5; j++) {
    for (let i = -5; i <= 5; i++) {
      const cx = i * p + (j % 2 ? p / 2 : 0), cy = j * p * 0.866
      out.push(cut(circle(cx, cy, R)))
      out.push(metalLine(line([[cx - R - 0.01, cy], [cx + R + 0.01, cy]]), 0.016, 'butt'), metalLine(line([[cx, cy - R - 0.01], [cx, cy + R + 0.01]]), 0.016, 'butt'))
    }
  }
  return out
}

/** God rays: shafts of light fanning down from behind clouds, a silver lining on the cloud edge. */
function godRays(r: Rng): Shape[] {
  const out: Shape[] = []
  const vp: Pt = [-0.45, -1.7]
  let a = 0.95
  while (a < 1.95) {
    const w = r.range(0.025, 0.07)
    out.push(cut(poly([vp, polar(4, a, vp), polar(4, a + w, vp)])))
    a += w + r.range(0.02, 0.06)
  }
  // the clouds: a bumpy band over the top, metal
  const edge: Pt[] = []
  for (let x = -1.3; x <= 1.3; x += 0.05) edge.push([x, -0.28 + 0.07 * Math.sin(x * 5.3) + 0.05 * Math.sin(x * 11 + 1) + 0.12 * x])
  out.push(metal(poly([[-1.3, -1.3], [1.3, -1.3], ...edge.slice().reverse()])))
  // a silver lining: thin bright arcs just inside the cloud edge, broken so the cloud stays tied on
  for (let i = 0; i + 6 < edge.length; i += 8) {
    const seg = edge.slice(i, i + 7).map(([x, y]) => [x, y - 0.045] as Pt)
    out.push(cutLine(line(seg), 0.016, 'round'))
  }
  // holes in the clouds
  for (let k = 0; k < 9; k++) {
    const x = r.range(-0.9, 0.9)
    const y = -0.28 + 0.12 * x - r.range(0.16, 0.5)
    out.push(cut(ellipse(x, y, r.range(0.03, 0.08), r.range(0.012, 0.025), r.range(-0.2, 0.2))))
  }
  return out
}

/** Wavy line slots. */
function waveLines(): Shape[] {
  const out: Shape[] = []
  for (let k = -9; k <= 9; k++) {
    const pts: Pt[] = []
    for (let x = -1.25; x <= 1.2501; x += 0.025) pts.push([x, k * 0.13 + 0.06 * Math.sin(x * 4.6 + k * 0.5)])
    out.push(cutLine(line(pts), 0.05, 'butt'))
  }
  return out
}

/** Abstract triangles of many sizes, scattered and turned. */
function triangles(r: Rng): Shape[] {
  const out: Shape[] = []
  const room = new Room(0.022)
  for (let k = 0; k < 8000; k++) {
    const c: Pt = [r.range(-1.05, 1.05), r.range(-1.05, 1.05)]
    const R = r() < 0.15 ? r.range(0.13, 0.2) : r.range(0.05, 0.11)
    const a = r.range(0, TAU)
    const tri = [0, 1, 2].map((i) => polar(R * r.range(0.85, 1.1), a + (i * TAU) / 3, c))
    if (!clearOfEdge(tri, 0.84, 0.01)) continue
    if (!room.take([c, ...tri.map((p) => lerp(p, c, 0.4))], R * 0.55)) continue
    out.push(cut(poly(tri)))
  }
  return out
}

/** Dappled light: soft round spots clustered as through a canopy. */
function dapple(r: Rng, min: number, max: number, n: number): Shape[] {
  const out: Shape[] = []
  const room = new Room(0.016)
  for (let k = 0; k < 40000 && out.length < n; k++) {
    const c: Pt = [r.range(-1.05, 1.05), r.range(-1.05, 1.05)]
    const nz = noise2(c[0] * 2.6 + 3, c[1] * 2.6 + 1, 7)
    if (nz < 0.35) continue
    const R = min + (max - min) * Math.pow(r(), 1.6) * (0.5 + nz)
    const ring: Pt[] = Array.from({ length: 9 }, (_, i) => polar(R * r.range(0.82, 1.12), (i / 9) * TAU, c)).map(([x, y]) => [c[0] + (x - c[0]) * 1.15, y] as Pt)
    if (!clearOfEdge(ring, 0.84, 0.01)) continue
    if (!room.take([c], R * 1.2)) continue
    out.push(cut(blob(ring)))
  }
  return out
}

/** A chain link fence: diamond holes between wires. */
function meshFence(): Shape[] {
  const out: Shape[] = []
  const p = 0.12, wire = 0.024
  const h = (p - wire) / Math.SQRT2
  for (let j = -14; j <= 14; j++) {
    for (let i = -14; i <= 14; i++) {
      const c = turn([i * p, j * p], Math.PI / 4)
      if (Math.abs(c[0]) > 1.2 || Math.abs(c[1]) > 1.2) continue
      out.push(cut(poly([[c[0], c[1] - h], [c[0] + h, c[1]], [c[0], c[1] + h], [c[0] - h, c[1]]])))
    }
  }
  return out
}

/** A window with curtains tied back, a scalloped valance, and folds that let thin light through. */
function curtainWindow(): Shape[] {
  const out: Shape[] = []
  const x0 = -0.46, x1 = 0.46, y0 = -0.62, y1 = 0.66
  out.push(cut(poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])))
  for (const x of [0]) out.push(metalLine(line([[x, y0 - 0.01], [x, y1 + 0.01]]), 0.034, 'butt'))
  for (const y of [y0 + (y1 - y0) / 3, y0 + (2 * (y1 - y0)) / 3]) out.push(metalLine(line([[x0 - 0.01, y], [x1 + 0.01, y]]), 0.028, 'butt'))
  for (const s of [-1, 1]) {
    // the curtain: outer edge off the window, inner edge gathered at the tie back
    const inner = cubic([s * 0.14, -0.7], [s * 0.2, -0.25], [s * 0.5, -0.02], [s * 0.42, 0.12], 20).concat(cubic([s * 0.42, 0.12], [s * 0.36, 0.3], [s * 0.2, 0.6], [s * 0.24, 1.2], 20))
    out.push(metal(poly([[s * 1.3, -1.3], ...inner, [s * 1.3, 1.3]])))
    // folds: thin slits that stop short of the tie back so every panel stays on
    for (const k of [0.25, 0.5, 0.75]) {
      const top: Pt = [s * (0.14 + 0.5 * k + 0.08), -0.66]
      const mid: Pt = [s * (0.42 + 0.3 * k), 0.06]
      out.push(cutLine(line(quad(top, [s * (0.3 + 0.45 * k), -0.3], mid, 12)), 0.014, 'round'))
      const low: Pt = [s * (0.46 + 0.3 * k), 0.2]
      out.push(cutLine(line(quad(low, [s * (0.38 + 0.4 * k), 0.6], [s * (0.36 + 0.5 * k), 1.1], 12)), 0.014, 'round'))
    }
  }
  // the valance: a scalloped pelmet over the top
  const sc: Pt[] = []
  for (let x = -1.3; x <= 1.3001; x += 0.02) sc.push([x, -0.66 + 0.04 * Math.abs(Math.sin(x * Math.PI * 2.5))])
  out.push(metal(poly([[-1.3, -1.3], [1.3, -1.3], ...sc.reverse()])))
  return out
}

export const ORIGINALS: PlateDef[] = [
  { id: 'plate-curved-venetian', name: 'curved venetian', description: 'venetian blinds bowed across a curved wall', draw: curvedVenetian },
  { id: 'plate-bamboo-stalks', name: 'bamboo stalks', description: 'bamboo stalks and leaf sprays against the light', seed: 31, draw: bambooStalks },
  { id: 'plate-palm-silhouette', name: 'palm silhouette', description: 'two palm trees against a bright sky', seed: 32, draw: palmSilhouette },
  { id: 'plate-monstera', name: 'monstera leaves', description: 'split monstera leaves on long stalks', seed: 33, draw: monstera },
  { id: 'plate-jungle-breakup', name: 'jungle breakup', description: 'vines and big leaves, a dense canopy with light between', seed: 34, draw: jungleBreakup },
  { id: 'plate-stained-glass', name: 'stained-glass grid', description: 'square panes with diamond cames and ringed bosses', draw: stainedGlass },
  { id: 'plate-moroccan-arch', name: 'Moroccan arch lattice', description: 'rows of pointed horseshoe arches and stars', draw: moroccanArches },
  { id: 'plate-honeycomb', name: 'honeycomb', description: 'hexagon cells with an even web', draw: honeycomb },
  { id: 'plate-concentric', name: 'concentric circles', description: 'ring slots held by staggered bridges', draw: concentric },
  { id: 'plate-spiral', name: 'spiral', description: 'a double spiral slot from the centre out', draw: spiral },
  { id: 'plate-skyline', name: 'cityscape skyline', description: 'towers with lit windows against an open sky', seed: 41, draw: skyline },
  { id: 'plate-starburst-fine', name: 'starburst fine', description: 'forty eight narrow rays from the centre', draw: () => starburst(48, 0.42) },
  { id: 'plate-starburst-bold', name: 'starburst bold', description: 'sixteen wide rays from the centre', draw: () => starburst(16, 0.5) },
  { id: 'plate-deco-fan', name: 'Art Deco fan', description: 'a rising sun of cells with rays and stripes', draw: decoFan },
  { id: 'plate-diagonal-blinds', name: 'diagonal blinds', description: 'blinds at a slant', draw: diagonalBlinds },
  { id: 'plate-portholes', name: 'porthole grid', description: 'round portholes with crossed bars', draw: portholes },
  { id: 'plate-god-rays', name: 'god rays', description: 'shafts of light fanning down from behind clouds', seed: 45, draw: godRays },
  { id: 'plate-wave-lines', name: 'wave lines', description: 'wavy line slots across the field', draw: waveLines },
  { id: 'plate-triangles', name: 'abstract triangles', description: 'triangles of many sizes, scattered and turned', seed: 47, draw: triangles },
  { id: 'plate-dapple-fine', name: 'dappled light fine', description: 'many small soft spots, as under a canopy', seed: 48, draw: (r) => dapple(r, 0.018, 0.04, 420) },
  { id: 'plate-dapple-bold', name: 'dappled light bold', description: 'fewer big soft spots, as under a canopy', seed: 49, draw: (r) => dapple(r, 0.045, 0.1, 90) },
  { id: 'plate-mesh-fence', name: 'mesh fence', description: 'a chain link fence of diamond holes', draw: meshFence },
  { id: 'plate-curtain-window', name: 'window with curtains', description: 'a window with curtains tied back and a valance', draw: curtainWindow },
]
