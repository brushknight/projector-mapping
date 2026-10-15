/**
 * Plates from the reference photo set-b-17-paper-plates.png (design/refs/gobo-plates), except its windows (windows.ts).
 * In that photo the black shapes are the cut-outs. Plate space: the unit circle, y down (see geom.ts).
 */
import { circle, cut, cutLine, dist, line, metalLine, polar, rect, ribbon, Room, turn, type Pt, type Rng, type Shape } from './geom'
import type { PlateDef } from './types'

const TAU = Math.PI * 2
const SRC = 'set-b-17-paper-plates.png'

/** Bubble (11): a disc packed with round bubbles of many sizes, a few big ones with small ones stuck to them. */
function bubbles(r: Rng): Shape[] {
  const R = 0.68, web = 0.011
  const placed: Array<{ c: Pt; r: number }> = []
  const clear = (c: Pt, rr: number) => Math.hypot(c[0], c[1]) + rr < R && placed.every((b) => dist(b.c, c) >= b.r + rr + web)
  const tier = (lo: number, hi: number, n: number) => {
    let got = 0
    for (let k = 0; k < n * 80 && got < n; k++) {
      const rr = r.range(lo, hi)
      const c: Pt = [r.range(-R, R), r.range(-R, R)]
      if (clear(c, rr)) {
        placed.push({ c, r: rr })
        got++
      }
    }
  }
  tier(0.07, 0.1, 4)
  tier(0.04, 0.058, 12)
  // small bubbles stuck to the big ones, merging into one opening
  for (let i = 0, n = placed.length; i < n; i++) {
    if (r() < (placed[i].c[1] < -0.15 ? 0.1 : 0.6)) continue
    const b = placed[i]
    const rr = b.r * r.range(0.3, 0.5)
    const c = polar(b.r + rr * 0.45, r.range(0, TAU), b.c)
    if (Math.hypot(c[0], c[1]) + rr < R && placed.every((o, j) => j === i || dist(o.c, c) >= o.r + rr + web)) placed.push({ c, r: rr })
  }
  // merged pairs near the top, as in the photo
  for (let k = 0, got = 0; k < 600 && got < 5; k++) {
    const rr = r.range(0.03, 0.045), c: Pt = [r.range(-0.5, 0.5), r.range(-0.62, -0.3)]
    const c2 = polar(rr * 1.3, r.range(0, TAU), c), r2 = rr * r.range(0.6, 0.85)
    if (clear(c, rr) && clear(c2, r2)) {
      placed.push({ c, r: rr }, { c: c2, r: r2 })
      got++
    }
  }
  tier(0.026, 0.038, 60)
  tier(0.017, 0.025, 200)
  tier(0.011, 0.016, 400)
  tier(0.008, 0.011, 500)
  return placed.map((b) => cut(circle(b.c[0], b.c[1], b.r)))
}

/** Dream (8): worm-like squiggles with round ends, packed in a disc, never touching. */
function squiggles(r: Rng): Shape[] {
  const out: Shape[] = []
  const R = 0.68, w = 0.048, step = 0.02
  const room = new Room(0.028)
  for (let tries = 0; tries < 30000 && out.length < 160; tries++) {
    const p0: Pt = [r.range(-R, R), r.range(-R, R)]
    if (Math.hypot(p0[0], p0[1]) > R - w) continue
    let a = r.range(0, TAU)
    const n = r.int(50, 110), f1 = r.range(0.25, 0.45), ph = r.range(0, TAU), amp = r.range(0.7, 1.0)
    const pts: Pt[] = [p0]
    if (!room.fits([p0], w / 2)) continue
    let turnRate = 0
    for (let i = 0; i < n; i++) {
      // the turn rate wanders, so curls tighten and relax like a doodle
      turnRate = turnRate * 0.6 + r.range(-1, 1) * amp * 0.25 + 0.32 * amp * Math.sin(ph + i * f1)
      a += turnRate
      const p = polar(step, a, pts[pts.length - 1])
      if (Math.hypot(p[0], p[1]) > R - w / 2) break
      if (pts.slice(0, -5).some((q) => dist(p, q) < w + 0.028)) break
      if (!room.fits([p], w / 2)) break
      pts.push(p)
    }
    // long strokes first, shorter ones fill the gaps left over
    if (pts.length < (tries < 10000 ? 34 : tries < 20000 ? 18 : 8)) continue
    room.add(pts, w / 2)
    out.push(cutLine(line(pts), w))
  }
  return out
}

