/**
 * Plates from the reference photos set-a-six-plates.png, set-2-closeup.png and set-3-closeup.png (design/refs/gobo-plates).
 * Plate space: the unit circle, y down (see geom.ts). In set A the white shapes are the cut-outs; in sets 2 and 3 the
 * dark shapes are. Either way `cut` is where light passes.
 */
import {
  circle, cut, cutLine, dist, jag, leaf, line, lerp, metal, metalLine, noise2, poly, polar, quad, ribbon,
  Room, scatter, turn, type Pt, type Rng, type Shape,
} from './geom'
import { asterisk, heart, inPoly, isoFill, resample, runs, star, starPts, Strokes, tongue } from './refsA23Geom'
import type { PlateDef } from './types'

const TAU = Math.PI * 2
const SA = 'set-a-six-plates.png', S2 = 'set-2-closeup.png', S3 = 'set-3-closeup.png'

// ── set A (white is cut) ─────────────────────────────────────────────────────

/** A crescent moon opening up and right, and small stars round it. */
function moonAndStars(r: Rng): Shape[] {
  const out: Shape[] = [cut(circle(0.1, -0.04, 0.37)), metal(circle(0.25, -0.15, 0.32))]
  const stars: Array<[number, number, number, number]> = [
    // x, y, size, points
    [-0.41, -0.41, 0.055, 5], [-0.21, -0.5, 0.06, 5], [0.38, -0.5, 0.055, 5], [-0.3, -0.24, 0.05, 5], [0.33, -0.3, 0.055, 5],
    [0.27, -0.06, 0.055, 5], [0.47, -0.11, 0.05, 5], [0.37, 0.08, 0.055, 5], [-0.48, 0.07, 0.055, 5], [0.7, 0.07, 0.055, 5],
    [-0.22, 0.33, 0.055, 5], [-0.38, 0.47, 0.06, 6], [-0.13, 0.51, 0.085, 6], [0.1, 0.5, 0.055, 6], [0.52, 0.44, 0.055, 5],
    [-0.01, 0.7, 0.055, 5],
  ]
  for (const [x, y, s, n] of stars) out.push(cut(star([x, y], n, s, s * (n === 5 ? 0.45 : 0.5), -Math.PI / 2 + r.range(-0.3, 0.3))))
  return out
}

/**
 * A wide fire of slender wavy tongues in three peaks, the tallest just right of the middle. Tongues vary in width and
 * height, and some split near the top into two tips. Every tongue keeps clear of the others (Room).
 */
function bonfire(r: Rng): Shape[] {
  const out: Shape[] = []
  const room = new Room(0.014)
  const g = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2))
  const top = (x: number) => -0.14 - 0.6 * g(x, 0.12, 0.17) - 0.34 * g(x, -0.38, 0.13) - 0.3 * g(x, 0.5, 0.1) - 0.12 * g(x, -0.12, 0.08)
  const bottom = (x: number) => 0.56 - 0.22 * (x / 0.62) ** 4
  for (let i = 0; i < 8000 && out.length < 110; i++) {
    const x = r.range(-0.62, 0.62)
    const yb = r.range(top(x) + 0.14, bottom(x))
    const L = Math.min(yb - top(x) - 0.01, r.range(0.12, 0.52))
    if (L < 0.1) continue
    const lean = r.range(-0.15, 0.15) + x * 0.2
    const base: Pt = [x, yb], tip: Pt = [x + lean * L, yb - L]
    const w = (r() < 0.3 ? r.range(0.065, 0.09) : r.range(0.025, 0.055)) * Math.min(1, L / 0.3 + 0.35)
    const pts: Pt[] = Array.from({ length: 13 }, (_, k) => lerp(base, tip, k / 12))
    const half = (t: number) => w * 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.2 + 0.05))
    // a wide tall tongue may split into two tips: the second branches off its upper half
    const split = w > 0.05 && L > 0.25 && r() < 0.6
    const fork = lerp(base, tip, 0.5)
    const side = r() < 0.5 ? -1 : 1
    const tip2: Pt = [fork[0] + side * L * r.range(0.18, 0.28), fork[1] - L * r.range(0.3, 0.42)]
    const pts2: Pt[] = split ? Array.from({ length: 7 }, (_, k) => lerp(fork, tip2, k / 6)).slice(2) : []
    if (!room.fits([...pts, ...pts2], half)) continue
    room.add(pts, half)
    out.push(cut(tongue(base, tip, w, r.range(0.05, 0.12), r.range(0, TAU), r.range(0.25, 0.45))))
    if (split) {
      room.add(pts2, w * 0.25)
      out.push(cut(tongue(lerp(base, tip, 0.35), tip2, w * 0.6, r.range(0.04, 0.08), r.range(0, TAU), 0.35)))
    }
  }
  return out
}

