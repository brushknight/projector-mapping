/**
 * Replica plates: our own vector versions of the Amaran AS-GB-M SET1 and SET2 plates (amaran-as-gb-m-set1.png and
 * amaran-as-gb-m-set2.png in design/refs/gobo-plates, MO05 to MO24; `source` says which). The window plates MO09 to
 * MO11 are parametric window presets (windows.ts). Plate space: the unit circle, y down (see geom.ts).
 */
import {
  blob, cells, circle, clearOfEdge, cut, cutLine, dist, jag, leaf, line, lerp, metal, metalLine, noise2, open, poly, polar,
  jittered, quad, rect, ribbon, Room, scatter, turn, type Pt, type Rng, type Shape,
} from './geom'
import type { PlateDef } from './types'

const TAU = Math.PI * 2

// ── set 1 ────────────────────────────────────────────────────────────────────

/** MO05: thin rays round an empty centre, long and short in turn. */
function sunburst(r: Rng): Shape[] {
  const out: Shape[] = []
  const n = 34
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + r.range(-0.035, 0.035)
    const long = i % 2 === 0
    const r0 = long ? r.range(0.13, 0.19) : r.range(0.22, 0.34)
    const r1 = long ? r.range(0.64, 0.74) : r.range(0.48, 0.6)
    out.push(cutLine(line([polar(r0, a), polar(r1, a)]), r.range(0.024, 0.03), 'round'))
  }
  return out
}

/** MO06: eleven wide horizontal slats inside a round field. */
function louvre(): Shape[] {
  const out: Shape[] = []
  const pitch = 0.134, open = 0.09
  for (let k = -9; k <= 9; k++) {
    const y = k * pitch
    out.push(cut(rect(0, y, 2.4, open)))
  }
  return out
}

/** MO07: thin vertical rain streaks of many lengths. */
function rainLines(r: Rng): Shape[] {
  const out: Shape[] = []
  const field = 0.82
  for (let x = -0.64; x <= 0.645; x += 0.062) {
    const xx = x + r.range(-0.012, 0.012)
    const room = Math.sqrt(Math.max(0, (field - 0.04) ** 2 - xx * xx))
    const L = Math.min(room * 2 - 0.02, r.range(0.28, 0.95))
    const cy = r.range(-room + L / 2, room - L / 2) * 0.55
    out.push(cutLine(line([[xx, cy - L / 2], [xx, cy + L / 2]]), r.range(0.019, 0.025), 'butt'))
  }
  // the corners, for fill frame and tile
  for (let x = -1; x <= 1.001; x += 0.062) {
    for (const s of [-1, 1]) {
      const L = r.range(0.15, 0.4)
      const y0 = s * r.range(0.75, 1.05)
      const pts: Pt[] = [[x, y0 - L / 2], [x, y0 + L / 2]]
      if (clearOfEdge(pts, field, 0.03) && pts.every((p) => Math.hypot(p[0], p[1]) > field)) out.push(cutLine(line(pts), 0.026, 'butt'))
    }
  }
  return out
}

/** MO08: wedge rays fanning up from a point below the plate. */
function fanRays(): Shape[] {
  const out: Shape[] = []
  const vp: Pt = [0, 1.55]
  const n = 9, span = (25 * Math.PI) / 180, bar = 0.3
  const step = (2 * span) / n
  for (let i = 0; i < n; i++) {
    const a0 = -Math.PI / 2 - span + i * step + (step * bar) / 2
    const a1 = a0 + step * (1 - bar)
    out.push(cut(poly([polar(0.35, a0, vp), polar(4, a0, vp), polar(4, a1, vp), polar(0.35, a1, vp)])))
  }
  return out
}

