/**
 * Geometry for metal gobo plates (protocol §15, category `plates`). Every plate is authored in plate space: the plate
 * is the unit circle, x right, y down, (0, 0) its centre (SVG viewBox -1 -1 2 2). Helpers return SVG path data.
 * Pure and deterministic: randomness comes from `rng(seed)`, never Math.random.
 */

export type Pt = [number, number]

/** One element of a plate, painted in order: `cut` opens metal (light passes), `metal` closes it again. */
export interface Shape {
  d: string
  op: 'cut' | 'metal'
  /** stroke width in plate units; absent fills the path */
  stroke?: number
  cap?: 'round' | 'butt' | 'square'
  join?: 'round' | 'miter' | 'bevel'
  /** fill rule (fills only); evenodd lets one path carry its own holes */
  rule?: 'nonzero' | 'evenodd'
}

/** A seeded random source (mulberry32). */
export interface Rng {
  (): number
  range(a: number, b: number): number
  int(a: number, b: number): number
  pick<T>(xs: readonly T[]): T
  /** roughly normal, mean 0, sd 1 */
  gauss(): number
}

export function rng(seed: number): Rng {
  let s = (seed >>> 0) || 1
  const next = (() => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }) as Rng
  next.range = (a, b) => a + (b - a) * next()
  next.int = (a, b) => Math.floor(a + (b - a + 1) * next())
  next.pick = (xs) => xs[Math.floor(next() * xs.length) % xs.length]
  next.gauss = () => (next() + next() + next() + next() - 2) * 1.7320508
  return next
}

const f = (n: number) => {
  const v = Math.round(n * 10000) / 10000
  return Object.is(v, -0) ? '0' : String(v)
}

// ── path builders ────────────────────────────────────────────────────────────

/** A closed polygon. */
export const poly = (pts: Pt[]): string => (pts.length < 2 ? '' : `M${pts.map((p) => `${f(p[0])} ${f(p[1])}`).join('L')}Z`)

/** An open polyline (for strokes). */
export const line = (pts: Pt[]): string => (pts.length < 2 ? '' : `M${pts.map((p) => `${f(p[0])} ${f(p[1])}`).join('L')}`)

/** A circle as two arcs; `ccw` reverses it (a hole inside an evenodd or nonzero path). */
export const circle = (cx: number, cy: number, r: number, ccw = false): string => {
  const s = ccw ? 0 : 1
  return `M${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 ${s} ${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 ${s} ${f(cx - r)} ${f(cy)}Z`
}

/** An ellipse, turned by `a` radians, as a polygon. */
export const ellipse = (cx: number, cy: number, rx: number, ry: number, a = 0, n = 40): string =>
  poly(Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2
    return turn([rx * Math.cos(t), ry * Math.sin(t)], a, [cx, cy])
  }))

/** A rectangle centred on (cx, cy), turned by `a` radians. */
export const rect = (cx: number, cy: number, w: number, h: number, a = 0): string =>
  poly(([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]] as Pt[]).map((p) => turn(p, a, [cx, cy])))

/** An annulus (filled with evenodd or as one nonzero path: the inner circle runs the other way). */
export const ring = (cx: number, cy: number, r1: number, r2: number): string => circle(cx, cy, r2) + circle(cx, cy, r1, true)

/** An annular sector from angle a0 to a1 (radians, 0 = right, clockwise on screen since y is down). */
export function sector(cx: number, cy: number, r1: number, r2: number, a0: number, a1: number, n = 24): string {
  const pts: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    pts.push([cx + r2 * Math.cos(a), cy + r2 * Math.sin(a)])
  }
  for (let i = n; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / n
    pts.push([cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)])
  }
  return poly(pts)
}