/** Asterisk stars with eight rounded arms, of mixed sizes, in a loose cluster. */
function eightPointStars(r: Rng): Shape[] {
  const out: Shape[] = []
  const pts = scatter(r, 22, () => 0.215, (p) => Math.hypot(p[0] + 0.02, (p[1] - 0.03) * 1.05) < 0.62, 0.7)
  for (const c of pts) {
    const big = Math.hypot(c[0] + 0.05, c[1] - 0.05) < 0.25 ? 1.25 : 1
    const R = r.range(0.08, 0.1) * big
    const n = r() < 0.75 ? 8 : 7
    const jit = Array.from({ length: n }, () => r.range(-0.2, 0.1))
    out.push(cutLine(asterisk(c, n, R, r.range(0, TAU), jit), R * 0.42, 'round'))
  }
  return out
}

/** Big ragged splotches joined by narrow necks, eaten into by smaller holes. */
function leafBreakup(r: Rng): Shape[] {
  const ox = r.range(0, 50), oy = r.range(0, 50)
  const f = (p: Pt) => {
    const w: Pt = [p[0] + 0.12 * (noise2(p[0] * 3 + ox, p[1] * 3 + oy, 2) - 0.5), p[1] + 0.12 * (noise2(p[0] * 3 + oy, p[1] * 3 + ox, 3) - 0.5)]
    const n = noise2(w[0] * 12 + ox, w[1] * 12 + oy, 4) * 0.55 + noise2(w[0] * 26 + ox, w[1] * 26, 5) * 0.3 + noise2(w[0] * 50, w[1] * 50 + oy, 6) * 0.15
    const env = Math.hypot(p[0] * 1.05, p[1] + 0.02) / 0.72
    return n - 0.5 - 0.35 * Math.max(0, env - 0.75) * 4
  }
  return isoFill(f, 0.85, 0.008).map((d) => cut(d))
}

// ── set 2 (dark is cut) ──────────────────────────────────────────────────────

/**
 * Lobed amoeba and worm shapes packed in a disc with even gaps, as in the plate: each is a chain of two to five
 * overlapping round lobes on a wandering path, some budding off sideways. Room keeps every pair apart.
 */
function breakup(r: Rng): Shape[] {
  const out: Shape[] = []
  const room = new Room(0.017)
  const centres = scatter(r, 2000, () => 0.04, (p) => Math.hypot(p[0], p[1]) < 0.75, 0.78, 40)
  let made = 0
  for (const c of centres) {
    if (made >= 140) break
    // a chain of two to five overlapping round lobes on a wandering path: amoebas, beans and short worms
    const nl = r.int(3, 5)
    const lobes: Array<[Pt, number]> = []
    let p: Pt = c, ak = r.range(0, TAU)
    // grow the chain lobe by lobe while each new lobe keeps clear of the blobs already placed
    for (let k = 0; k < nl; k++) {
      const rad = r.range(0.017, 0.027)
      if (Math.hypot(p[0], p[1]) > 0.75 || !room.fits([p], rad)) break
      lobes.push([p, rad])
      ak += r.range(-1.4, 1.4)
      // now and then a lobe buds off an earlier one: a branched amoeba
      const from = k > 0 && r() < 0.3 ? lobes[r.int(0, k)][0] : p
      p = polar(r.range(0.02, 0.03), ak, from)
    }
    // a lone lobe would read as a dot: keep only chains of two or more
    if (lobes.length < 2) continue
    for (const [q, rad] of lobes) room.add([q], rad)
    const shape = cut(lobes.map(([q, rad]) => circle(q[0], q[1], rad)).join(''))
    out.push(shape)
    made++
  }
  return out
}

/**
 * Grows one jagged branch of a crack or a tree into `out`, placed through `S` so it never crosses or touches another
 * branch (see Strokes): it may only meet its parent at its root. Side branches split off along it, at least 0.1 apart.
 * Returns the placed stroke, or null when it had no room.
 */
function growCrack(r: Rng, out: Shape[], S: Strokes, from: Pt, ang: number, len: number, w0: number, depth: number, minW: number,
  parent = -1, rootZone = 0, covered?: (p: Pt) => boolean) {
  const pts = resample(jag(from, polar(len, ang, from), r, 4, 0.12, 0.6), 0.01)
  const w1 = Math.max(minW, w0 * 0.35)
  const hs = pts.map((_, i) => (w0 + (w1 - w0) * (i / (pts.length - 1))) / 2)
  const got = S.add(pts, hs, parent, rootZone, 0.04, covered)
  if (!got) return null
  const n = got.pts.length
  // draw through every fourth sample: offsetting a fine resample of a jagged line folds the outline at sharp corners
  const idx = got.pts.map((_, i) => i).filter((i) => i % 4 === 0 || i === n - 1)
  out.push(cut(ribbon(idx.map((i) => got.pts[i]), (t) => got.hs[idx[Math.round(t * (idx.length - 1))]])))
  if (depth > 0) branchOut(r, out, S, got, ang, len, depth, minW)
  return got
}

