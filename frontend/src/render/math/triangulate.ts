import type { Vec2 } from './homography'

/** Signed area (positive = counter-clockwise in a y-up frame; with y down, positive = clockwise on screen). */
export function signedArea(pts: readonly Vec2[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[(i + 1) % pts.length]
    a += x0 * y1 - x1 * y0
  }
  return a / 2
}

function pointInTri(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1])
  const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1])
  const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1])
  const neg = d1 < 0 || d2 < 0 || d3 < 0
  const pos = d1 > 0 || d2 > 0 || d3 > 0
  return !(neg && pos)
}

/** Ear clipping. Returns index triples into pts; works for simple (possibly concave) polygons of either winding. */
export function triangulate(pts: readonly Vec2[]): number[] {
  const n = pts.length
  if (n < 3) return []
  const idx = Array.from({ length: n }, (_, i) => i)
  const ccw = signedArea(pts) > 0
  const out: number[] = []
  let guard = 0
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length]
      const ib = idx[i]
      const ic = idx[(i + 1) % idx.length]
      const a = pts[ia], b = pts[ib], c = pts[ic]
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
      if (ccw ? cross <= 0 : cross >= 0) continue // reflex or degenerate
      let inside = false
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue
        if (pointInTri(pts[j], a, b, c)) {
          inside = true
          break
        }
      }
      if (inside) continue
      out.push(ia, ib, ic)
      idx.splice(i, 1)
      clipped = true
      break
    }
    if (!clipped) {
      // self-intersecting or degenerate: fall back to a fan for the rest
      for (let i = 1; i < idx.length - 1; i++) out.push(idx[0], idx[i], idx[i + 1])
      return out
    }
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2])
  return out
}