/** MO12: an open field crossed by many thin wires at random angles. */
function crossedLines(r: Rng): Shape[] {
  const out: Shape[] = [open()]
  for (let i = 0; i < 58; i++) {
    const c: Pt = [r.range(-0.75, 0.75), r.range(-0.75, 0.75)]
    // mostly shallow diagonals, some steep, as in the plate
    const a = r() < 0.6 ? r.range(-0.75, 0.75) : r.range(0.9, 2.3)
    out.push(metalLine(line([turn([-3, 0], a, c), turn([3, 0], a, c)]), r.range(0.011, 0.018), 'butt'))
  }
  return out
}

/** MO13: short sticks scattered every way, some forked. */
function scatteredSticks(r: Rng): Shape[] {
  const out: Shape[] = []
  const field = 0.8
  const centres = scatter(r, 330, () => 0.085, () => true, 1.05)
  for (const c of centres) {
    const a = r.range(0, Math.PI)
    const L = r.range(0.07, 0.17)
    const pts: Pt[] = [turn([-L / 2, 0], a, c), turn([L / 2, 0], a, c)]
    const fork = r() < 0.22
    const fp = fork ? turn([r.range(-L / 4, L / 4), 0], a, c) : null
    const fe = fp ? turn([0, (r() < 0.5 ? -1 : 1) * r.range(0.04, 0.07)], a + r.range(-0.4, 0.4), fp) : null
    const all = fe ? [...pts, fe] : pts
    if (!clearOfEdge(all, field, 0.035)) continue
    const w = r.range(0.026, 0.036)
    out.push(cutLine(line(pts), w, 'round'))
    if (fp && fe) out.push(cutLine(line([fp, fe]), w * 0.9, 'round'))
  }
  return out
}

/** MO14: a cloud of square pixels in a wide band. */
function pixelCloud(r: Rng): Shape[] {
  const out: Shape[] = []
  const pitch = 0.074, sq = 0.056
  for (let j = -6; j <= 6; j++) {
    for (let i = -13; i <= 13; i++) {
      const x = i * pitch, y = j * pitch + 0.01
      const env = (x / 0.84) ** 2 + ((y - 0.02) / 0.34) ** 2
      if (env > 1.05) continue
      const n = noise2(x * 3.2 + 4, y * 4.2 + 2, 3) * 0.65 + noise2(x * 8, y * 8, 5) * 0.35
      const prob = Math.min(1, Math.max(0, (n - 0.28) * 2.4)) * (1 - env * env * 0.7)
      const keep = r() < prob
      if (keep) out.push(cut(rect(x, y, sq, sq)))
    }
  }
  return out
}

// ── set 2 ────────────────────────────────────────────────────────────────────

/** MO15: rows of thin wavy slivers, like light on water. */
function waterRipples(r: Rng): Shape[] {
  const out: Shape[] = []
  for (let y = -1.05; y <= 1.05; y += 0.058) {
    let x = -1.15 + r.range(0, 0.2)
    const ph = r.range(0, TAU)
    const yy = y + r.range(-0.01, 0.01)
    while (x < 1.15) {
      const L = r.range(0.12, 0.62)
      const pts: Pt[] = []
      const n = Math.max(4, Math.round(L / 0.03))
      for (let i = 0; i <= n; i++) {
        const xi = x + (L * i) / n
        pts.push([xi, yy + 0.016 * Math.sin(xi * 7 + ph) + 0.008 * Math.sin(xi * 19 + ph * 2)])
      }
      const wmax = r.range(0.016, 0.03)
      out.push(cut(ribbon(pts, (t) => (wmax / 2) * Math.pow(Math.sin(Math.PI * t), 0.55))))
      x += L + r.range(0.025, 0.14)
    }
  }
  return out
}