/** Side branches off a placed stroke, at least 0.1 apart along it, each grown with growCrack. */
function branchOut(r: Rng, out: Shape[], S: Strokes, got: { id: number; pts: Pt[]; hs: number[] }, ang: number, len: number, depth: number, minW: number, from = 0.3) {
  const n = got.pts.length
  if (n < 12) return
  // a twig that finds no room is dropped and another spot tried, up to four tries per twig
  const kids = depth > 1 ? r.int(2, 3) : r.int(2, 3)
  const ts: number[] = []
  for (let k = 0; k < kids * 4 && ts.length < kids; k++) {
    const t = r.range(from, 0.88)
    if (!ts.every((u) => Math.abs(u - t) * n * 0.01 > 0.1)) continue
    const i = Math.round(t * (n - 1))
    const side = r() < 0.5 ? -1 : 1
    const cw = Math.max(minW, got.hs[i] * 2 * 0.7)
    const ca = ang + side * r.range(0.4, 0.85)
    if (growCrack(r, out, S, got.pts[i], ca, len * r.range(0.3, 0.55), cw, depth - 1, minW, got.id, zoneFor(got.pts, i, ca, got.hs[i] + cw / 2 + S.web))) ts.push(t)
  }
}

/**
 * How far from its root a branch leaving `pts[i]` at angle `a` stays allowed to touch its parent: until it has moved
 * `need` away sideways, which takes longer the closer it runs along the parent.
 */
function zoneFor(pts: Pt[], i: number, a: number, need: number): number {
  const p = pts[Math.max(0, i - 2)], q = pts[Math.min(pts.length - 1, i + 2)]
  const pa = Math.atan2(q[1] - p[1], q[0] - p[0])
  return need / Math.max(0.3, Math.abs(Math.sin(a - pa))) + 0.015
}

/**
 * Many thin jagged cracks radiating every way from an elongated, jagged dense core, each forking two or three times,
 * with loose short slivers near the rim. The cracks join only in the core (a union of cuts); outside it they never
 * cross or touch (Strokes), so the cut region is a tree round the core and encloses no metal.
 */
function crackedBranches(r: Rng): Shape[] {
  const out: Shape[] = []
  const S = new Strokes(0.014)
  // the core: a jagged lens from lower left to upper right of the centre
  const ca: Pt = [-0.12, 0.07], cb: Pt = [0.28, -0.19]
  const axis = Math.atan2(cb[1] - ca[1], cb[0] - ca[0])
  const side = (sgn: number) => (p: Pt, i: number, a: Pt[]) => {
    const o = turn([0, sgn * (0.075 * Math.sin((Math.PI * i) / (a.length - 1)) + 0.01)], axis)
    return [p[0] + o[0], p[1] + o[1]] as Pt
  }
  const core = [...jag(ca, cb, r, 4, 0.1, 0.75).map(side(-1)), ...jag(cb, ca, r, 4, 0.1, 0.75).map(side(1))]
  out.push(cut(poly(core)))
  const inCore = (p: Pt) => inPoly(p, core)
  // every main crack first, then their forks: the cracks leave the core all round its rim, evenly spaced
  const rim = resample([...core, core[0]], 0.005)
  const mains: Array<[NonNullable<ReturnType<typeof growCrack>>, number, number]> = []
  const n = 26
  const ctr = lerp(ca, cb, 0.5)
  for (let i = 0; i < n; i++) {
    const k = Math.floor(((i + r.range(-0.2, 0.2)) / n) * (rim.length - 1) + rim.length) % rim.length
    const p = rim[k]
    // outward: away from the axis, bent towards the ends near them
    const q = rim[(k + 6) % rim.length], o = rim[(k - 6 + rim.length) % rim.length]
    let nx = q[1] - o[1], ny = -(q[0] - o[0])
    if (nx * (p[0] - ctr[0]) + ny * (p[1] - ctr[1]) < 0) { nx = -nx; ny = -ny }
    const nl = Math.hypot(nx, ny) || 1, dl = dist(p, ctr) || 1
    const a = Math.atan2(ny / nl + (p[1] - ctr[1]) / dl, nx / nl + (p[0] - ctr[0]) / dl) + r.range(-0.15, 0.15)
    const from = lerp(p, ctr, 0.15)
    const got = growCrack(r, out, S, from, a, r.range(0.4, 0.62), r.range(0.024, 0.032), 0, 0.012, -1, 0, inCore)
    if (got) mains.push([got, a, 0.5])
  }
  for (const [got, a, len] of mains) branchOut(r, out, S, got, a, len, 2, 0.012)
  // loose slivers near the rim, clear of every crack
  for (let i = 0; i < 70; i++) {
    const a0 = r.range(0, TAU)
    const p = polar(r.range(0.6, 0.78), a0)
    const a = a0 + r.range(-0.6, 0.6)
    const L = r.range(0.025, 0.05)
    const pts = resample(jag(turn([-L, 0], a, p), turn([L, 0], a, p), r, 2, 0.15), 0.01)
    const got = S.add(pts, pts.map(() => 0.007), -1, 0, 0.03)
    if (got) out.push(cutLine(line(got.pts), 0.014, 'round'))
  }
  return out
}

