/**
 * Parametric windows (protocol §16): one window generator, many presets. Every window plate in the reference photos
 * (the 6-pane grid, the arched and palace windows, the skewed and setting-sun windows, the tall grid, the diamond
 * lattice windows, blinds and the fine-lines plates) is a preset of the same geometry, and an attachment's params
 * adjust it: rows, columns, sashes, mullion, frame and pane gap, an arch with spokes and a hub, a round outline,
 * perspective (top vs bottom width, right vs left height, slant, rise), a diamond lattice with inner squares, and
 * blind slats.
 *
 * The window is built as cut polygons in a flat box (plate units, centred), then every point goes through one
 * homography that maps the box onto the perspective quad. Bars between panes are the metal left between cuts, so
 * every pane is held on all sides (no metal islands), and no bar is thinner than MIN_BAR.
 */
import type { ParamSchema, ParamSpec } from '../../entities/effect/types'
import { clipHalf, cut, metal, poly, type Pt, type Shape } from './geom'
import type { PlateDef } from './types'

/** the thinnest metal bar a plate can hold (plate units: about 0.35 % of the plate's diameter) */
export const MIN_BAR = 0.006

const num = (min: number, max: number, def: number, label: string): ParamSpec => ({ type: 'number', min, max, default: def, label })
const int = (min: number, max: number, def: number, label: string): ParamSpec => ({ type: 'integer', min, max, default: def, label })
const bool = (def: boolean, label: string): ParamSpec => ({ type: 'boolean', default: def, label })

/** The window geometry params, in display order. Defaults here are a plain one-pane window; presets override them. */
export const WINDOW_PARAMS: ParamSchema = {
  sashes: int(1, 4, 1, 'sashes'),
  cols: int(1, 12, 1, 'columns'),
  rows: int(1, 16, 1, 'rows'),
  gap: num(0, 1, 0.25, 'pane gap'),
  width: num(0.1, 1, 0.5, 'width'),
  height: num(0.1, 1, 0.6, 'height'),
  frame: num(0, 1, 0, 'frame width'),
  mullion: num(0, 1, 0.3, 'mullion width'),
  arch: bool(false, 'arch'),
  archHeight: num(0, 1, 1, 'arch height'),
  spokes: int(0, 9, 0, 'arch spokes'),
  hub: num(0, 0.8, 0, 'arch hub'),
  round: bool(false, 'round window'),
  taper: num(-1, 1, 0, 'top width'),
  taperY: num(-1, 1, 0, 'right height'),
  slant: num(-1, 1, 0, 'slant'),
  slantY: num(-1, 1, 0, 'rise'),
  diamond: bool(false, 'diamond lattice'),
  diamonds: int(1, 16, 4, 'lattice density'),
  jewels: bool(false, 'inner squares'),
  slats: int(0, 120, 0, 'slats'),
  slatWidth: num(0.1, 0.9, 0.5, 'slat width'),
  vertical: bool(false, 'vertical slats'),
}

/** How the window params group in the inspectors (catalog `windowParamGroups`). */
export const WINDOW_PARAM_GROUPS: Array<{ id: string; name: string; params: string[] }> = [
  { id: 'grid', name: 'grid', params: ['sashes', 'cols', 'rows', 'gap'] },
  { id: 'frame', name: 'frame', params: ['width', 'height', 'frame', 'mullion'] },
  { id: 'arch', name: 'arch', params: ['arch', 'archHeight', 'spokes', 'hub'] },
  { id: 'shape', name: 'shape', params: ['round', 'taper', 'taperY', 'slant', 'slantY'] },
  { id: 'lattice', name: 'lattice', params: ['diamond', 'diamonds', 'jewels'] },
  { id: 'blinds', name: 'blinds', params: ['slats', 'slatWidth', 'vertical'] },
]

export type WindowGeometry = Record<string, number | boolean>