/** A crisp six-armed snowflake. Style 0: forked arms; 1: chevrons; 2: lacy with a hexagon heart. */
export function snowflake(c: Pt, R: number, style: number, rot: number): Shape[] {
  const w = Math.max(0.014, R * (style === 2 ? 0.09 : 0.11))
  const segs: string[] = []
  for (let k = 0; k < 6; k++) {
    const a = rot + (k * Math.PI) / 3
    const at = (t: number) => polar(R * t, a, c)
    segs.push(line([at(0), at(1)]))
    const twig = (t: number, len: number, ang: number) => {
      const p = at(t)
      segs.push(line([p, polar(R * len, a + ang, p)]), line([p, polar(R * len, a - ang, p)]))
    }
    if (style === 0) {
      twig(0.45, 0.27, Math.PI / 3)
      twig(0.72, 0.19, Math.PI / 3)
    } else if (style === 3) {
      twig(0.58, 0.3, Math.PI / 4)
    } else if (style === 1) {
      twig(0.5, 0.26, Math.PI / 4)
      twig(0.74, 0.18, Math.PI / 4)
    } else {
      twig(0.35, 0.22, Math.PI / 3)
      twig(0.55, 0.3, Math.PI / 3)
      twig(0.78, 0.2, Math.PI / 3)
      // a short arm between each pair of main arms: the lacy, round look of a stellar plate
      const b = a + Math.PI / 6
      segs.push(line([polar(R * 0.12, b, c), polar(R * 0.3, b, c)]))
    }
  }
  const out: Shape[] = [cutLine(segs.join(''), w, style === 1 ? 'round' : 'butt', 'miter')]
  const hex = Array.from({ length: 6 }, (_, k) => polar(R * (style === 2 ? 0.22 : 0.13), rot + (k * Math.PI) / 3 + Math.PI / 6, c))
  out.push(cut(poly(hex)))
  return out
}

/** MO16: ten snowflakes of three sizes. */
function snowflakes(): Shape[] {
  const flakes: Array<[number, number, number, number]> = [
    [-0.56, -0.27, 0.16, 2], [-0.16, -0.42, 0.15, 2], [0.38, -0.45, 0.19, 2], [-0.29, -0.16, 0.11, 3],
    [0.07, -0.2, 0.105, 3], [0.33, 0.06, 0.17, 2], [-0.3, 0.14, 0.15, 1], [-0.06, 0.47, 0.17, 2],
    [-0.55, 0.39, 0.095, 3], [0.3, 0.46, 0.1, 1],
    // the corners, for fill frame and tile
    [-0.88, -0.86, 0.1, 0], [0.86, -0.9, 0.09, 1], [0.9, 0.84, 0.11, 2], [-0.86, 0.9, 0.09, 0],
  ]
  return flakes.flatMap(([x, y, R, s], i) => snowflake([x, y], R, s, i * 0.21))
}

/** MO17: two forked lightning bolts with many short side strikes. */
function lightning(r: Rng): Shape[] {
  const out: Shape[] = []
  // a strike that runs back into another would ring a sliver of metal: skip it
  const room = new Room(0.016)
  const strike = (a: Pt, b: Pt, w0: number, w1: number, branches: number, depth: number, rough = 0.17, side = 0) => {
    const pts = jag(a, b, r, 6, rough, 0.86)
    const half = (t: number) => (w0 + (w1 - w0) * t) / 2
    const own = pts.slice(Math.ceil(pts.length * 0.35))
    if (side && !room.fits(own, (t) => half(0.35 + 0.65 * t))) return
    room.add(pts, half)
    out.push(cut(ribbon(pts, half)))
    if (depth <= 0) return
    for (let k = 0; k < branches; k++) {
      const i = Math.floor(r.range(0.15, 0.8) * (pts.length - 1))
      const p = pts[i]
      const sd = side || (r() < 0.5 ? -1 : 1)
      const dir = Math.atan2(b[1] - a[1], b[0] - a[0]) + sd * r.range(0.55, 0.95)
      const L = dist(a, b) * r.range(0.18, 0.4) * (depth > 1 ? 1 : 0.6)
      const w = w0 + (w1 - w0) * (i / (pts.length - 1))
      strike(p, polar(L, dir, p), Math.max(0.013, w * 0.75), 0.012, depth > 1 ? 2 : 0, depth - 1, 0.09, sd)
    }
  }
  strike([-0.14, -0.7], [-0.64, 0.18], 0.03, 0.014, 6, 2, 0.13)
  strike([0.12, -0.72], [0.5, 0.6], 0.032, 0.014, 7, 2, 0.12)
  return out
}