/** Five U-shaped arch bands nested like a rainbow, legs running down to the field edge. */
function rainbowArch(): Shape[] {
  const out: Shape[] = []
  const c: Pt = [0, 0.3]
  const b = 0.07, g = 0.065, r0 = 0.11, edge = 0.82
  const bottomY = (x: number) => Math.sqrt(Math.max(0, edge * edge - x * x))
  for (let k = 0; k < 5; k++) {
    const ri = r0 + k * (b + g), ro = ri + b
    const pts: Pt[] = []
    // outer edge: left leg up, over the top, right leg down
    pts.push([-ro, bottomY(ro)])
    for (let i = 0; i <= 48; i++) pts.push(polar(ro, Math.PI + (i / 48) * Math.PI, c))
    pts.push([ro, bottomY(ro)])
    // along the field edge to the inner right leg
    for (let i = 1; i < 6; i++) {
      const x = ro + ((ri - ro) * i) / 6
      pts.push([x, bottomY(x)])
    }
    pts.push([ri, bottomY(ri)])
    for (let i = 48; i >= 0; i--) pts.push(polar(ri, Math.PI + (i / 48) * Math.PI, c))
    pts.push([-ri, bottomY(ri)])
    for (let i = 1; i < 6; i++) {
      const x = -ri + ((ri - ro) * i) / 6
      pts.push([x, bottomY(x)])
    }
    out.push(cut(poly(pts)))
  }
  return out
}

/** Hearts of many sizes in a loose cluster, bigger in the middle. */
function hearts(): Shape[] {
  const out: Shape[] = []
  // x, y, height, tilt: placed as in the plate
  const hs: Array<[number, number, number, number]> = [
    [0.05, -0.66, 0.15, -0.2], [0.5, -0.52, 0.14, 0.25], [-0.46, -0.4, 0.14, -0.25], [-0.17, -0.44, 0.18, 0.1],
    [0.22, -0.4, 0.23, 0.15], [0.6, -0.22, 0.14, 0.3], [-0.68, -0.08, 0.13, -0.1], [-0.36, -0.1, 0.3, -0.15],
    [0.03, -0.16, 0.18, 0.2], [0.35, -0.08, 0.27, -0.1], [-0.12, 0.13, 0.22, 0.1], [0.14, 0.14, 0.18, -0.2],
    [0.5, 0.24, 0.24, 0.2], [-0.55, 0.22, 0.17, -0.2], [-0.32, 0.4, 0.17, 0.15], [-0.04, 0.42, 0.18, -0.15],
    [0.26, 0.44, 0.24, 0.1], [0.66, 0.46, 0.11, 0.25], [-0.13, 0.68, 0.24, 0.05], [0.17, 0.7, 0.11, -0.25],
    [0.42, 0.65, 0.1, 0.2], [-0.42, 0.6, 0.1, -0.2], [0.75, 0.1, 0.09, 0.1], [-0.7, 0.35, 0.09, 0.2],
  ]
  for (const [x, y, s, a] of hs) out.push(cut(heart([x * 1.02, y * 1.02 + 0.03], s * 1.22, a)))
  return out
}

/**
 * Wedge rays on a ring round an empty centre, as in the plate: each ray is cut square and widest at its outer end and
 * runs to a point towards the centre. Widths, inner ends and outer ends all vary.
 */
function radialBurst(r: Rng): Shape[] {
  const out: Shape[] = []
  const n = 62
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + r.range(-0.025, 0.025)
    const long = r() < 0.3
    const r0 = long ? r.range(0.14, 0.26) : r.range(0.28, 0.48), r1 = r.range(0.6, 0.78)
    const w = r() < 0.2 ? r.range(0.042, 0.055) : r.range(0.02, 0.04)
    const da = w / 2 / r1
    out.push(cut(poly([polar(r0, a - 0.002, [0, 0]), polar(r1, a - da), polar(r1, a + da), polar(r0, a + 0.002)])))
  }
  return out
}

