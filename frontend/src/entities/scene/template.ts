/**
 * Template round trip (protocol §12 Atlas): the object's atlas as a PNG and an SVG at its true pixel size with face
 * outlines and names, and one PNG per face, zipped. Built in the browser; nothing goes to the server.
 */
import { applyAffine, atlasAffines, surfaceGeometry, type Affine } from '../../render'
import type { Atlas, Point, Scene, SceneObject } from './types'

interface Shape {
  id: string
  name: string
  detail: boolean
  /** outline in atlas px */
  pts: Array<[number, number]>
  aff: Affine
}

/** Every surface of the object with a place in the atlas, as atlas-px outlines. */
export function atlasShapes(scene: Scene, obj: SceneObject, atlas: Atlas): Shape[] {
  const affs = atlasAffines(scene, obj, atlas)
  const pts = new Map<string, Point>(scene.points.map((p) => [p.id, p]))
  const out: Shape[] = []
  for (const s of obj.surfaces) {
    const aff = affs.get(s.id)
    if (!aff) continue
    const g = surfaceGeometry(s, pts)
    const uv = g && g.outlineUv.length >= 3 ? g.outlineUv : ([[0, 0], [1, 0], [1, 1], [0, 1]] as Array<[number, number]>)
    out.push({ id: s.id, name: s.name, detail: !!s.parentId, pts: uv.map(([u, v]) => applyAffine(aff, u, v)), aff })
  }
  return out
}

const FONT = `'Share Tech Mono', 'Roboto Mono', ui-monospace, monospace`

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

/** The atlas template: faces filled dark grey, white outlines, names, details dashed. */
export function templateCanvas(scene: Scene, obj: SceneObject, atlas: Atlas): HTMLCanvasElement {
  const c = canvas(atlas.width, atlas.height)
  const ctx = c.getContext('2d')!
  const shapes = atlasShapes(scene, obj, atlas)
  const lw = Math.max(1, Math.round(Math.max(atlas.width, atlas.height) / 400))
  for (const sh of shapes) {
    ctx.beginPath()
    sh.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.closePath()
    if (!sh.detail) {
      ctx.fillStyle = 'rgb(38,38,40)'
      ctx.fill()
    }
    ctx.setLineDash(sh.detail ? [lw * 4, lw * 3] : [])
    ctx.strokeStyle = 'rgb(255,255,255)'
    ctx.lineWidth = lw
    ctx.stroke()
  }
  ctx.setLineDash([])
  for (const sh of shapes) {
    if (sh.detail) continue
    const [cx, cy] = applyAffine(sh.aff, 0.5, 0.5)
    const size = Math.max(10, Math.min(Math.hypot(...sh.aff.u), Math.hypot(...sh.aff.v)) / 7)
    ctx.font = `${Math.round(size)}px ${FONT}`
    ctx.fillStyle = 'rgb(255,255,255)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(sh.name, cx, cy)
    // the face's top edge (uv v = 0) gets a small tick so artwork lands the right way up
    const a = applyAffine(sh.aff, 0.45, 0.04)
    const b = applyAffine(sh.aff, 0.55, 0.04)
    ctx.beginPath()
    ctx.moveTo(a[0], a[1])
    ctx.lineTo(b[0], b[1])
    ctx.lineWidth = lw * 3
    ctx.stroke()
  }
  return c
}

export function templateSvg(scene: Scene, obj: SceneObject, atlas: Atlas): string {
  const shapes = atlasShapes(scene, obj, atlas)
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const lw = Math.max(1, Math.round(Math.max(atlas.width, atlas.height) / 400))
  const body = shapes
    .map((sh) => {
      const poly = `<polygon id="${esc(sh.id)}" points="${sh.pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" fill="${sh.detail ? 'none' : '#262628'}" stroke="#ffffff" stroke-width="${lw}"${sh.detail ? ` stroke-dasharray="${lw * 4} ${lw * 3}"` : ''}/>`
      if (sh.detail) return poly
      const [cx, cy] = applyAffine(sh.aff, 0.5, 0.5)
      const size = Math.max(10, Math.min(Math.hypot(...sh.aff.u), Math.hypot(...sh.aff.v)) / 7)
      return `${poly}<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" font-family="monospace" font-size="${Math.round(size)}" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${esc(sh.name)}</text>`
    })
    .join('\n  ')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${atlas.width}" height="${atlas.height}" viewBox="0 0 ${atlas.width} ${atlas.height}">\n  <title>${esc(obj.name)} template ${atlas.width}x${atlas.height}</title>\n  ${body}\n</svg>\n`
}