/** A four-pointed sparkle. */
const sparkle = (c: Pt, R: number, a = 0): Shape =>
  cut(poly(Array.from({ length: 8 }, (_, k) => polar(k % 2 ? R * 0.28 : R, a + (k * Math.PI) / 4, c))))

/** MO18: a star field: dots in loose clusters, a few sparkles and two little nebulae. */
function starfield(r: Rng): Shape[] {
  const out: Shape[] = []
  const field = 0.82
  const pts = scatter(r, 260, () => 0.07, (p) => {
    const d = Math.hypot(p[0], p[1])
    if (d < field && d > field - 0.04) return false
    return noise2(p[0] * 3 + 7, p[1] * 3 + 1, 11) > 0.38
  }, 1.02)
  for (const p of pts) out.push(cut(circle(p[0], p[1], r.range(0.009, 0.019))))
  // small clusters
  for (const c of [[-0.42, -0.02], [0.05, -0.2], [0.42, 0.42], [-0.6, 0.18]] as Pt[]) {
    for (let k = 0; k < 5; k++) out.push(cut(circle(c[0] + r.range(-0.04, 0.04), c[1] + r.range(-0.03, 0.03), r.range(0.008, 0.013))))
  }
  out.push(sparkle([-0.03, 0.17], 0.06, 0.2), sparkle([0.7, 0.15], 0.05), sparkle([0.18, -0.62], 0.04, 0.3))
  // nebulae: soft ragged blobs
  for (const [c, rx, ry] of [[[0.5, 0.32], 0.07, 0.045], [[0.22, 0.68], 0.06, 0.04]] as Array<[Pt, number, number]>) {
    const ring: Pt[] = Array.from({ length: 14 }, (_, k) => {
      const a = (k / 14) * TAU
      const j = r.range(0.75, 1.15)
      return [c[0] + rx * j * Math.cos(a), c[1] + ry * j * Math.sin(a)]
    })
    out.push(cut(blob(ring)))
  }
  return out
}

/** A flame tongue's centre line and half width: round foot, concave pointed tip, an S curve and a lean. */
function tonguePath(base: Pt, h: number, W: number, lean: number, ph: number, amp = 0.12, fat = 1.4): { pts: Pt[]; half: (s: number) => number } {
  const pts: Pt[] = []
  const n = 30
  for (let i = 0; i <= n; i++) {
    const s = i / n
    pts.push([base[0] + lean * h * s * s + amp * h * Math.sin(Math.PI * 1.4 * s + ph) * Math.pow(s, 1.2), base[1] - h * s])
  }
  return { pts, half: (s) => (W / 2) * (s < 0.32 ? Math.pow(Math.sin((s / 0.32) * Math.PI * 0.5), 0.7) : Math.pow((1 - s) / 0.68, fat)) }
}
function tongue(base: Pt, h: number, W: number, lean: number, ph: number, amp = 0.12, fat = 1.4): string {
  const t = tonguePath(base, h, W, lean, ph, amp, fat)
  return ribbon(t.pts, t.half)
}