/**
 * Short curvy vine sprigs with small paired leaves, scattered over the disc. Metal between openings never gets thinner
 * than WEB: a leaf overlaps its own stem at its base (a round fillet fills the narrow wedge there) and keeps WEB clear
 * of the rest of its stem and of every other leaf; whole sprigs keep WEB clear of each other (Room). Samples carry
 * their local half widths, so the gaps hold between samples too.
 */
function vineLeaves(r: Rng): Shape[] {
  const WEB = 0.014
  const out: Shape[] = []
  const room = new Room(WEB)
  const stemW = 0.013
  const centres = scatter(r, 500, () => 0.062, (p) => Math.hypot(p[0], p[1]) < 0.7, 0.75, 30)
  let made = 0
  for (const c of centres) {
    if (made >= 70) break
    const a = r.range(0, TAU)
    const L = r.range(0.17, 0.26)
    const p0 = turn([-L / 2, 0], a, c), p2 = turn([L / 2, 0], a, c)
    const p1 = turn([0, r.range(-0.08, 0.08)], a, c)
    const stem = resample(quad(p0, p1, p2, 14), 0.008)
    const ns = stem.length
    const leaves: Array<{ shapes: Shape[]; pts: Pt[]; hs: number[] }> = []
    for (let k = 1; k < 6; k++) {
      const i = Math.round((k / 6) * (ns - 1))
      const at = stem[i]
      const nx = stem[Math.min(ns - 1, i + 2)], pv = stem[Math.max(0, i - 2)]
      const ta = Math.atan2(nx[1] - pv[1], nx[0] - pv[0])
      const side = k % 2 === 0 ? 1 : -1
      const la = ta + side * r.range(0.7, 0.95)
      const ll = r.range(0.06, 0.08)
      const tip = polar(ll, la, at)
      const W = ll * 0.62
      // samples from where the leaf has left the stem, with conservative half widths
      const ts = [0.35, 0.5, 0.65, 0.8, 0.92, 1]
      const pts = ts.map((t) => lerp(at, tip, t))
      const hs = ts.map((t) => (t <= 0.7 ? W / 2 : t < 0.95 ? W / 3 : 0.004))
      // clear of its own stem away from the base, and of the leaves already on this sprig
      const nearBase = (q: Pt) => dist(q, at) < W / 2 + stemW / 2 + WEB + 0.012
      const okStem = pts.every((q, j) => nearBase(q) || stem.every((sp) => dist(q, sp) >= hs[j] + stemW / 2 + WEB))
      const okLeaves = leaves.every((o) => pts.every((q, j) => o.pts.every((op, m) => dist(q, op) >= hs[j] + o.hs[m] + WEB)))
      if (!okStem || !okLeaves) continue
      const f = polar(0.008, la, at)
      leaves.push({ shapes: [cut(leaf(at, tip, W, side * 0.12, 0.45)), cut(circle(f[0], f[1], 0.016))], pts, hs })
    }
    const all = [...stem, ...leaves.flatMap((l) => l.pts)]
    const half = [...stem.map(() => stemW / 2), ...leaves.flatMap((l) => l.hs)]
    const h = (t: number) => half[Math.round(t * (all.length - 1))]
    if (!room.fits(all, h)) continue
    room.add(all, h)
    out.push(cutLine(line(stem), stemW, 'round'))
    for (const l of leaves) out.push(...l.shapes)
    made++
  }
  return out
}

// ── set 3 (dark is cut) ──────────────────────────────────────────────────────

/** A long cross of two thin lines, with a burst of short spikes where they meet. */
function starburstCross(r: Rng): Shape[] {
  const c: Pt = [0.18, 0.42]
  const bar = (a: Pt, b: Pt) => cutLine(line([a, b]), 0.034, 'round')
  const out: Shape[] = [bar([0.18, -0.8], [0.18, 0.7]), bar([-0.72, 0.42], [0.7, 0.42]), cut(circle(c[0], c[1], 0.09))]
  const n = 11
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + 0.2 + r.range(-0.1, 0.1)
    const L = r() < 0.55 ? r.range(0.28, 0.4) : r.range(0.15, 0.22)
    out.push(cut(ribbon([polar(0.04, a, c), polar(L, a, c)], (t) => 0.034 * (1 - t) + 0.01)))
  }
  return out
}