/** A window plate's geometry: the attachment's params over the preset over WINDOW_PARAMS, clamped, in schema order. */
export function windowGeometry(def: PlateDef, params: Record<string, unknown>): WindowGeometry {
  const out: WindowGeometry = {}
  for (const [k, spec] of Object.entries(WINDOW_PARAMS)) {
    const raw = params[k] ?? def.window?.[k] ?? spec.default
    if (spec.type === 'boolean') {
      out[k] = raw === true || raw === 'true' || raw === 1
      continue
    }
    let v = Number(raw)
    if (!Number.isFinite(v)) v = Number(def.window?.[k] ?? spec.default)
    v = Math.max(spec.min ?? v, Math.min(spec.max ?? v, v))
    out[k] = spec.type === 'integer' ? Math.round(v) : Math.round(v * 10000) / 10000
  }
  return out
}

// ── geometry helpers ─────────────────────────────────────────────────────────

/** Clips a polygon by a convex polygon (both counter-clockwise or both clockwise does not matter: the clipper's edges are used as half planes facing its centroid). */
export function clipConvex(subject: Pt[], clipper: Pt[]): Pt[] {
  let out = subject
  const n = clipper.length
  const cx = clipper.reduce((s, p) => s + p[0], 0) / n, cy = clipper.reduce((s, p) => s + p[1], 0) / n
  for (let i = 0; i < n && out.length; i++) {
    const a = clipper[i], b = clipper[(i + 1) % n]
    let nx = b[1] - a[1], ny = -(b[0] - a[0])
    // the half plane n·p ≤ c must hold the centroid
    let c = nx * a[0] + ny * a[1]
    if (nx * cx + ny * cy > c) {
      nx = -nx
      ny = -ny
      c = -c
    }
    out = clipHalf(out, [nx, ny], c)
  }
  return out
}

const rectPts = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]

/** An ellipse (or the part of it above y = cy when `half`) as a convex polygon. */
function ellipsePts(cx: number, cy: number, rx: number, ry: number, half = false, n = 64): Pt[] {
  const pts: Pt[] = []
  if (half) {
    for (let i = 0; i <= n; i++) {
      const a = Math.PI + (i / n) * Math.PI
      pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)])
    }
    return pts
  }
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)])
  }
  return pts
}

/** The polygon's area (absolute). */
function area(p: Pt[]): number {
  let s = 0
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length]
    s += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(s) / 2
}

/** The 3 × 3 homography (row major, h[8] = 1) that maps the four `src` points onto the four `dst` points. */
export function homography(src: Pt[], dst: Pt[]): number[] {
  const A: number[][] = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  // Gauss-Jordan with partial pivoting on the 8 × 9 augmented matrix
  for (let c = 0; c < 8; c++) {
    let p = c
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    ;[A[c], A[p]] = [A[p], A[c]]
    const d = A[c][c] || 1e-12
    for (let k = c; k < 9; k++) A[c][k] /= d
    for (let r = 0; r < 8; r++) {
      if (r === c) continue
      const f = A[r][c]
      if (f) for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k]
    }
  }
  return [...A.map((row) => row[8]), 1]
}

const applyH = (h: number[], [x, y]: Pt): Pt => {
  const w = h[6] * x + h[7] * y + h[8]
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]
}

// ── the window ───────────────────────────────────────────────────────────────

/** Bar widths in plate units from the 0..1 params. */
export const barOf = {
  gap: (v: number) => MIN_BAR + v * 0.054,
  frame: (v: number) => v * 0.16,
  mullion: (v: number) => v * 0.16,
}

/**
 * Draws a window from its geometry: cut polygons for every pane (or slat, or lattice cell), metal and cut squares for
 * the inner squares, all mapped through the perspective homography.
 */