/** MO19: flames: licking tongues spread over the field, a big fire at the foot with a dark heart. */
function flames(r: Rng): Shape[] {
  const out: Shape[] = []
  const room = new Room(0.018)
  // the big fire: a wide centre tongue and flanking ones merged into one, a dark heart tied to the metal below
  for (const [x, h, W, lean, ph] of [[0, 0.66, 0.3, 0.05, 0.4], [-0.1, 0.5, 0.24, -0.35, 1.2], [0.1, 0.54, 0.24, 0.3, 2.4], [-0.2, 0.36, 0.16, -0.5, 0.2], [0.21, 0.4, 0.16, 0.5, 3]]) {
    const t = tonguePath([x, 0.86], h, W, lean, ph, 0.14, 1.1)
    room.add(t.pts, t.half)
    out.push(cut(ribbon(t.pts, t.half)))
  }
  out.push(metal(tongue([0.01, 1.0], 0.52, 0.16, -0.2, 1.8, 0.2, 1.2)))
  out.push(cut(tongue([0.0, 0.78], 0.22, 0.07, 0.3, 0.4, 0.2)))
  // the licks, taller low down, each clear of the others
  for (let k = 0; k < 900; k++) {
    const p: Pt = [r.range(-0.75, 0.75), r.range(-0.75, 0.6)]
    if (Math.hypot(p[0], p[1] * 1.05) > 0.72) continue
    const h = r.range(0.2, 0.38) * (1.05 - 0.3 * Math.max(0, -p[1]))
    const W = h * r.range(0.24, 0.32)
    const base: Pt = [p[0], p[1] + h * 0.45]
    if (Math.hypot(base[0], base[1]) > 0.77 || Math.hypot(p[0], p[1] - h * 0.55) > 0.8) continue
    const ph = r.range(0, TAU)
    const t = tonguePath(base, h, W, r.range(-0.15, 0.15), ph, 0.3)
    const side = r() < 0.5 ? -1 : 1
    const f = r() < 0.55 ? tonguePath([base[0] + side * W * 0.2, base[1] - h * 0.25], h * 0.42, W * 0.5, side * 0.9, ph + 1, 0.2) : null
    if (!room.fits(t.pts, t.half) || (f && !room.fits(f.pts, f.half))) continue
    room.add(t.pts, t.half)
    out.push(cut(ribbon(t.pts, t.half)))
    if (f) {
      room.add(f.pts, f.half)
      out.push(cut(ribbon(f.pts, f.half)))
    }
  }
  return out
}

/** MO20: a firework: fine trails bursting from a bright core and drooping as they fall. */
function fireworkBurst(r: Rng): Shape[] {
  const out: Shape[] = []
  const c: Pt = [0.0, -0.14]
  // the droop depends on the distance from the core only, so no two trails ever cross (no ringed metal)
  const at = (a: number, d: number): Pt => [c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d + 0.55 * Math.max(0, d - 0.15) ** 2]
  out.push(cut(circle(c[0], c[1], 0.03)))
  const n = 96
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + r.range(-0.012, 0.012)
    const down = Math.max(0, Math.sin(a))
    const d0 = i % 3 === 0 ? 0.04 : r.range(0.12, 0.3)
    const d1 = Math.min(0.86, r.range(0.42, 0.66) * (1 + 0.28 * down))
    const pts: Pt[] = []
    for (let k = 0; k <= 16; k++) pts.push(at(a, d0 + ((d1 - d0) * k) / 16))
    if (pts.some((p) => Math.hypot(p[0], p[1]) > 0.84)) continue
    // thin at the core, thickest at the tip: the metal between two trails only ever widens outwards
    out.push(cut(ribbon(pts, (t) => 0.0025 + 0.0065 * t)))
  }
  return out
}

/** One branch and its children, as metal ribbons. */
function grow(out: Shape[], r: Rng, p: Pt, a: number, L: number, w: number, depth: number) {
  const bend = r.range(-0.25, 0.25)
  const end = polar(L, a, p)
  const mid = polar(L * 0.5, a + bend, p)
  const pts = quad(p, mid, end, 10)
  const w1 = Math.max(0.009, w * 0.74)
  out.push(metal(ribbon(pts, (t) => (w + (w1 - w) * t) / 2)))
  if (depth <= 0 || w1 < 0.0095) return
  const kids = r() < 0.45 ? 3 : 2
  for (let k = 0; k < kids; k++) {
    const spread = r.range(0.16, 0.48) * (k % 2 ? 1 : -1)
    grow(out, r, end, a + spread + r.range(-0.1, 0.1), L * r.range(0.62, 0.82), w1 * r.range(0.72, 0.92), depth - 1)
  }
  // a side twig part way along
  if (r() < 0.5) grow(out, r, pts[5], a + r.range(-1, 1), L * 0.5, w1 * 0.7, depth - 2)
}