/** A dense cloud of dots of many sizes, with four-point sparkles and small crosses. */
function stardust(r: Rng): Shape[] {
  const out: Shape[] = []
  const inCloud = (p: Pt) => Math.hypot(p[0] * 1.02, p[1] - 0.02) < 0.72 + 0.06 * (noise2(Math.atan2(p[1], p[0]) * 2 + 9, 1, 3) - 0.5)
  const room = new Room(0.02)
  const sparkles = scatter(r, 22, () => 0.2, inCloud, 0.75)
  for (const c of sparkles) {
    const R = r.range(0.05, 0.08)
    const a = Math.PI / 4 + r.range(-0.3, 0.3)
    const pts: Pt[] = []
    for (let k = 0; k < 8; k++) pts.push(polar(k % 2 === 0 ? R : R * 0.22, a + (k * Math.PI) / 4, c))
    out.push(cut(poly(pts)))
    room.add([c], R * 0.8)
  }
  for (let i = 0; i < 4000 && out.length < 330; i++) {
    const p: Pt = [r.range(-0.75, 0.75), r.range(-0.75, 0.75)]
    if (!inCloud(p)) continue
    if (r() < 0.12) {
      const s = r.range(0.018, 0.026)
      if (!room.take([p], s)) continue
      out.push(cutLine(asterisk(p, 4, s, Math.PI / 4), 0.009, 'round'))
    } else {
      const rad = r() < 0.6 ? r.range(0.01, 0.017) : r.range(0.018, 0.03)
      if (!room.take([p], rad)) continue
      out.push(cut(circle(p[0], p[1], rad)))
    }
  }
  return out
}

/** Five-point stars: about six big, ten medium and the rest small, with two small crescents. */
function stars(r: Rng): Shape[] {
  const out: Shape[] = []
  const room = new Room(0.03)
  // two crescents, as in the plate: bottom middle and top right
  for (const [x, y, s, a] of [[0.03, 0.68, 0.06, 0.6], [0.26, -0.66, 0.045, -0.4]] as const) {
    const pts: Pt[] = []
    for (let i = 0; i <= 20; i++) pts.push(polar(s, a + Math.PI * 0.15 + (i / 20) * Math.PI * 1.1, [x, y]))
    for (let i = 20; i >= 0; i--) pts.push(polar(s * 0.8, a + Math.PI * 0.32 + (i / 20) * Math.PI * 0.8, [x + Math.cos(a) * s * 0.05, y + Math.sin(a) * s * 0.35]))
    out.push(cut(poly(pts)))
    room.add([[x, y]], s)
  }
  const inDisc = (p: Pt) => Math.hypot(p[0], p[1] + 0.02) < 0.7
  const place = (count: number, gap: number, rMin: number, rMax: number, tries = 400) => {
    let k = 0
    for (let i = 0; i < tries && k < count; i++) {
      const c: Pt = [r.range(-0.74, 0.74), r.range(-0.74, 0.74)]
      const R = r.range(rMin, rMax)
      if (!inDisc(c) || Math.hypot(c[0], c[1]) + R * 0.8 > 0.76) continue
      if (!room.take([c], R + gap)) continue
      out.push(cut(star(c, 5, R, R * 0.42, -Math.PI / 2 + r.range(-0.5, 0.5))))
      k++
    }
  }
  place(6, 0.03, 0.14, 0.17, 3000)
  place(10, 0.02, 0.075, 0.09, 3000)
  place(22, 0.0, 0.035, 0.05, 2000)
  return out
}

/** One straight slit across the field, a little above the centre. */
function slit(): Shape[] {
  return [cutLine(line([[-0.8, -0.1], [0.8, -0.1]]), 0.085, 'butt')]
}

/**
 * A tree rising from the lower right, its limbs spreading over the whole disc, many twigs, leaves in pairs and sprays
 * along the twigs and more in the gaps. Branches never cross (Strokes). A leaf may touch its own twig only: it is
 * checked against every other stroke and every leaf, so no leaf bridges two strokes and no metal is rung off.
 */