/** A smooth closed curve through the points (Catmull-Rom as cubic Béziers). */
export function blob(pts: Pt[]): string {
  const n = pts.length
  if (n < 3) return poly(pts)
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n]
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`
  }
  return d + 'Z'
}

// ── point helpers ────────────────────────────────────────────────────────────

export const turn = (p: Pt, a: number, o: Pt = [0, 0]): Pt => [o[0] + p[0] * Math.cos(a) - p[1] * Math.sin(a), o[1] + p[0] * Math.sin(a) + p[1] * Math.cos(a)]
export const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])
export const polar = (r: number, a: number, o: Pt = [0, 0]): Pt => [o[0] + r * Math.cos(a), o[1] + r * Math.sin(a)]

/** Samples a quadratic Bézier a → c → b into n + 1 points. */
export function quad(a: Pt, c: Pt, b: Pt, n = 16): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t
    return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]] as Pt
  })
}

/** Samples a cubic Bézier into n + 1 points. */
export function cubic(a: Pt, c1: Pt, c2: Pt, b: Pt, n = 20): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t
    const k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t
    return [k0 * a[0] + k1 * c1[0] + k2 * c2[0] + k3 * b[0], k0 * a[1] + k1 * c1[1] + k2 * c2[1] + k3 * b[1]] as Pt
  })
}

/**
 * A ribbon along a polyline whose half width at fraction t (0 at the first point) is `w(t)`: tapered rays, leaves,
 * flame tongues, branches. Returns a closed polygon.
 */
export function ribbon(pts: Pt[], w: (t: number) => number): string {
  const n = pts.length
  if (n < 2) return ''
  const left: Pt[] = [], right: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const l = Math.hypot(dx, dy) || 1
    const nx = -dy / l, ny = dx / l
    const h = Math.max(0, w(i / (n - 1)))
    left.push([pts[i][0] + nx * h, pts[i][1] + ny * h])
    right.push([pts[i][0] - nx * h, pts[i][1] - ny * h])
  }
  return poly([...left, ...right.reverse()])
}

/** A pointed leaf from `base` to `tip`, widest at `at` (0..1), bowed sideways by `bend` (fraction of its length). */
export function leaf(base: Pt, tip: Pt, width: number, bend = 0, at = 0.4, n = 18): string {
  const L = dist(base, tip)
  const dx = (tip[0] - base[0]) / L, dy = (tip[1] - base[1]) / L
  const axis = Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n
    const off = bend * L * Math.sin(Math.PI * t)
    return [base[0] + dx * L * t - dy * off, base[1] + dy * L * t + dx * off] as Pt
  })
  return ribbon(axis, (t) => {
    const k = t < at ? Math.sin((t / at) * Math.PI * 0.5) : Math.cos(((t - at) / (1 - at)) * Math.PI * 0.5)
    return (width / 2) * Math.pow(Math.max(0, k), 0.75)
  })
}

/**
 * Jagged midpoint displacement between two points (lightning, cracks): `depth` halvings, offset `rough` × length,
 * the offset scaled by `decay` at each level (higher keeps more small-scale zigzag).
 */
export function jag(a: Pt, b: Pt, r: Rng, depth = 5, rough = 0.22, decay = 0.62): Pt[] {
  let pts: Pt[] = [a, b]
  let k = rough
  for (let d = 0; d < depth; d++) {
    const next: Pt[] = [pts[0]]
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i]
      const L = dist(p, q)
      const m = lerp(p, q, 0.5)
      const o = r.gauss() * k * L
      next.push([m[0] - ((q[1] - p[1]) / (L || 1)) * o, m[1] + ((q[0] - p[0]) / (L || 1)) * o], q)
    }
    pts = next
    k *= decay
  }
  return pts
}

/** Whether every point lies inside radius r, or every point outside it (a scattered item never straddles the field edge). */
export function clearOfEdge(pts: Pt[], r: number, pad = 0): boolean {
  let inside = 0
  for (const p of pts) if (Math.hypot(p[0], p[1]) < r - pad) inside++
  if (inside === pts.length) return true
  return pts.every((p) => Math.hypot(p[0], p[1]) > r + pad)
}

/** Simple dart-throwing: points in the square with at least `gap` between them (a fixed number of tries). */
export function scatter(r: Rng, n: number, gap: (p: Pt) => number, accept: (p: Pt) => boolean = () => true, extent = 1, tries = 40): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < n * tries && out.length < n; i++) {
    const p: Pt = [r.range(-extent, extent), r.range(-extent, extent)]
    if (!accept(p)) continue
    const g = gap(p)
    if (out.every((q) => dist(p, q) >= Math.max(g, gap(q)))) out.push(p)
  }
  return out
}

/** 2D value noise (0..1) for clustering. */
export function noise2(x: number, y: number, seed = 0): number {
  const h = (i: number, j: number) => {
    let n = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 2147483647)
    n = Math.imul(n ^ (n >>> 13), 1274126177)
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296
  }
  const i = Math.floor(x), j = Math.floor(y)
  const fx = x - i, fy = y - j
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy)
  const a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

// ── shape shorthands ─────────────────────────────────────────────────────────

export const cut = (d: string, rule: Shape['rule'] = 'nonzero'): Shape => ({ d, op: 'cut', rule })
export const metal = (d: string, rule: Shape['rule'] = 'nonzero'): Shape => ({ d, op: 'metal', rule })
export const cutLine = (d: string, w: number, cap: Shape['cap'] = 'round', join: Shape['join'] = 'round'): Shape => ({ d, op: 'cut', stroke: w, cap, join })
export const metalLine = (d: string, w: number, cap: Shape['cap'] = 'round', join: Shape['join'] = 'round'): Shape => ({ d, op: 'metal', stroke: w, cap, join })

/** The whole square open: a plate that starts as light and blocks it with metal (branches, crossed wires). */
export const open = (): Shape => cut('M-1.2 -1.2H1.2V1.2H-1.2Z')

/** Clips a convex polygon to the half plane n·p ≤ c (Sutherland–Hodgman). */
export function clipHalf(pts: Pt[], n: Pt, c: number): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]
    const da = n[0] * a[0] + n[1] * a[1] - c, db = n[0] * b[0] + n[1] * b[1] - c
    if (da <= 0) out.push(a)
    if (da * db < 0) out.push(lerp(a, b, da / (da - db)))
  }
  return out
}

/**
 * Voronoi cells of the sites, each shrunk by half the `web` (so neighbouring cells sit `web` apart: the metal between
 * them). Cells come back in site order, clipped to the square ±extent. O(n²) on nearby sites, fine for a few thousand.
 */
export function cells(sites: Pt[], web: number, extent = 1.1, reach = 0.4): Pt[][] {
  return sites.map((s, i) => {
    let poly: Pt[] = [[-extent, -extent], [extent, -extent], [extent, extent], [-extent, extent]]
    for (let j = 0; j < sites.length && poly.length; j++) {
      if (j === i) continue
      const o = sites[j]
      const dx = o[0] - s[0], dy = o[1] - s[1]
      const d = Math.hypot(dx, dy)
      if (d > reach || d === 0) continue
      const n: Pt = [dx / d, dy / d]
      // the bisector, moved back towards s by half the web
      const c = n[0] * (s[0] + dx / 2) + n[1] * (s[1] + dy / 2) - web / 2
      poly = clipHalf(poly, n, c)
    }
    return poly
  })
}

/** Jittered grid sites, spacing `step`, over the square ±extent. */
export function jittered(r: Rng, step: number, jitter = 0.45, extent = 1.05): Pt[] {
  const out: Pt[] = []
  const n = Math.ceil(extent / step)
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
    out.push([(i + (j % 2 ? 0.5 : 0)) * step + r.range(-jitter, jitter) * step, j * step * 0.866 + r.range(-jitter, jitter) * step])
  }
  return out
}

/**
 * Keeps scattered strokes apart so their openings never merge (merged openings can ring a piece of metal, which would
 * fall out of a real plate). Each item is sampled points with a half width each.
 */
export class Room {
  private items: Array<{ p: Pt; h: number }> = []
  constructor(private gap = 0.016) {}
  fits(pts: Pt[], half: number | ((t: number) => number)): boolean {
    return pts.every((p, i) => {
      const h = typeof half === 'number' ? half : half(i / Math.max(1, pts.length - 1))
      return this.items.every((q) => dist(p, q.p) >= h + q.h + this.gap)
    })
  }
  add(pts: Pt[], half: number | ((t: number) => number)) {
    pts.forEach((p, i) => this.items.push({ p, h: typeof half === 'number' ? half : half(i / Math.max(1, pts.length - 1)) }))
  }
  /** adds and reports true when it fits */
  take(pts: Pt[], half: number | ((t: number) => number)): boolean {
    if (!this.fits(pts, half)) return false
    this.add(pts, half)
    return true
  }
}