/** MO21: bare branches: an open field crossed by trunks and twigs, tied to the rim. */
function bareBranches(r: Rng): Shape[] {
  const out: Shape[] = [open()]
  const trunks: Array<[number, number, number, number]> = [
    [-0.5, 0.075, -1.62, 0.5], [-0.12, 0.09, -1.52, 0.56], [0.3, 0.075, -1.68, 0.5], [0.66, 0.06, -1.9, 0.42],
    [-0.85, 0.055, -1.25, 0.4], [0.08, 0.05, -1.45, 0.34], [-0.3, 0.05, -1.7, 0.3],
  ]
  for (const [x, w, a, L] of trunks) grow(out, r, [x, 1.05], a, L, w, 8)
  // limbs reaching in from the sides
  grow(out, r, [-1.05, -0.3], -0.35, 0.36, 0.04, 5)
  grow(out, r, [1.05, -0.45], Math.PI + 0.3, 0.34, 0.04, 5)
  grow(out, r, [0.2, -1.05], 1.9, 0.3, 0.035, 4)
  return out
}

/** One frond: a curved rachis with long leaflets hanging from both sides. */
function frond(out: Shape[], r: Rng, room: Room, a: Pt, c: Pt, b: Pt, len0: number) {
  const axis = quad(a, c, b, 120)
  let walked = 0.04
  for (let i = 1; i < axis.length; i++) {
    walked += dist(axis[i - 1], axis[i])
    if (walked < 0.13) continue
    walked = 0
    const p = axis[i], q = axis[Math.min(axis.length - 1, i + 1)], o = axis[i - 1]
    const t = i / axis.length
    const tang = Math.atan2(q[1] - o[1], q[0] - o[0])
    const L = len0 * (1 - 0.45 * t) * r.range(0.88, 1.08)
    for (const side of [-1, 1]) {
      // leaflets leave the rachis at an angle, then hang
      const out0 = tang + side * 0.56
      const ang = Math.atan2(Math.sin(out0) + 0.25, Math.cos(out0))
      const base = polar(0.018, tang + (side * Math.PI) / 2, p)
      const tip = polar(L, ang, base)
      const wd = r.range(0.046, 0.054) * (1 - 0.3 * t)
      const axis = Array.from({ length: 9 }, (_, k) => lerp(base, tip, k / 8))
      if (!room.take(axis.slice(2), wd * 0.42)) continue
      out.push(cut(leaf(base, tip, wd, -side * r.range(0.04, 0.09), 0.3)))
    }
  }
}

/** MO22: fern or willow fronds hanging from the top, long narrow leaflets. */
function fernLeaves(r: Rng): Shape[] {
  const out: Shape[] = []
  const fronds: Array<[Pt, Pt, Pt, number]> = [
    [[-0.16, -0.72], [-0.56, -0.74], [-0.72, 0.1], 0.38],
    [[-0.04, -0.74], [-0.26, -0.5], [-0.38, 0.36], 0.42],
    [[0.08, -0.74], [0.12, -0.4], [0.06, 0.42], 0.42],
    [[0.2, -0.74], [0.42, -0.5], [0.48, 0.34], 0.42],
    [[0.3, -0.7], [0.66, -0.66], [0.76, 0.06], 0.36],
  ]
  const room = new Room(0.008)
  for (const [a, c, b, L] of fronds) frond(out, r, room, a, c, b, L)
  return out
}

