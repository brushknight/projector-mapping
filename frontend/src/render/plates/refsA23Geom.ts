/**
 * Small helpers for the set A, 2 and 3 plates (refsA23.ts): stars, hearts, wavy tongues and line runs inside a region.
 * Plate space: the unit circle, y down. Pure.
 */
import { lerp, line, poly, polar, ribbon, turn, type Pt } from './geom'

/** A star polygon with `n` points, outer radius R, inner radius r, turned by `a`. */
export function starPts(c: Pt, n: number, R: number, r: number, a = -Math.PI / 2): Pt[] {
  const pts: Pt[] = []
  for (let i = 0; i < n * 2; i++) pts.push(polar(i % 2 === 0 ? R : r, a + (i * Math.PI) / n, c))
  return pts
}
export const star = (c: Pt, n: number, R: number, r: number, a?: number) => poly(starPts(c, n, R, r, a))

/** An asterisk: `n` arms from the centre as one path, to stroke with round caps. */
export function asterisk(c: Pt, n: number, R: number, a = 0, jitter: number[] = []): string {
  let d = ''
  for (let i = 0; i < n; i++) {
    const p = polar(R * (1 + (jitter[i] ?? 0)), a + (i * 2 * Math.PI) / n, c)
    d += line([c, p])
  }
  return d
}

/** A heart of height about `s`, centred on c, turned by `a` (point down when a = 0). */
export function heart(c: Pt, s: number, a = 0): string {
  const pts: Pt[] = []
  const k = s / 32
  for (let i = 0; i < 48; i++) {
    const t = (i / 48) * Math.PI * 2
    const x = 16 * Math.sin(t) ** 3
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) - 2
    pts.push(turn([x * k, y * k], a, c))
  }
  return poly(pts)
}

/** A slender tongue along a wavy path from base to tip: tapered at both ends, widest at `at`. */
export function tongue(base: Pt, tip: Pt, width: number, wave: number, phase: number, at = 0.3, n = 28): string {
  const L = Math.hypot(tip[0] - base[0], tip[1] - base[1])
  const dx = (tip[0] - base[0]) / L, dy = (tip[1] - base[1]) / L
  const pts: Pt[] = Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n
    const o = wave * L * Math.sin(phase + t * Math.PI * 2.1) * Math.sin(Math.PI * Math.min(1, t * 1.4))
    const p = lerp(base, tip, t)
    return [p[0] - dy * o, p[1] + dx * o] as Pt
  })
  return ribbon(pts, (t) => {
    const k = t < at ? Math.sin((t / at) * Math.PI * 0.5) : Math.cos(((t - at) / (1 - at)) * Math.PI * 0.5)
    return (width / 2) * Math.pow(Math.max(0, k), 0.8)
  })
}

/** The runs of segment a → b whose points pass `inside` (sampled every `step`), each as [start, end]. */
export function runs(a: Pt, b: Pt, inside: (p: Pt) => boolean, step = 0.004): Array<[Pt, Pt]> {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1])
  const n = Math.max(2, Math.ceil(L / step))
  const out: Array<[Pt, Pt]> = []
  let start: Pt | null = null
  let last: Pt = a
  for (let i = 0; i <= n; i++) {
    const p = lerp(a, b, i / n)
    const ok = inside(p)
    if (ok && !start) start = p
    if (!ok && start) {
      out.push([start, last])
      start = null
    }
    last = p
  }
  if (start) out.push([start, last])
  return out
}

/** Whether p lies inside the polygon (even-odd). */
export function inPoly(p: Pt, pts: Pt[]): boolean {
  let c = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j]
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c
  }
  return c
}

/**
 * Fills where f(p) > 0 over the square ±extent as polygons (marching squares per cell, full cells merged into runs),
 * one path per row. Metal that the cut would ring off (a hole not connected to the border) is filled in, so the plate
 * keeps no loose islands.
 */