/** Circle (3): one round hole in the middle. */
const roundHole = (): Shape[] => [cut(circle(0, 0, 0.25))]

/** Dots (7): a 5 × 5 grid of round holes. */
function dots(): Shape[] {
  const out: Shape[] = []
  const pitch = 0.26
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) out.push(cut(circle(i * pitch, j * pitch, 0.05)))
  return out
}

/** Jungle spacing (plate units): the thinnest metal between two openings, the thinnest opening, a sliver's width. */
const J_WEB = 0.014, J_MIN = 0.009, J_W = 0.021

/**
 * The jungle's clearance book: sampled points of every opening drawn so far, each with its half width and an owner
 * (a frond's solid body is `core<i>`). A new piece fits when it keeps J_WEB of metal to every point it does not own,
 * so no web between two openings ever narrows below the minimum, and nothing rings a scrap of metal.
 */
class JungleRoom {
  private items: Array<{ p: Pt; h: number; owner: string }> = []
  fits(p: Pt, h: number, skip = ''): boolean {
    return this.items.every((q) => q.owner === skip || dist(p, q.p) >= h + q.h + J_WEB)
  }
  add(p: Pt, h: number, owner: string) {
    this.items.push({ p, h, owner })
  }
}

/**
 * Walks an opening out from `p0` along `a` for up to `len`, sample by sample, and stops before the first sample that
 * would come too close to another opening (or leave the field). Returns the samples and half widths kept; points
 * within `free` of the start (inside the frond's own body) are not checked.
 */
function walk(room: JungleRoom, p0: Pt, a: number, len: number, hw: (t: number) => number, skip: string, free = 0): { pts: Pt[]; hs: number[]; inside: number } {
  const step = 0.006, n = Math.max(2, Math.ceil(len / step))
  const pts: Pt[] = [], hs: number[] = []
  let inside = 0
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const p = polar(len * t, a, p0)
    const h = Math.max(J_MIN / 2, hw(t))
    if (len * t < free) inside++
    else if (Math.hypot(p[0], p[1]) + h > 0.8 || !room.fits(p, h, skip)) break
    pts.push(p)
    hs.push(h)
  }
  return { pts, hs, inside }
}

/** An opening along sampled points with their half widths (blunt ends, never thinner than J_MIN). */
function sliver(pts: Pt[], hs: number[]): Shape {
  return cut(ribbon(pts, (t) => hs[Math.min(hs.length - 1, Math.round(t * (hs.length - 1)))]))
}

/**
 * One ragged frond: a solid body along a curved rib and many parallel slivers swept forward off both sides, a steady
 * strip of metal between neighbours; some slivers go on as loose shards past their tips.
 */
function frond(r: Rng, out: Shape[], room: JungleRoom, id: string, base: Pt, ang: number, len: number, reach: number, bend: number) {
  const n = 60
  const rib: Pt[] = Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n
    return turn([len * t, bend * len * Math.sin(Math.PI * t * 0.8)], ang, base)
  })
  const body = (t: number) => 0.06 * (1 - 0.7 * t) + 0.008
  out.push(cut(ribbon(rib, body)))
  rib.forEach((p, i) => room.add(p, body(i / n), id))
  for (const side of [-1, 1]) {
    const sweep = r.range(0.7, 0.8)
    // the gap along the rib that leaves J_WEB of metal (and a little more) between parallel slivers
    const ds = (J_W + J_WEB + 0.004) / Math.sin(sweep)
    for (let t = 0.1; t < 0.98; t += ds / len) {
      const i = Math.min(n - 1, Math.round(t * n))
      const p = rib[i], q = rib[i + 1]
      const ta = Math.atan2(q[1] - p[1], q[0] - p[0])
      const a = ta + side * sweep
      const L = reach * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.5) * r.range(0.6, 1.15) + 0.05
      // the part inside the body is free: it neither checks nor blocks (the other side's sliver starts there too)
      const free = body(t) / Math.sin(sweep)
      const tooth = walk(room, p, a, L + free, (u) => (J_W / 2) * (1 - 0.55 * Math.pow(u, 1.5)), id, free)
      if (tooth.pts.length < tooth.inside + 3) continue
      out.push(sliver(tooth.pts, tooth.hs))
      tooth.pts.forEach((pt, k) => k >= tooth.inside && room.add(pt, tooth.hs[k], 'teeth'))
      // a loose shard past the tip, on the same line
      if (tooth.pts.length > ((L + free) / 0.006) * 0.95 && r() < 0.5) {
        const s0 = polar(L + free + 0.03, a, p)
        const shard = walk(room, s0, a + r.range(-0.03, 0.03), r.range(0.04, 0.08), (u) => (J_W / 2) * 0.8 * (1 - 0.5 * u), '')
        if (shard.pts.length >= 4) {
          out.push(sliver(shard.pts, shard.hs))
          shard.pts.forEach((pt, k) => room.add(pt, shard.hs[k], 'shard'))
        }
      }
    }
  }
}