export function drawWindow(g: WindowGeometry): Shape[] {
  const n = (k: string) => Number(g[k])
  const b = (k: string) => g[k] === true
  const gap = barOf.gap(n('gap'))
  const frame = barOf.frame(n('frame'))
  const mull = Math.max(gap, barOf.mullion(n('mullion')))
  const W = n('width') * 2, H = n('height') * 2
  const round = b('round')
  const arch = b('arch') && !round
  const archRise = arch ? n('archHeight') * (W / 2) : 0
  // the flat box: x −a..a, y top..bottom, centred on the plate
  const a = W / 2
  const top = -(H + archRise) / 2, bottom = (H + archRise) / 2
  const spring = top + archRise
  // perspective: the box corners go to a quad
  const hb = (bottom - top) / 2, yc = (top + bottom) / 2
  const wt = a * (1 + 0.5 * n('taper')), wb = a * (1 - 0.5 * n('taper'))
  const hl = hb * (1 - 0.5 * n('taperY')), hr = hb * (1 + 0.5 * n('taperY'))
  const dx = n('slant') * a * 0.5, dy = n('slantY') * hb * 0.5
  const box: Pt[] = [[-a, top], [a, top], [a, bottom], [-a, bottom]]
  const quad: Pt[] = [[-wt + dx, yc - hl + dy], [wt + dx, yc - hr - dy], [wb - dx, yc + hr - dy], [-wb - dx, yc + hl + dy]]
  const h = homography(box, quad)

  const cuts: Pt[][] = []
  const jewelMetal: Pt[][] = []
  const jewelCut: Pt[][] = []

  // the glass area: inside the frame
  const x0 = -a + frame, x1 = a - frame
  const outline: Pt[] | null = round ? ellipsePts(0, yc, Math.max(0.01, a - frame), Math.max(0.01, hb - frame)) : null
  const bodyTop = arch ? spring + gap / 2 : top + frame
  const bodyBottom = bottom - frame

  // sashes side by side, each a grid of panes
  const sashes = Math.max(1, n('sashes'))
  const sashW = (x1 - x0 - (sashes - 1) * mull) / sashes
  const cols = Math.max(1, n('cols')), rows = Math.max(1, n('rows'))
  for (let s = 0; s < sashes && sashW > 0.004; s++) {
    const sx0 = x0 + s * (sashW + mull), sx1 = sx0 + sashW
    const pw = (sashW - (cols - 1) * gap) / cols
    const ph = (bodyBottom - bodyTop - (rows - 1) * gap) / rows
    if (pw <= 0.003 || ph <= 0.003) continue
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const px0 = sx0 + c * (pw + gap), py0 = bodyTop + r * (ph + gap)
        let pane = rectPts(px0, py0, px0 + pw, py0 + ph)
        if (outline) pane = clipConvex(pane, outline)
        if (pane.length < 3 || area(pane) < 1e-5) continue
        paneFill(pane, [sx0, sx1], [bodyTop, bodyBottom])
      }
    }
  }

  // the arch head: one opening, or sectors between spokes round an optional hub
  if (arch && archRise > 0.01) {
    const rx = a - frame, ry = Math.max(0.01, archRise - frame - gap / 2)
    const cy = spring - gap / 2
    const head = ellipsePts(0, cy, rx, ry, true)
    const spokes = n('spokes')
    const hub = n('hub')
    const sectors = spokes + 1
    for (let k = 0; k < sectors; k++) {
      let p = head
      // the wedge between spoke k and k + 1, each side moved in by half a bar
      for (const [ang, side] of [[Math.PI + (k / sectors) * Math.PI, 1], [Math.PI + ((k + 1) / sectors) * Math.PI, -1]] as const) {
        if ((side === 1 && k === 0) || (side === -1 && k === sectors - 1)) continue
        // the spoke runs from the centre at angle `ang`; keep the side towards the wedge
        const nx = -Math.sin(ang) * side, ny = Math.cos(ang) * side
        p = clipHalf(p, [-nx, -ny], -(nx * 0 + ny * cy) - gap / 2)
      }
      if (p.length >= 3 && area(p) > 1e-5) cuts.push(p)
    }
    if (hub > 0.01 && spokes > 0) {
      jewelMetal.push(ellipsePts(0, cy, rx * hub + gap / 2, ry * hub + gap / 2, true))
      const inner = ellipsePts(0, cy, Math.max(0.005, rx * hub - gap / 2), Math.max(0.005, ry * hub - gap / 2), true)
      // the hub's own opening stays above its sill bar
      const sill = clipHalf(inner, [0, 1], cy - 0.0001)
      if (sill.length >= 3) jewelCut.push(sill)
    }
  }

  /** Fills one pane: plain glass, slats, or a diamond lattice (with inner squares). */
  function paneFill(pane: Pt[], sx: [number, number], sy: [number, number]) {
    const slats = n('slats')
    if (slats > 0) {
      const vertical = b('vertical')
      const xs = pane.map((p) => p[0]), ys = pane.map((p) => p[1])
      const lo = vertical ? Math.min(...xs) : Math.min(...ys)
      const hi = vertical ? Math.max(...xs) : Math.max(...ys)
      const pitch = (hi - lo) / slats
      const bar = Math.max(MIN_BAR, pitch * n('slatWidth'))
      const open = pitch - bar
      if (open < 0.003) return
      for (let i = 0; i < slats; i++) {
        // the first and last slots sit half a bar in from the pane edges
        const s0 = lo + i * pitch + bar / 2, s1 = s0 + open
        const strip: Pt[] = vertical ? rectPts(s0, -9, s1, 9) : rectPts(-9, s0, 9, s1)
        const p = clipConvex(strip, pane)
        if (p.length >= 3 && area(p) > 1e-6) cuts.push(p)
      }
      return
    }
    if (!b('diamond')) {
      cuts.push(pane)
      return
    }
    // diamonds: squares turned 45°, `diamonds` across a sash, centred on the sash
    const d = (sx[1] - sx[0]) / Math.max(1, n('diamonds'))
    const lb = Math.max(MIN_BAR, gap * 0.7)
    const half = d / 2 - lb / Math.SQRT2
    if (half < 0.004) {
      cuts.push(pane)
      return
    }
    const ox = (sx[0] + sx[1]) / 2, oy = (sy[0] + sy[1]) / 2
    const xs = pane.map((p) => p[0]), ys = pane.map((p) => p[1])
    const i0 = Math.floor((Math.min(...xs) - ox) / d) - 1, i1 = Math.ceil((Math.max(...xs) - ox) / d) + 1
    const j0 = Math.floor((Math.min(...ys) - oy) / d) - 1, j1 = Math.ceil((Math.max(...ys) - oy) / d) + 1
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        for (const off of [0, 0.5]) {
          const cx = ox + (i + off) * d, cy = oy + (j + off) * d
          const dia: Pt[] = [[cx, cy - half], [cx + half, cy], [cx, cy + half], [cx - half, cy]]
          const p = clipConvex(dia, pane)
          if (p.length >= 3 && area(p) > 1e-6) cuts.push(p)
        }
      }
    }
    if (!b('jewels')) return
    // inner squares: a framed square on every other lattice crossing, its frame tied to the four bars that meet there
    const js = d * 0.3
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if ((((i + j) % 2) + 2) % 2) continue
        const cx = ox + (i + 0.5) * d, cy = oy + j * d
        const sq = (r: number): Pt[] => [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]]
        const m = clipConvex(sq(js + lb * Math.SQRT2), pane)
        const c = clipConvex(sq(js), pane)
        if (c.length >= 3 && area(c) > 1e-6 && area(c) > 0.6 * (2 * js * js)) {
          jewelMetal.push(m)
          jewelCut.push(c)
        }
      }
    }
  }

  const map = (p: Pt[]) => poly(p.map((q) => applyH(h, q)))
  return [...cuts.map((p) => cut(map(p))), ...jewelMetal.map((p) => metal(map(p))), ...jewelCut.map((p) => cut(map(p)))]
}

