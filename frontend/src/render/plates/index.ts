/**
 * Metal gobo plates (protocol §15 and §16): every attachment is a plate. Vector cut-outs, rasterized into a mask texture
 * (PLATE_TEXTURE px square) that the attachment shader samples, so focus, rotation, scale and throw apply as for every
 * attachment. Each design follows a reference photo in design/refs/gobo-plates (`source`). Parametric windows
 * (windows.ts) redraw when their geometry params change. `docs/guides/static-light.md` says how to add one.
 */
import { rng, type Shape } from './geom'
import { REFS_A23 } from './refsA23'
import { REFS_B } from './refsB'
import { REPLICAS } from './replicas'
import type { PlateCategory, PlateDef } from './types'
import { WINDOWS, windowGeometry } from './windows'

export type { PlateCategory, PlateDef } from './types'
export type { Shape } from './geom'
export { WINDOW_PARAMS, windowGeometry } from './windows'

/** The browser's groups, in order (catalog `goboCategories`). */
export const PLATE_CATEGORIES: Array<{ id: PlateCategory; name: string }> = [
  { id: 'windows', name: 'windows' },
  { id: 'nature', name: 'nature' },
  { id: 'sky', name: 'sky' },
  { id: 'patterns', name: 'patterns' },
  { id: 'beams', name: 'beams' },
]

/** Every plate, grouped by category in browser order. */
export const PLATES: PlateDef[] = PLATE_CATEGORIES.flatMap((c) => [...WINDOWS, ...REPLICAS, ...REFS_A23, ...REFS_B].filter((p) => p.category === c.id))
export const PLATE_IDS = PLATES.map((p) => p.id)
const byId = new Map(PLATES.map((p) => [p.id, p]))
export const plateDef = (id: string): PlateDef | undefined => byId.get(id)

/** The round light field's radius in plate units. */
export const plateField = (def: PlateDef) => def.field ?? 0.84

/** The mask texture size (px, square). */
export const PLATE_TEXTURE = 4096

/**
 * The key of a plate's drawing: its id, and for a parametric window the geometry it is drawn with (the attachment's
 * params over the preset). Two attachments with the same key share one mask texture.
 */
export function plateKey(def: PlateDef, params: Record<string, unknown> = {}): string {
  if (!def.window) return def.id
  return `${def.id}|${JSON.stringify(windowGeometry(def, params))}`
}

const shapeCache = new Map<string, Shape[]>()
/** A plate's shapes (drawn with its seed; a window with its geometry). The newest 64 drawings are kept. */
export function plateShapes(def: PlateDef, params: Record<string, unknown> = {}): Shape[] {
  const key = plateKey(def, params)
  let s = shapeCache.get(key)
  if (!s) {
    s = def.draw(rng(def.seed ?? 1), def.window ? windowGeometry(def, params) : params)
    shapeCache.set(key, s)
    if (shapeCache.size > 64) shapeCache.delete(shapeCache.keys().next().value as string)
  }
  return s
}

/** How a plate's field sits in the frame: param `field` of a plate attachment. */
export const FIELD_MODES = ['round', 'fill', 'stretch', 'tile'] as const
export type FieldMode = (typeof FIELD_MODES)[number]
export const fieldCode = (v: unknown) => Math.max(0, FIELD_MODES.indexOf(v as FieldMode))

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/**
 * Paints a plate's openings into a square 2D context of `size` px: black metal, white where light passes. Plate space
 * -1…1 fills the square. Nothing is clipped to the field: the shader clips in round mode, fill and tile use it all.
 */
export function paintPlate(ctx: Ctx2D, def: PlateDef, size: number, params: Record<string, unknown> = {}) {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = 'rgb(0,0,0)'
  ctx.fillRect(0, 0, size, size)
  ctx.setTransform(size / 2, 0, 0, size / 2, size / 2, size / 2)
  for (const s of plateShapes(def, params)) {
    const color = s.op === 'cut' ? 'rgb(255,255,255)' : 'rgb(0,0,0)'
    const path = new Path2D(s.d)
    if (s.stroke) {
      ctx.strokeStyle = color
      ctx.lineWidth = s.stroke
      ctx.lineCap = s.cap ?? 'round'
      ctx.lineJoin = s.join ?? 'round'
      ctx.stroke(path)
    } else {
      ctx.fillStyle = color
      ctx.fill(path, s.rule ?? 'nonzero')
    }
  }
  ctx.restore()
}

/** A plate's canvas (openings white on black), PLATE_TEXTURE px unless `size` says otherwise. */
export function plateCanvas(def: PlateDef, size = PLATE_TEXTURE, params: Record<string, unknown> = {}): OffscreenCanvas | HTMLCanvasElement {
  const cv: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size })
  const ctx = cv.getContext('2d') as Ctx2D | null
  if (ctx) paintPlate(ctx, def, size, params)
  return cv
}

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`)

/**
 * A plate as a standalone SVG (viewBox -1 -1 2 2): `mask` is the openings white on black clipped to the round field
 * (what the light passes), `metal` the plate itself, a grey disc with the cut-outs showing `hole`.
 */
export function plateSvg(def: PlateDef, view: 'mask' | 'metal' = 'mask', hole = 'rgb(255,255,255)', params: Record<string, unknown> = {}): string {
  const field = plateField(def)
  const paint = plateShapes(def, params)
    .map((s) => {
      const c = s.op === 'cut' ? 'rgb(255,255,255)' : 'rgb(0,0,0)'
      return s.stroke
        ? `<path d="${s.d}" fill="none" stroke="${c}" stroke-width="${s.stroke}" stroke-linecap="${s.cap ?? 'round'}" stroke-linejoin="${s.join ?? 'round'}"/>`
        : `<path d="${s.d}" fill="${c}" fill-rule="${s.rule ?? 'nonzero'}"/>`
    })
    .join('')
  const openings = `<mask id="o" maskUnits="userSpaceOnUse" x="-1" y="-1" width="2" height="2"><rect x="-1" y="-1" width="2" height="2" fill="rgb(0,0,0)"/><g clip-path="url(#f)">${paint}</g></mask>`
  const defs = `<defs><clipPath id="f"><circle r="${field}"/></clipPath>${openings}<linearGradient id="g" x1="0" y1="-1" x2="0" y2="1"><stop offset="0" stop-color="#a9a9a7"/><stop offset="0.5" stop-color="#8f8f8d"/><stop offset="1" stop-color="#9d9d9b"/></linearGradient></defs>`
  const body =
    view === 'mask'
      ? `<rect x="-1" y="-1" width="2" height="2" fill="rgb(0,0,0)"/><rect x="-1" y="-1" width="2" height="2" fill="rgb(255,255,255)" mask="url(#o)"/>`
      : `<circle r="0.995" fill="url(#g)"/><circle r="0.97" fill="none" stroke="#b8b8b6" stroke-width="0.012"/><rect x="-1" y="-1" width="2" height="2" fill="${hole}" mask="url(#o)"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 2 2"><title>${esc(def.name)}</title>${defs}${body}</svg>`
}