/** Jungle (10): a Y of ragged palm fronds, dark masses with streaky edges and loose slivers round them. */
function jungle(r: Rng): Shape[] {
  const out: Shape[] = []
  const room = new JungleRoom()
  const C: Pt = [0.02, 0.06]
  // the fronds' bodies meet in one solid heart, so no thin metal wedge runs between them
  out.push(cut(circle(C[0], C[1], 0.07)))
  room.add(C, 0.07, 'heart')
  frond(r, out, room, 'f0', C, -2.75, 0.62, 0.21, -0.12)
  frond(r, out, room, 'f1', C, -0.42, 0.66, 0.25, 0.1)
  frond(r, out, room, 'f2', C, 1.92, 0.5, 0.2, 0.12)
  frond(r, out, room, 'f3', polar(0.08, -1.2, C), -1.25, 0.32, 0.13, 0.1)
  // loose slivers round the fronds' tips
  for (const [c, a, n] of [[[-0.62, -0.26], -2.75, 14], [[0.6, -0.36], -0.42, 10], [[-0.18, 0.58], 1.92, 9], [[0.42, 0.3], 0.5, 7]] as Array<[Pt, number, number]>) {
    for (let k = 0, got = 0; k < n * 30 && got < n; k++) {
      const p: Pt = [c[0] + r.range(-0.15, 0.15), c[1] + r.range(-0.15, 0.15)]
      const len = r.range(0.04, 0.1), w = r.range(0.007, 0.013)
      const s = walk(room, p, a + r.range(-0.5, 0.5), len, (u) => w * Math.sin(Math.PI * Math.max(0.15, Math.min(0.85, u))), '')
      if (s.pts.length < Math.ceil(len / 0.006)) continue
      out.push(sliver(s.pts, s.hs))
      s.pts.forEach((pt, i) => room.add(pt, s.hs[i], 'loose'))
      got++
    }
  }
  return out
}

/** Radial (14): fine lines converging on a small metal centre, three staggered start rings, some broken in two. */
function radial(r: Rng): Shape[] {
  const out: Shape[] = []
  const n = 120, w = 0.009
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + r.range(-0.006, 0.006)
    // start rings chosen so the metal between neighbouring rays is never under 0.012
    const r0 = i % 6 === 0 ? r.range(0.072, 0.08) : i % 3 === 0 ? r.range(0.145, 0.18) : i % 2 === 0 ? r.range(0.25, 0.3) : r.range(0.4, 0.45)
    const r1 = Math.max(r0 + 0.08, r.range(0.48, 0.7))
    if (r() < 0.4) {
      const m = r.range(r0 + 0.08, r1 - 0.08)
      out.push(cutLine(line([polar(r0, a), polar(m - 0.018, a)]), w, 'butt'))
      out.push(cutLine(line([polar(m + 0.018, a), polar(r1, a)]), w, 'butt'))
    } else out.push(cutLine(line([polar(r0, a), polar(r1, a)]), w, 'butt'))
  }
  return out
}

/**
 * Wan (26): a tall panel of Chinese lattice. Stair-like meander keys fill it; mid-left and mid-right the coin pattern
 * (overlapping circles: lenses and concave squares) sits against the edges. Metal webs between all pieces.
 */