function treeWithLeaves(r: Rng): Shape[] {
  const out: Shape[] = []
  const S = new Strokes(0.016)
  const trunk = growCrack(r, out, S, [0.5, 0.92], -Math.PI / 2 - 0.08, 1.45, 0.08, 0, 0.016)!
  // limbs off the trunk (fraction along it, angle, length, width), then low and left branches on their own
  const limbs: Array<[number, number, number, number]> = [
    [0.16, -2.7, 0.8, 0.05], [0.3, -2.2, 0.7, 0.046], [0.44, -2.8, 0.85, 0.046], [0.56, -2.3, 0.6, 0.04], [0.7, -2.6, 0.55, 0.036],
    [0.1, -0.5, 0.28, 0.036], [0.26, -0.3, 0.28, 0.032], [0.48, -0.55, 0.26, 0.03], [0.82, -0.9, 0.25, 0.03],
  ]
  const tn = trunk.pts.length
  const placed: Array<[NonNullable<ReturnType<typeof growCrack>>, number, number]> = []
  for (const [t, a, L, w] of limbs) {
    const i = Math.round(t * (tn - 1))
    const got = growCrack(r, out, S, trunk.pts[i], a, L, w, 0, 0.016, trunk.id, zoneFor(trunk.pts, i, a, trunk.hs[i] + w / 2 + S.web))
    if (got) placed.push([got, a, L])
  }
  const free: Array<[Pt, number, number, number]> = [
    [[-0.3, 0.66], -0.15, 0.5, 0.04], [[-0.62, 0.3], -0.9, 0.45, 0.036], [[-0.6, -0.15], -1.0, 0.45, 0.034], [[-0.35, -0.55], -0.4, 0.35, 0.03],
  ]
  for (const [p, a, L, w] of free) {
    const got = growCrack(r, out, S, p, a, L, w, 0, 0.016)
    if (got) placed.push([got, a, L])
  }
  for (const [got, a, L] of placed) branchOut(r, out, S, got, a, L, 3, 0.016)
  branchOut(r, out, S, trunk, -Math.PI / 2, 0.9, 2, 0.016, 0.55)
  // leaves: each leaf may touch only the stroke it grows from; it keeps `web` clear of every other stroke and leaf
  const web = S.web
  const leaves: Array<{ p: Pt; h: number }> = []
  const clear = (pts: Pt[], h: number, own: number) =>
    pts.every((p) => S.items.every((it, j) => j === own || it.pts.every((q, k) => dist(p, q) >= h + it.hs[k] + web)) && leaves.every((l) => dist(p, l.p) >= h + l.h + web))
  const addLeaf = (base: Pt, a: number, L: number, own: number) => {
    const tip = polar(L, a, base)
    const check: Pt[] = [lerp(base, tip, 0.45), lerp(base, tip, 0.75), tip]
    const h = L * 0.26
    if (Math.hypot(tip[0], tip[1]) > 0.8 || !clear(check, h, own)) return false
    out.push(cut(leaf(base, tip, L * 0.6, r.range(-0.1, 0.1), 0.45)))
    for (const p of check) leaves.push({ p, h })
    return true
  }
  S.items.forEach((it, id) => {
    if (it.hs[0] > 0.03) return // leaves grow on twigs, not on the trunk and the big limbs
    const n = it.pts.length
    for (let i = 3; i < n; i += 4) {
      const p = it.pts[i], q = it.pts[Math.max(0, i - 2)]
      const a = Math.atan2(p[1] - q[1], p[0] - q[0])
      const L = r.range(0.05, 0.066)
      // a pair, one each side, angled forward; a spray of three at the tip
      addLeaf(p, a + r.range(0.6, 0.9), L, id)
      addLeaf(p, a - r.range(0.6, 0.9), L, id)
      if (i + 4 >= n) addLeaf(it.pts[n - 1], a + r.range(-0.15, 0.15), L, id)
    }
  })
  // loose leaves in what gaps are left, touching nothing
  const centres = scatter(r, 1500, () => 0.04, (p) => Math.hypot(p[0], p[1]) < 0.76, 0.8, 20)
  for (const c of centres) {
    const a = r.range(0, TAU)
    const L = r.range(0.045, 0.06)
    const base = polar(-L / 2, a, c)
    addLeaf(base, a, L, -2)
  }
  return out
}

/**
 * A disc split into seven sectors by smooth curved metal bands that spiral from a small centre to the rim, all curving
 * the same way. Each sector holds straight parallel slots that run along its leading band and end against the other
 * band; slots, bands and the metal between slots share one width. Reads as a ball of yarn.
 */
