/** Image textures loaded by URL (photos, scenery) and canvas text textures for the label effect. */

export interface ImageTex {
  tex: WebGLTexture
  width: number
  height: number
}

type Entry = { state: 'loading'; promise: Promise<void> } | { state: 'ok'; img: ImageTex } | { state: 'error' }

export class ImageCache {
  private map = new Map<string, Entry>()
  onLoad: (() => void) | null = null
  constructor(private gl: WebGL2RenderingContext) {}

  /** The texture when loaded; starts loading otherwise and returns null. */
  get(url: string): ImageTex | null {
    const e = this.map.get(url)
    if (e?.state === 'ok') return e.img
    if (!e) this.load(url)
    return null
  }

  /** Resolves when the URL has loaded or failed. */
  wait(url: string): Promise<void> {
    const e = this.map.get(url)
    if (!e) {
      this.load(url)
      return this.wait(url)
    }
    return e.state === 'loading' ? e.promise : Promise.resolve()
  }

  private load(url: string) {
    const promise = (async () => {
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        const svg = /svg/i.test(blob.type) || (/xml|text\/plain/i.test(blob.type) && /<svg[\s>]/i.test(await blob.slice(0, 4096).text()))
        const bmp = svg ? await svgBitmap(blob) : await createImageBitmap(blob)
        const gl = this.gl
        const tex = gl.createTexture()!
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp)
        gl.generateMipmap(gl.TEXTURE_2D)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        this.map.set(url, { state: 'ok', img: { tex, width: bmp.width, height: bmp.height } })
        bmp.close()
      } catch {
        this.map.set(url, { state: 'error' })
      }
      this.onLoad?.()
    })()
    this.map.set(url, { state: 'loading', promise })
  }

  dispose() {
    for (const e of this.map.values()) if (e.state === 'ok') this.gl.deleteTexture(e.img.tex)
    this.map.clear()
  }
}

/** Longest side an SVG rasterizes at, and the size of one without its own size. */
const SVG_MAX = 2048
const SVG_DEFAULT = 1024

/**
 * Rasterizes an SVG: createImageBitmap cannot decode SVG blobs in Chrome, so it loads through an image element and
 * draws onto a canvas (longest side SVG_MAX, or SVG_DEFAULT square when the SVG has no size).
 */
export async function svgBitmap(blob: Blob): Promise<ImageBitmap> {
  if (typeof Image === 'undefined' || typeof document === 'undefined') throw new Error('SVG needs a page to decode')
  const url = URL.createObjectURL(blob.type === 'image/svg+xml' ? blob : new Blob([blob], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((done, fail) => {
      img.onload = () => done()
      img.onerror = () => fail(new Error('The SVG could not be decoded'))
      img.src = url
    })
    const { width, height } = svgSize(img.naturalWidth, img.naturalHeight)
    const c = document.createElement('canvas')
    c.width = width
    c.height = height
    c.getContext('2d')!.drawImage(img, 0, 0, width, height)
    return await createImageBitmap(c)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The raster size of an SVG with natural size w × h. */
export function svgSize(w: number, h: number): { width: number; height: number } {
  if (!(w > 0) || !(h > 0)) return { width: SVG_DEFAULT, height: SVG_DEFAULT }
  const k = SVG_MAX / Math.max(w, h)
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) }
}

/** Uploads canvases / bitmaps into textures that live as long as their key is used. */
export class DynamicTextures {
  private map = new Map<string, { tex: WebGLTexture; src: unknown }>()
  constructor(private gl: WebGL2RenderingContext) {}

  upload(key: string, src: TexImageSource): WebGLTexture {
    const gl = this.gl
    let e = this.map.get(key)
    if (!e) {
      const tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      e = { tex, src: null }
      this.map.set(key, e)
    }
    if (e.src !== src) {
      gl.bindTexture(gl.TEXTURE_2D, e.tex)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      e.src = src
    }
    return e.tex
  }

  prune(keep: Set<string>) {
    for (const [k, e] of this.map) if (!keep.has(k)) {
      this.gl.deleteTexture(e.tex)
      this.map.delete(k)
    }
  }

  dispose() {
    this.prune(new Set())
  }
}

/** A 2D canvas with centred text, top row first, cached by its inputs. */
export function makeTextCanvas(text: string, sizePx: number, color: string, width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  const cv: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height })
  const ctx = cv.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) return cv
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  let size = Math.max(4, sizePx)
  ctx.font = `${size}px 'Share Tech Mono', 'Roboto Mono', ui-monospace, monospace`
  const w = ctx.measureText(text).width
  if (w > width * 0.94) {
    size *= (width * 0.94) / w
    ctx.font = `${size}px 'Share Tech Mono', 'Roboto Mono', ui-monospace, monospace`
  }
  ctx.fillText(text, width / 2, height / 2)
  return cv
}