/** One face's template in its own uv frame (the frame a face layer uses), at its size in the atlas. */
export function faceTemplateCanvas(scene: Scene, obj: SceneObject, atlas: Atlas, surfaceId: string): HTMLCanvasElement | null {
  const shapes = atlasShapes(scene, obj, atlas)
  const face = shapes.find((x) => x.id === surfaceId)
  if (!face) return null
  const w = Math.hypot(...face.aff.u)
  const h = Math.hypot(...face.aff.v)
  const c = canvas(w, h)
  const ctx = c.getContext('2d')!
  // atlas px → this face's uv → canvas px
  const det = face.aff.u[0] * face.aff.v[1] - face.aff.u[1] * face.aff.v[0]
  const toUv = (x: number, y: number): [number, number] => {
    const dx = x - face.aff.o[0], dy = y - face.aff.o[1]
    return [((dx * face.aff.v[1] - dy * face.aff.v[0]) / det) * c.width, ((face.aff.u[0] * dy - face.aff.u[1] * dx) / det) * c.height]
  }
  const lw = Math.max(1, Math.round(Math.max(c.width, c.height) / 300))
  for (const sh of shapes) {
    if (sh.id !== surfaceId && !(sh.detail && obj.surfaces.find((x) => x.id === sh.id)?.parentId === surfaceId)) continue
    ctx.beginPath()
    sh.pts.map(([x, y]) => toUv(x, y)).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.closePath()
    if (sh.id === surfaceId) {
      ctx.fillStyle = 'rgb(38,38,40)'
      ctx.fill()
    }
    ctx.setLineDash(sh.detail ? [lw * 4, lw * 3] : [])
    ctx.strokeStyle = 'rgb(255,255,255)'
    ctx.lineWidth = lw * 2
    ctx.stroke()
  }
  ctx.setLineDash([])
  ctx.font = `${Math.max(10, Math.round(Math.min(c.width, c.height) / 7))}px ${FONT}`
  ctx.fillStyle = 'rgb(255,255,255)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(face.name, c.width / 2, c.height / 2)
  return c
}

export const canvasPng = (c: HTMLCanvasElement) => new Promise<Blob>((done, fail) => c.toBlob((b) => (b ? done(b) : fail(new Error('PNG encoding failed'))), 'image/png'))

// ── a store-only ZIP ─────────────────────────────────────────────────────────

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(b: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Packs files into a ZIP without compression (PNGs are compressed already). */
export function zipStore(files: Array<{ name: string; data: Uint8Array }>): Blob {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const crc = crc32(f.data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(8, 0, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, f.data.length, true)
    local.setUint32(22, f.data.length, true)
    local.setUint16(26, name.length, true)
    parts.push(new Uint8Array(local.buffer), name, f.data)
    const cen = new DataView(new ArrayBuffer(46))
    cen.setUint32(0, 0x02014b50, true)
    cen.setUint16(4, 20, true)
    cen.setUint16(6, 20, true)
    cen.setUint32(16, crc, true)
    cen.setUint32(20, f.data.length, true)
    cen.setUint32(24, f.data.length, true)
    cen.setUint16(28, name.length, true)
    cen.setUint32(42, offset, true)
    central.push(new Uint8Array(cen.buffer), name)
    offset += 30 + name.length + f.data.length
  }
  const cenSize = central.reduce((a, b) => a + b.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, cenSize, true)
  end.setUint32(16, offset, true)
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: 'application/zip' })
}

/** Starts a download of a blob. */
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** A safe file name stem. */
export const fileStem = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'object'