function swirl(): Shape[] {
  const out: Shape[] = []
  const R = 0.8, n = 7, curl = 1.1, band = 0.05, slot = 0.088, pitch = slot + band
  const bandAt = (k: number, rr: number) => polar(rr, (k / n) * TAU + curl * rr)
  const phi = (p: Pt) => Math.atan2(p[1], p[0]) - curl * Math.hypot(p[0], p[1])
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * TAU
    const inSector = (p: Pt) => {
      if (Math.hypot(p[0], p[1]) > R + 0.03) return false
      const d = (((phi(p) - a0) % TAU) + TAU) % TAU
      return d < TAU / n
    }
    // the leading band: its chord from near the centre to the rim sets the slots' direction
    const p0 = bandAt(k + 1, 0.12), p1 = bandAt(k + 1, R)
    const u: Pt = [(p1[0] - p0[0]) / dist(p0, p1), (p1[1] - p0[1]) / dist(p0, p1)]
    let nrm: Pt = [-u[1], u[0]]
    // point the normal into the sector
    const m = bandAt(k + 0.5, 0.5)
    if ((m[0] - p0[0]) * nrm[0] + (m[1] - p0[1]) * nrm[1] < 0) nrm = [-nrm[0], -nrm[1]]
    for (let j = 0; j < 9; j++) {
      const o = band / 2 + slot / 2 + j * pitch
      const c: Pt = [p0[0] + nrm[0] * o, p0[1] + nrm[1] * o]
      const a: Pt = [c[0] - u[0] * 2, c[1] - u[1] * 2], b: Pt = [c[0] + u[0] * 2, c[1] + u[1] * 2]
      for (const [s0, e0] of runs(a, b, inSector, 0.004)) {
        if (dist(s0, e0) < 0.05) continue
        out.push(cutLine(line([s0, e0]), slot, 'butt'))
      }
    }
  }
  // the bands, the hub and the rim close the slots off
  for (let k = 0; k < n; k++) out.push(metalLine(line(Array.from({ length: 49 }, (_, i) => bandAt(k, (i / 48) * (R + 0.04)))), band, 'round'))
  out.push(metal(circle(0, 0, 0.06)))
  out.push(metal(circle(0, 0, 1.5) + circle(0, 0, R), 'evenodd'))
  return out
}

export const REFS_A23: PlateDef[] = [
  { id: 'plate-moon-and-stars', name: 'moon and stars', category: 'sky', description: 'a crescent moon among small stars', source: `${SA}, moon and stars`, seed: 31, draw: moonAndStars },
  { id: 'plate-bonfire', name: 'bonfire', category: 'nature', description: 'a wide fire of slender wavy flame tongues', source: `${SA}, flames`, seed: 32, draw: bonfire },
  { id: 'plate-eight-point-stars', name: 'eight point stars', category: 'sky', description: 'a cluster of eight armed asterisk stars', source: `${SA}, 8-point stars`, seed: 33, draw: eightPointStars },
  { id: 'plate-leaf-breakup', name: 'leaf breakup', category: 'nature', description: 'big ragged patches of light, like sun through a canopy', source: `${SA}, foliage breakup`, seed: 34, draw: leafBreakup },
  { id: 'plate-breakup', name: 'breakup', category: 'nature', description: 'small irregular blobs packed in a disc', source: `${S2}, breakup blobs`, seed: 35, draw: breakup },
  { id: 'plate-cracked-branches', name: 'cracked branches', category: 'nature', description: 'jagged cracks branching out from a dense centre', source: `${S2}, cracked branches`, seed: 36, draw: crackedBranches },
  { id: 'plate-rainbow-arch', name: 'rainbow arch', category: 'patterns', description: 'five nested arch bands like a rainbow', source: `${S2}, rainbow arch`, draw: rainbowArch },
  { id: 'plate-hearts', name: 'hearts', category: 'patterns', description: 'a cluster of hearts of many sizes', source: `${S2}, hearts`, draw: hearts },
  { id: 'plate-radial-burst', name: 'radial burst', category: 'beams', description: 'tapered wedge rays on a ring round a dark centre', source: `${S2}, radial burst`, seed: 39, draw: radialBurst },
  { id: 'plate-vine-leaves', name: 'vine leaves', category: 'nature', description: 'short vine sprigs with small paired leaves', source: `${S2}, vine leaves`, seed: 40, draw: vineLeaves },
  { id: 'plate-starburst-cross', name: 'starburst cross', category: 'beams', description: 'a long thin cross with a burst of spikes where the lines meet', source: `${S3}, starburst cross`, seed: 41, field: 0.86, draw: starburstCross },
  { id: 'plate-stardust', name: 'stardust', category: 'sky', description: 'a dense cloud of dots and four point sparkles', source: `${S3}, star and dot field`, seed: 42, draw: stardust },
  { id: 'plate-stars', name: 'stars', category: 'sky', description: 'five point stars of many sizes and two small crescents', source: `${S3}, stars`, seed: 43, draw: stars },
  { id: 'plate-slit', name: 'slit', category: 'beams', description: 'one straight slit of light across the field', source: `${S3}, single line slit; also set-b-17-paper-plates.png, Gap (2)`, draw: slit },
  { id: 'plate-tree-with-leaves', name: 'tree with leaves', category: 'nature', description: 'a branching tree with small oval leaves all round', source: `${S3}, tree with leaves`, seed: 45, draw: treeWithLeaves },
  { id: 'plate-swirl', name: 'swirl', category: 'patterns', description: 'a pinwheel of striped sectors, like a ball of yarn', source: `${S3}, swirl blades`, draw: swirl },
]

void starPts