/** Looping, muted videos (media layers); each get() uploads the current frame. Not deterministic: videos play on their own clock. */
export class VideoCache {
  private map = new Map<string, { el: HTMLVideoElement; tex: WebGLTexture; ready: boolean; promise: Promise<void> }>()
  onLoad: (() => void) | null = null
  constructor(private gl: WebGL2RenderingContext) {}

  get(url: string): ImageTex | null {
    if (typeof document === 'undefined') return null
    let e = this.map.get(url)
    if (!e) e = this.load(url)
    if (!e.ready || e.el.readyState < 2) return null
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, e.tex)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, e.el)
    } catch {
      return null
    }
    return { tex: e.tex, width: e.el.videoWidth, height: e.el.videoHeight }
  }

  wait(url: string): Promise<void> {
    if (typeof document === 'undefined') return Promise.resolve()
    return (this.map.get(url) ?? this.load(url)).promise
  }

  private load(url: string) {
    const gl = this.gl
    const el = document.createElement('video')
    el.muted = true
    el.loop = true
    el.playsInline = true
    el.crossOrigin = 'anonymous'
    el.preload = 'auto'
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const entry = { el, tex, ready: false, promise: Promise.resolve() }
    entry.promise = new Promise<void>((done) => {
      const ok = () => {
        entry.ready = true
        el.play().catch(() => {})
        this.onLoad?.()
        done()
      }
      el.addEventListener('loadeddata', ok, { once: true })
      el.addEventListener('error', () => done(), { once: true })
    })
    el.src = url
    this.map.set(url, entry)
    return entry
  }

  dispose() {
    for (const e of this.map.values()) {
      e.el.pause()
      e.el.removeAttribute('src')
      this.gl.deleteTexture(e.tex)
    }
    this.map.clear()
  }
}

/**
 * A numbered test grid for solo (protocol §12): white lines on black, 8 × 8 cells, the diagonals, a centre ring and
 * the face's number and name, so you can check a face's warp on the real object.
 */
export function makeGridCanvas(n: number, name: string, width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  const cv: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height })
  const ctx = cv.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) return cv
  ctx.fillStyle = 'rgb(0,0,0)'
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = 'rgb(255,255,255)'
  const lw = Math.max(1, Math.round(Math.min(width, height) / 220))
  ctx.lineWidth = lw
  ctx.beginPath()
  for (let i = 1; i < 8; i++) {
    const x = Math.round((i * width) / 8) + 0.5
    const y = Math.round((i * height) / 8) + 0.5
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
  }
  ctx.moveTo(0, 0)
  ctx.lineTo(width, height)
  ctx.moveTo(width, 0)
  ctx.lineTo(0, height)
  ctx.stroke()
  ctx.lineWidth = lw * 3
  ctx.strokeRect(lw * 1.5, lw * 1.5, width - lw * 3, height - lw * 3)
  const r = Math.min(width, height) * 0.22
  ctx.beginPath()
  ctx.arc(width / 2, height / 2, r, 0, Math.PI * 2)
  ctx.fillStyle = 'rgb(0,0,0)'
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = 'rgb(255,255,255)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${Math.round(r * 1.1)}px 'Share Tech Mono', 'Roboto Mono', ui-monospace, monospace`
  ctx.fillText(String(n), width / 2, height / 2 - r * 0.08)
  ctx.font = `${Math.max(10, Math.round(r * 0.22))}px 'Share Tech Mono', 'Roboto Mono', ui-monospace, monospace`
  ctx.fillText(name, width / 2, height / 2 + r * 0.62, r * 1.7)
  // an arrow in the top left: which corner is uv (0, 0)
  ctx.beginPath()
  const a = Math.min(width, height) * 0.12
  ctx.moveTo(lw * 4, lw * 4)
  ctx.lineTo(lw * 4 + a, lw * 4)
  ctx.lineTo(lw * 4, lw * 4 + a)
  ctx.closePath()
  ctx.fill()
  return cv
}