/** MO23: a dense breakup of small leafy shards, each clear of the next by a metal web. */
function foliageBreakup(r: Rng): Shape[] {
  const out: Shape[] = []
  const field = 0.82
  const sites = jittered(r, 0.056, 0.42, 1.05)
  const polys = cells(sites, 0.013, 1.1, 0.18)
  polys.forEach((cell, i) => {
    const c = sites[i]
    if (cell.length < 3) return
    // a third of the cells stay metal, more where the noise says the leaves are thick
    if (r() < 0.12 + 0.3 * noise2(c[0] * 3.5 + 1, c[1] * 3.5 + 6, 9)) return
    // ragged: pull each corner in a little, sometimes a lot
    const ragged = cell.map((p) => lerp(p, c, r() < 0.2 ? r.range(0.2, 0.42) : r.range(0, 0.08)))
    if (!clearOfEdge(ragged, field, 0.012)) return
    out.push(cut(poly(ragged)))
  })
  return out
}

/** A crescent band: outer circle (c, R) minus inner circle (ci, ri), sampled between angles a0..a1 round c. */
function band(c: Pt, R: number, ci: Pt, ri: number, a0: number, a1: number, grow = 0): string {
  const n = Math.max(8, Math.round(Math.abs(a1 - a0) * 40))
  const outer: Pt[] = [], inner: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    outer.push(polar(R + grow, a, c))
    inner.push(polar(ri - grow, a, ci))
  }
  return poly([...outer, ...inner.reverse()])
}

/** MO24: three crescent rings woven over and under; the gaps where one passes under tie the metal together. */
function rings(): Shape[] {
  type Ring = { c: Pt; R: number; ci: Pt; ri: number }
  const rs: Ring[] = [
    { c: [-0.12, -0.1], R: 0.56, ci: [-0.1, -0.11], ri: 0.48 },
    { c: [0.24, 0.0], R: 0.31, ci: [0.25, 0.02], ri: 0.23 },
    { c: [0.16, 0.4], R: 0.29, ci: [0.14, 0.39], ri: 0.21 },
  ]
  const out: Shape[] = rs.map((g) => cut(band(g.c, g.R, g.ci, g.ri, 0, TAU)))
  // crossings of the band centre lines, alternating over and under round each pair
  const mid = (g: Ring) => ({ c: lerp(g.c, g.ci, 0.5), r: (g.R + g.ri) / 2 })
  const gap = 0.03
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const A = mid(rs[i]), B = mid(rs[j])
      const d = dist(A.c, B.c)
      if (d > A.r + B.r || d < Math.abs(A.r - B.r)) continue
      const x = (d * d + A.r * A.r - B.r * B.r) / (2 * d)
      const h = Math.sqrt(Math.max(0, A.r * A.r - x * x))
      const u: Pt = [(B.c[0] - A.c[0]) / d, (B.c[1] - A.c[1]) / d]
      const m: Pt = [A.c[0] + u[0] * x, A.c[1] + u[1] * x]
      const hits: Pt[] = [[m[0] - u[1] * h, m[1] + u[0] * h], [m[0] + u[1] * h, m[1] - u[0] * h]]
      // the angle between the two circles where they cross: a shallow crossing needs a longer gap
      const cosT = (d * d - A.r * A.r - B.r * B.r) / (2 * A.r * B.r)
      const sinT = Math.max(0.25, Math.sqrt(Math.max(0, 1 - cosT * cosT)))
      hits.forEach((p, k) => {
        const over = rs[k === 0 ? i : j]
        const a = Math.atan2(p[1] - over.c[1], p[0] - over.c[0])
        const span = (0.06 + gap) / sinT / over.R
        out.push(metal(band(over.c, over.R, over.ci, over.ri, a - span, a + span, gap)))
        out.push(cut(band(over.c, over.R, over.ci, over.ri, a - span * 1.05, a + span * 1.05)))
      })
    }
  }
  return out
}