function maze(r: Rng): Shape[] {
  const u = 0.13, cols = 6, rows = 10, web = 0.032
  const x0 = (-cols * u) / 2, y0 = (-rows * u) / 2
  const out: Shape[] = []
  // the coin zones: columns 0-1 and 4-5, rows 3-6 (cell units); open, then the circles in metal
  const zones = [[0, 3, 2, 4], [4, 3, 2, 4]]
  const inZone = (c: number, rr: number) => zones.some(([zc, zr, zw, zh]) => c >= zc && c < zc + zw && rr >= zr && rr < zr + zh)
  for (const [zc, zr, zw, zh] of zones) {
    const cx = x0 + zc * u, cy = y0 + zr * u
    out.push(cut(rect(cx + (zw * u) / 2, cy + (zh * u) / 2, zw * u - web, zh * u - web)))
    // circles on the panel's outer edge and every two cells in, so the edge gets half circles as in the photo
    const ex = zc === 0 ? x0 : x0 + cols * u
    for (let j = 0; j <= zh; j += 2) for (const dx of [0, zc === 0 ? 2 * u : -2 * u]) {
      out.push(metalLine(circle(ex + dx, cy + j * u, u * Math.SQRT2), web))
    }
  }
  // the meander: cells grouped into stair steps, L keys and bars (the first cell of each shape is its row-major first)
  const shapes: Pt[][] = [
    [[0, 0], [1, 0], [1, 1], [2, 1]], [[0, 0], [1, 0], [0, 1], [-1, 1]], [[0, 0], [0, 1], [1, 1], [1, 2]], [[0, 0], [0, 1], [-1, 1], [-1, 2]],
    [[0, 0], [1, 0], [1, 1], [1, 2]], [[0, 0], [0, 1], [0, 2], [1, 2]], [[0, 0], [1, 0], [2, 0], [0, 1]], [[0, 0], [0, 1], [1, 1], [2, 1]],
    [[0, 0], [1, 0], [1, 1]], [[0, 0], [0, 1], [-1, 1]], [[0, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [0, 1]],
    [[0, 0], [1, 0]], [[0, 0], [0, 1]],
  ]
  const taken = new Set<string>()
  const free = (c: number, rr: number) => c >= 0 && c < cols && rr >= 0 && rr < rows && !inZone(c, rr) && !taken.has(`${c},${rr}`)
  for (let rr = 0; rr < rows; rr++) for (let c = 0; c < cols; c++) {
    if (!free(c, rr)) continue
    const order = shapes.map((s) => ({ s, k: r() + (s.length >= 4 ? -0.5 : s.length === 3 ? -0.25 : 0) })).sort((a, b) => a.k - b.k)
    const piece = order.map((o) => o.s.map(([dc, dr]) => [c + dc, rr + dr] as Pt)).find((cells) => cells.every(([a, b]) => free(a, b))) ?? [[c, rr] as Pt]
    for (const [a, b] of piece) {
      taken.add(`${a},${b}`)
      out.push(cut(rect(x0 + (a + 0.5) * u, y0 + (b + 0.5) * u, u - web, u - web)))
    }
    for (const [a, b] of piece) for (const [e, f] of piece) {
      if ((e === a + 1 && f === b) || (e === a && f === b + 1)) out.push(cut(rect(x0 + ((a + e) / 2 + 0.5) * u, y0 + ((b + f) / 2 + 0.5) * u, e > a ? u : u - web, f > b ? u : u - web)))
    }
  }
  return out
}

/** Snowflake (42): a loose cluster of small snowflakes, six-arm stars with ball ends and four-arm crosses with ticks. */
function snowflakeField(r: Rng): Shape[] {
  const out: Shape[] = []
  const items: Array<{ c: Pt; s: number }> = []
  for (let k = 0; k < 8000 && items.length < 25; k++) {
    const big = items.length < 8
    const s = big ? r.range(0.11, 0.135) : r.range(0.07, 0.09)
    const c: Pt = [r.range(-0.66, 0.66), r.range(-0.5, 0.5)]
    if (Math.hypot(c[0] / 0.68, c[1] / 0.52) > 1) continue
    if (items.some((o) => dist(o.c, c) < o.s + s + 0.02)) continue
    items.push({ c, s })
  }
  items.forEach(({ c, s }, k) => {
    const a0 = r.range(0, TAU)
    if (k < 8) {
      // a starry flake: eight spokes with a ball on each
      for (let i = 0; i < 8; i++) {
        const a = a0 + (i / 8) * TAU
        const tip = polar(s - 0.012, a, c)
        out.push(cutLine(line([c, tip]), 0.014))
        out.push(cut(circle(tip[0], tip[1], 0.013)))
      }
    } else if (k % 2 === 0) {
      // six arms with a short cross bar near each tip
      for (let i = 0; i < 6; i++) {
        const a = a0 + (i / 6) * TAU
        out.push(cutLine(line([c, polar(s, a, c)]), 0.013))
        const m = polar(s * 0.68, a, c)
        out.push(cutLine(line([polar(s * 0.22, a + Math.PI / 2, m), polar(s * 0.22, a - Math.PI / 2, m)]), 0.012))
      }
    } else {
      // a cross with a small tick across each arm end
      for (let i = 0; i < 4; i++) {
        const a = a0 + (i / 4) * TAU
        out.push(cutLine(line([c, polar(s * 0.9, a, c)]), 0.016))
        const m = polar(s * 0.82, a, c)
        out.push(cutLine(line([polar(s * 0.2, a + Math.PI / 2, m), polar(s * 0.2, a - Math.PI / 2, m)]), 0.014))
      }
    }
  })
  return out
}

/**
 * Big snowflake (110): six long arms with two pairs of barbs and a forked tip, and between them six short arms with
 * three pairs of chevron barbs, round a small hub.
 */
function bigSnowflake(): Shape[] {
  const out: Shape[] = [cut(circle(0, 0, 0.085))]
  const arm = (a: number, len: number, w: number, bw: number, barbs: Array<[number, number]>, back: number) => {
    out.push(cutLine(line([[0, 0], polar(len, a)]), w, 'butt'))
    for (const [d, L] of barbs) {
      const p = polar(d, a)
      for (const s of [-1, 1]) out.push(cutLine(line([p, polar(L, a + Math.PI + s * back, p)]), bw, 'butt', 'miter'))
    }
  }
  for (let i = 0; i < 6; i++) {
    const a = Math.PI + (i / 6) * TAU
    arm(a, 0.82, 0.05, 0.04, [[0.5, 0.17], [0.65, 0.16], [0.82, 0.09]], 0.9)
    arm(a + Math.PI / 6, 0.47, 0.034, 0.03, [[0.28, 0.07], [0.37, 0.08], [0.46, 0.07]], 0.8)
  }
  return out
}

export const REFS_B: PlateDef[] = [
  { id: 'plate-bubbles', name: 'bubbles', category: 'patterns', description: 'round bubbles of many sizes packed in a disc', source: `${SRC}, Bubble (11)`, seed: 111, draw: bubbles },
  { id: 'plate-squiggles', name: 'squiggles', category: 'patterns', description: 'worm-like squiggles packed in a disc', source: `${SRC}, Dream (8)`, seed: 8, draw: squiggles },
  { id: 'plate-circle', name: 'circle', category: 'beams', description: 'one round hole in the middle', source: `${SRC}, Circle (3)`, draw: roundHole },
  { id: 'plate-dots', name: 'dots', category: 'patterns', description: 'a five by five grid of round holes', source: `${SRC}, Dots (7)`, draw: dots },
  { id: 'plate-jungle', name: 'jungle', category: 'nature', description: 'ragged palm fronds in a Y with loose slivers', source: `${SRC}, Jungle (10)`, seed: 10, draw: jungle },
  { id: 'plate-radial', name: 'radial', category: 'beams', description: 'fine lines converging on a small centre', source: `${SRC}, Radial (14)`, seed: 14, draw: radial },
  { id: 'plate-maze', name: 'maze', category: 'patterns', description: 'a tall panel of meander keys and coin lattice', source: `${SRC}, Wan (26)`, seed: 26, draw: maze },
  { id: 'plate-snowflake-field', name: 'snowflake field', category: 'sky', description: 'a loose cluster of small snowflakes', source: `${SRC}, Snowflake (42)`, seed: 42, draw: snowflakeField },
  { id: 'plate-big-snowflake', name: 'big snowflake', category: 'sky', description: 'one big six-arm snowflake with chevron barbs', source: `${SRC}, Big snowflake (110)`, draw: bigSnowflake },
]
