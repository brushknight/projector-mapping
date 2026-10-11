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
        const bmp = await createImageBitmap(await res.blob())
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