// ── the presets ──────────────────────────────────────────────────────────────

type Preset = Omit<PlateDef, 'draw' | 'category'>
const draw: PlateDef['draw'] = (_r, params) => drawWindow(params as WindowGeometry)
const S1 = 'amaran-as-gb-m-set1.png', S4 = 'set-4-windows-closeup.png', SB = 'set-b-17-paper-plates.png'

const PRESETS: Preset[] = [
  {
    id: 'plate-grid-window', name: '6-pane grid window', description: 'two sashes side by side with a grid of panes', source: `${S1}, MO10`,
    window: { sashes: 2, cols: 2, rows: 4, gap: 0.3, width: 0.62, height: 0.44, mullion: 0.35 },
  },
  {
    id: 'plate-arched-window', name: 'arched window', description: 'a tall round-headed window with a fan light', source: `${S1}, MO11`, field: 0.9,
    window: { cols: 3, rows: 4, gap: 0.3, width: 0.34, height: 0.6, arch: true, archHeight: 1, spokes: 4, hub: 0.4 },
  },
  {
    id: 'plate-skewed-window', name: 'skewed window', description: 'a window seen at an angle, panes in perspective', source: `${S1}, MO09`,
    window: { cols: 4, rows: 5, gap: 0.22, width: 0.5, height: 0.32, taperY: 0.6, slantY: -1 },
  },
  {
    id: 'plate-palace-window', name: 'palace window', description: 'an arched window: a head split by two spokes over a grid of panes', source: `${SB}, Palace Window (88)`,
    window: { cols: 4, rows: 5, gap: 0.4, width: 0.46, height: 0.5, arch: true, archHeight: 0.72, spokes: 2 },
  },
  {
    id: 'plate-setting-sun', name: 'setting sun', description: 'a low window in perspective rising to the right, like light from a setting sun', source: `${SB}, Setting sun (75)`,
    window: { cols: 4, rows: 4, gap: 0.4, width: 0.62, height: 0.3, taperY: 0.6, slantY: 0.6 },
  },
  {
    id: 'plate-slanted-window', name: 'slanted window', description: 'a window cast at a slant, wide at the top', source: `${S4}, skewed grid window`,
    window: { cols: 4, rows: 4, gap: 0.22, width: 0.44, height: 0.46, taper: 0.8, slant: -0.55 },
  },
  {
    id: 'plate-tall-grid-window', name: 'tall grid window', description: 'a tall window of five by five panes', source: `${S4}, 4×6 grid window (the photo shows 5 × 5 panes)`,
    window: { cols: 5, rows: 5, gap: 0.2, width: 0.42, height: 0.64 },
  },
  {
    id: 'plate-diamond-window', name: 'diamond lattice window', description: 'three sashes of leaded diamond panes', source: `${S4}, diamond-lattice triple window`,
    window: { sashes: 3, gap: 0.08, width: 0.68, height: 0.42, mullion: 0.4, diamond: true, diamonds: 4 },
  },
  {
    id: 'plate-window-grid-iii', name: 'window grid III', description: 'a round lattice of diamonds with framed inner squares', source: `${SB}, Window grid III (56)`,
    window: { gap: 0.3, width: 0.84, height: 0.84, round: true, diamond: true, diamonds: 7, jewels: true },
  },
  {
    id: 'plate-blinds', name: 'blinds', description: 'horizontal blind slats held by two ladder tapes', source: `${SB}, Blinds (9)`,
    window: { cols: 3, gap: 0.05, width: 0.55, height: 0.66, slats: 22, slatWidth: 0.42 },
  },
  {
    id: 'plate-slat-blinds', name: 'slat blinds', description: 'wide horizontal slats with thin bars between', source: `${S4}, horizontal slat blinds`,
    window: { width: 0.5, height: 0.6, slats: 12, slatWidth: 0.22 },
  },
  {
    id: 'plate-fine-vertical-lines', name: 'fine vertical lines', description: 'a field of very fine vertical lines', source: `${S4}, fine vertical lines`,
    window: { width: 0.62, height: 0.38, slats: 64, slatWidth: 0.5, vertical: true },
  },
  {
    id: 'plate-fine-horizontal-lines', name: 'fine horizontal lines', description: 'a field of very fine horizontal lines', source: `${S4}, fine horizontal lines`,
    window: { width: 0.58, height: 0.58, slats: 60, slatWidth: 0.5 },
  },
]

/** The window presets: each a plate of category `windows` whose geometry an attachment can adjust. */
export const WINDOWS: PlateDef[] = PRESETS.map((p) => ({ ...p, category: 'windows', draw }))