const S1 = 'amaran-as-gb-m-set1.png', S2 = 'amaran-as-gb-m-set2.png'

/** The 17 replicas that are not windows (the three window replicas, MO09 to MO11, are presets in windows.ts). */
export const REPLICAS: PlateDef[] = [
  { id: 'plate-sunburst', name: 'sunburst', category: 'beams', description: 'thin rays round an empty centre, long and short in turn', source: `${S1}, MO05; also set-a-six-plates.png, sunburst and set-b-17-paper-plates.png, Radiant light (80)`, seed: 5, draw: sunburst },
  { id: 'plate-louvre', name: 'louvre', category: 'windows', description: 'wide horizontal slats in a round field', source: `${S1}, MO06`, field: 0.74, draw: louvre },
  { id: 'plate-rain-lines', name: 'rain lines', category: 'sky', description: 'thin vertical streaks of many lengths', source: `${S1}, MO07`, seed: 7, draw: rainLines },
  { id: 'plate-fan-rays', name: 'fan rays', category: 'beams', description: 'wedge rays fanning up from below', source: `${S1}, MO08`, field: 0.82, draw: fanRays },
  { id: 'plate-crossed-lines', name: 'crossed lines', category: 'patterns', description: 'an open field crossed by thin wires', source: `${S1}, MO12`, field: 0.78, seed: 12, draw: crossedLines },
  { id: 'plate-scattered-sticks', name: 'scattered sticks', category: 'nature', description: 'short sticks scattered every way, some forked', source: `${S1}, MO13; also set-a-six-plates.png, scattered sticks`, seed: 13, draw: scatteredSticks },
  { id: 'plate-pixel-cloud', name: 'pixel cloud', category: 'patterns', description: 'a cloud of square pixels', source: `${S1}, MO14`, seed: 14, draw: pixelCloud },
  { id: 'plate-water-ripples', name: 'water ripples', category: 'nature', description: 'rows of thin wavy slivers, like light off water', source: `${S2}, MO15`, field: 0.8, seed: 15, draw: waterRipples },
  { id: 'plate-snowflakes', name: 'snowflakes', category: 'sky', description: 'ten crisp snowflakes of three sizes', source: `${S2}, MO16`, draw: snowflakes },
  { id: 'plate-lightning', name: 'lightning', category: 'sky', description: 'two forked lightning bolts', source: `${S2}, MO17`, seed: 17, draw: lightning },
  { id: 'plate-starfield', name: 'starfield', category: 'sky', description: 'stars in loose clusters, sparkles and two little nebulae', source: `${S2}, MO18`, seed: 18, draw: starfield },
  { id: 'plate-flames', name: 'flames', category: 'nature', description: 'licking flame tongues over a big fire', source: `${S2}, MO19`, seed: 19, draw: flames },
  { id: 'plate-firework-burst', name: 'firework burst', category: 'sky', description: 'fine trails bursting from a point and drooping', source: `${S2}, MO20`, seed: 20, draw: fireworkBurst },
  { id: 'plate-bare-branches', name: 'bare branches', category: 'nature', description: 'trunks and twigs of a bare tree against the light', source: `${S2}, MO21`, field: 0.82, seed: 21, draw: bareBranches },
  { id: 'plate-fern-leaves', name: 'fern leaves', category: 'nature', description: 'fronds of long narrow leaflets hanging from the top', source: `${S2}, MO22`, seed: 22, draw: fernLeaves },
  { id: 'plate-foliage-breakup', name: 'foliage breakup', category: 'nature', description: 'a dense breakup of small leafy shards', source: `${S2}, MO23`, seed: 23, draw: foliageBreakup },
  { id: 'plate-rings', name: 'rings', category: 'patterns', description: 'three crescent rings woven over and under', source: `${S2}, MO24`, draw: rings },
]