export function isoFill(f: (p: Pt) => number, extent = 0.9, step = 0.01): string[] {
  const n = Math.ceil((2 * extent) / step)
  const at = (i: number, j: number): Pt => [-extent + i * step, -extent + j * step]
  const v: number[][] = []
  for (let j = 0; j <= n; j++) {
    v.push([])
    for (let i = 0; i <= n; i++) v[j].push(f(at(i, j)))
  }
  // metal islands: flood the metal from the border; whatever metal it cannot reach becomes cut
  const seen = v.map((row) => row.map(() => false))
  const stack: Array<[number, number]> = []
  for (let k = 0; k <= n; k++) stack.push([k, 0], [k, n], [0, k], [n, k])
  while (stack.length) {
    const [i, j] = stack.pop()!
    if (i < 0 || j < 0 || i > n || j > n || seen[j][i] || v[j][i] > 0) continue
    seen[j][i] = true
    stack.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1])
  }
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) if (v[j][i] <= 0 && !seen[j][i]) v[j][i] = 1e-3
  const fmt = (p: Pt) => `${Math.round(p[0] * 10000) / 10000} ${Math.round(p[1] * 10000) / 10000}`
  const rows: string[] = []
  for (let j = 0; j < n; j++) {
    let d = ''
    let run = -1
    const flush = (end: number) => {
      if (run < 0) return
      const a = at(run, j), b = at(end, j + 1)
      d += `M${fmt(a)}L${fmt([b[0], a[1]])}L${fmt(b)}L${fmt([a[0], b[1]])}Z`
      run = -1
    }
    for (let i = 0; i < n; i++) {
      const c = [v[j][i], v[j][i + 1], v[j + 1][i + 1], v[j + 1][i]]
      const P = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]
      if (c.every((x) => x > 0)) {
        if (run < 0) run = i
        continue
      }
      flush(i)
      if (c.every((x) => x <= 0)) continue
      const pts: Pt[] = []
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) % 4
        if (c[k] > 0) pts.push(P[k])
        if (c[k] > 0 !== c[k2] > 0) pts.push(lerp(P[k], P[k2], c[k] / (c[k] - c[k2])))
      }
      if (pts.length >= 3) d += `M${pts.map(fmt).join('L')}Z`
    }
    flush(n)
    if (d) rows.push(d)
  }
  return rows
}

/** Points along a polyline every `step` (keeps the ends). */
export function resample(pts: Pt[], step = 0.01): Pt[] {
  const out: Pt[] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step))
    for (let k = 1; k <= n; k++) out.push(lerp(a, b, k / n))
  }
  return out
}

/**
 * Branch strokes that never cross or touch. A real plate cut along two branches that met again would ring off the
 * metal between them, so every new stroke is checked, sample by sample, against every stroke already placed: each
 * sample must stay `web` clear of the others (half widths included). The one exception is the stroke's root, where it
 * joins its parent: samples within `rootZone` of the root may touch the parent (and only the parent), and samples
 * that `covered` says lie inside an opening already cut (a hub) are skipped. A stroke is trimmed at its first sample
 * that comes too close; one left shorter than `minLen` is dropped. So the branches form a tree, which can never
 * enclose metal.
 */
export class Strokes {
  items: Array<{ pts: Pt[]; hs: number[] }> = []
  constructor(public web = 0.016) {}
  /** Places a stroke (samples with half widths), trimmed as above; its id and kept samples, or null. */
  add(pts: Pt[], hs: number[], parent = -1, rootZone = 0, minLen = 0.03, covered: (p: Pt) => boolean = () => false): { id: number; pts: Pt[]; hs: number[] } | null {
    let keep = pts.length
    for (let i = 0; i < pts.length && keep === pts.length; i++) {
      const p = pts[i]
      if (covered(p)) continue
      const nearRoot = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) < rootZone
      for (let j = 0; j < this.items.length; j++) {
        if (j === parent && nearRoot) continue
        const it = this.items[j]
        let bad = false
        for (let k = 0; k < it.pts.length; k++) {
          const q = it.pts[k]
          if (Math.hypot(p[0] - q[0], p[1] - q[1]) < hs[i] + it.hs[k] + this.web) {
            bad = true
            break
          }
        }
        if (bad) {
          keep = Math.max(0, i - 2)
          break
        }
      }
    }
    const kept = pts.slice(0, keep)
    let L = 0
    for (let i = 1; i < kept.length; i++) L += Math.hypot(kept[i][0] - kept[i - 1][0], kept[i][1] - kept[i - 1][1])
    if (kept.length < 2 || L < minLen) return null
    // samples inside an opening already cut (covered) are not kept for later checks: nothing can ring metal there
    const free = kept.map((_, i) => i).filter((i) => !covered(kept[i]))
    this.items.push({ pts: free.map((i) => kept[i]), hs: free.map((i) => hs[i]) })
    return { id: this.items.length - 1, pts: kept, hs: hs.slice(0, keep) }
  }
  /** Registers a shape that is already cut (a hub) as a single fat sample, so other strokes keep clear of it. */
  hub(c: Pt, r: number): number {
    this.items.push({ pts: [c], hs: [r] })
    return this.items.length - 1
  }
}
