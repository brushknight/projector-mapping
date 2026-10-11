/**
 * The WebGL2 engine: a deterministic render(input) used by the output, the editor stage, previews and agent renders.
 *
 *   backdrop layers ─► layer target ─► (dual-Kawase blur) ─► blend onto the scene target
 *   surfaces: effects ─► content target (UV space) ─► warp onto the scene target (stencil for details, masks)
 *   outline flash ─► overlay target
 *   final pass ─► canvas: orientation + flips (physical), master, blackout, test pattern, overlay, calibration
 */
import { layerParamSchema } from '../entities/catalog/layers'
import { resolveParams } from '../entities/effect/params'
import type { EffectDef, ParamSchema } from '../entities/effect/types'
import { allLayers, onAirPlan } from '../entities/scene/lib'
import type { Layer, Point, Scene, Surface } from '../entities/scene/types'
import { BUILTINS } from './effects/builtins'
import { makeDrawingCanvas, parseStrokes, strokesKey } from './effects/drawing'
import { BUILTIN_SCHEMAS } from './effects/builtinSchemas'
import { JsEffects } from './effects/jsRuntime'
import { cleanLog, MAX_OUTLINE, paramUniforms, paramValue, wrapEffect, type ParamUniform } from './effects/wrap'
import { fbm1 } from './math/hash'
import { lightFx } from './fx'
import { bindTarget, createProgram, DynMesh, fullscreenVao, GLProgram, ShaderError, TargetPool, type Target } from './gl/gl'
import { hexToRgb, kelvinToRgb, lightRgb, type RGB } from './math/color'
import { strokePolyline, surfaceGeometry, capOutline, type SurfaceGeometry } from './math/geometry'
import { hashString01 } from './math/hash'
import { toGlMat3 } from './math/homography'
import { ORIENTATION_CODE, sceneSizeOf } from './math/orientation'
import { BLIT_FS, FINAL_FS, FULLSCREEN_VS, KAWASE_DOWN_FS, KAWASE_UP_FS, WARP_FS, WARP_VS } from './shaders/passes'
import { GOBO_IDS, KIND_CODE, LAYER_FS, PROCEDURAL_IDS } from './shaders/layer'
import { DynamicTextures, ImageCache, makeTextCanvas } from './textures'
import { evaluateTimeline, type ActiveClip } from './timeline'
import type { EffectError, RenderInput, RendererOptions } from './types'

const BLEND_CODE = { normal: 0, multiply: 1, screen: 2, add: 3 } as const
const TEST_CODE = { off: 0, grid: 1, white: 2, crosshair: 3, corners: 4 } as const
const CONTENT_MAX = 1024

type EffectProgram = { prog: GLProgram; uniforms: ParamUniform[]; text: boolean; drawing: boolean } | { error: string }

interface EffectLayer {
  inst: string
  effect: string
  params: Record<string, unknown>
  progress: number
  alpha: number
  time: number
}

/** The URL of a photo layer's image. */
export function photoUrl(ref: string, resolve?: (ref: string) => string): string {
  if (resolve) return resolve(ref)
  if (ref.startsWith('asset:')) return `/a/${ref.slice(6)}`
  return `/catalog/assets/scenery/${ref}.jpg`
}

/** The scene framebuffer size: the authored size, capped on the longest side. */
export function sceneTargetSize(input: Pick<RenderInput, 'setup'>, maxSceneSize?: number): { width: number; height: number } {
  const s = sceneSizeOf(input.setup)
  const w = Math.max(1, s.width), h = Math.max(1, s.height)
  const cap = maxSceneSize && maxSceneSize > 0 ? Math.min(1, maxSceneSize / Math.max(w, h)) : 1
  return { width: Math.max(1, Math.round(w * cap)), height: Math.max(1, Math.round(h * cap)) }
}

export class Renderer {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas
  readonly opts: RendererOptions
  onEffectError: ((e: EffectError) => void) | null = null
  /** called when an async resource (image, JS frame) arrives, so an idle caller can re-render */
  onInvalidate: (() => void) | null = null

  private gl: WebGL2RenderingContext
  private pool: TargetPool
  private fsVao: WebGLVertexArrayObject
  private mesh: DynMesh
  private layerProg: GLProgram
  private downProg: GLProgram
  private upProg: GLProgram
  private blitProg: GLProgram
  private warpProg: GLProgram
  private finalProg: GLProgram
  private effectProgs = new Map<string, EffectProgram>()
  private errors = new Map<string, string>()
  private images: ImageCache
  private dyn: DynamicTextures
  private textCanvases = new Map<string, OffscreenCanvas | HTMLCanvasElement>()
  private drawCanvases = new Map<string, { key: string; canvas: OffscreenCanvas | HTMLCanvasElement }>()
  private js = new JsEffects()
  private m3 = new Float32Array(9)
  private outlineBuf = new Float32Array(MAX_OUTLINE * 2)
  private stopColors = new Float32Array(24)
  private stopPos = new Float32Array(8)
  private blackTex: WebGLTexture

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, opts: RendererOptions) {
    this.canvas = canvas
    this.opts = opts
    const gl = canvas.getContext('webgl2', {
      preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
      antialias: false,
      alpha: false,
      premultipliedAlpha: true,
      stencil: false,
      depth: false,
    }) as WebGL2RenderingContext | null
    if (!gl) throw new Error('WebGL2 is not available')
    this.gl = gl
    this.pool = new TargetPool(gl)
    this.fsVao = fullscreenVao(gl)
    this.mesh = new DynMesh(gl)
    this.layerProg = createProgram(gl, FULLSCREEN_VS, LAYER_FS)
    this.downProg = createProgram(gl, FULLSCREEN_VS, KAWASE_DOWN_FS)
    this.upProg = createProgram(gl, FULLSCREEN_VS, KAWASE_UP_FS)
    this.blitProg = createProgram(gl, FULLSCREEN_VS, BLIT_FS)
    this.warpProg = createProgram(gl, WARP_VS, WARP_FS)
    this.finalProg = createProgram(gl, FULLSCREEN_VS, FINAL_FS)
    this.images = new ImageCache(gl)
    this.images.onLoad = () => this.onInvalidate?.()
    this.dyn = new DynamicTextures(gl)
    this.js.onError = (key, message) => this.reportError(key.split('|')[0], message)
    this.js.onFrame = () => this.onInvalidate?.()
    this.blackTex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.blackTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]))
  }

  /** Sets the drawing buffer size in device pixels. */
  setSize(width: number, height: number) {
    width = Math.max(1, Math.round(width))
    height = Math.max(1, Math.round(height))
    if (this.canvas.width !== width) this.canvas.width = width
    if (this.canvas.height !== height) this.canvas.height = height
  }

  effectErrors(): EffectError[] {
    return [...this.errors].map(([effectId, message]) => ({ effectId, message }))
  }

  private reportError(effectId: string, message: string) {
    if (this.errors.get(effectId) === message) return
    this.errors.set(effectId, message)
    this.onEffectError?.({ effectId, message })
  }

  // ── public render ──────────────────────────────────────────────────────────

  render(input: RenderInput) {
    const gl = this.gl
    const S = sceneTargetSize(input, this.opts.maxSceneSize)
    const scene = this.pool.get('scene', S.width, S.height, true)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.STENCIL_TEST)
    gl.disable(gl.SCISSOR_TEST)
    bindTarget(gl, scene)
    gl.clearColor(0, 0, 0, 1)
    gl.clearStencil(0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT)

    const plan = input.scene ? this.plan(input, input.scene) : null
    if (input.scene && plan && !input.hideBackdrop) this.renderBackdrop(input, plan.layers, plan.level, scene)

    const keep = new Set<string>()
    const dynKeep = new Set<string>()
    if (input.scene && plan?.objects && !input.hideMapping && !input.layerOnly) this.renderMapping(input, input.scene, scene, keep, dynKeep)
    this.pool.prune('content:', keep)
    for (const k of this.textCanvases.keys()) if (!dynKeep.has('text:' + k)) this.textCanvases.delete(k)
    for (const k of this.drawCanvases.keys()) if (!dynKeep.has(k)) this.drawCanvases.delete(k)
    this.dyn.prune(dynKeep)

    let overlay: Target | null = null
    if (input.scene && input.outline && input.outline.surfaceIds.length) overlay = this.renderOutline(input, input.scene, S)

    this.finalPass(input, scene, overlay, S)
  }

  /**
   * Renders one surface's content flat (unwarped) over the whole canvas: exactly the texture the warp samples for this
   * input (always-on effects plus the clips active at `t`). The editor's flat view draws on top of it. Returns false
   * when the surface has no geometry.
   */
  renderSurface(input: RenderInput, surfaceId: string): boolean {
    const gl = this.gl
    const scene = input.scene
    const keep = new Set<string>()
    const dynKeep = new Set<string>()
    let content: Target | null = null
    let found = false
    if (scene) {
      const pts = new Map<string, Point>(scene.points.map((p) => [p.id, p]))
      for (const o of scene.objects) for (const s of o.surfaces) {
        if (s.id !== surfaceId) continue
        const geo = surfaceGeometry(s, pts)
        if (!geo) continue
        found = true
        const active = evaluateTimeline(scene, input.t, input.mutedTracks).get(s.id) ?? []
        content = this.drawContent(input, s, geo, active, keep, dynKeep)
      }
    }
    this.pool.prune('content:', keep)
    for (const k of this.drawCanvases.keys()) if (!dynKeep.has(k)) this.drawCanvases.delete(k)
    bindTarget(gl, null, this.canvas.width, this.canvas.height)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (content) {
      this.setBlend('over')
      this.blit((content as Target).tex)
      this.setBlend('none')
    }
    this.dyn.prune(dynKeep)
    return found
  }

  /** Resolves when every texture and JS effect frame the input needs has arrived. */
  async ready(input: RenderInput): Promise<void> {
    const scene = input.scene
    if (!scene) return
    const waits: Promise<void>[] = []
    for (const l of this.plan(input, scene).layers) {
      if (l.kind !== 'photo') continue
      if (!l.visible && input.layerOnly !== l.id) continue
      waits.push(this.images.wait(photoUrl(l.ref, this.opts.resolveUrl)))
    }
    await Promise.all(waits)
    // a dry render queues the JS effect frames; then wait for them
    this.jsWanted = []
    this.render(input)
    const wanted = this.jsWanted
    this.jsWanted = null
    if (wanted.length) await this.js.waitFor(wanted)
  }

  private jsWanted: Array<{ inst: string; key: string }> | null = null

  /** RGBA bytes of a rectangle of the canvas, top-left origin. */
  readPixels(x: number, y: number, w: number, h: number): Uint8Array {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    const raw = new Uint8Array(w * h * 4)
    gl.readPixels(x, this.canvas.height - y - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw)
    // flip rows so row 0 is the top
    const out = new Uint8Array(w * h * 4)
    const row = w * 4
    for (let r = 0; r < h; r++) out.set(raw.subarray((h - 1 - r) * row, (h - r) * row), r * row)
    return out
  }

  /**
   * Frees GPU resources. The context itself is only lost when `loseContext` is true (throwaway canvases): a page canvas
   * may get a new Renderer later (React StrictMode mounts effects twice) and needs a live context.
   */
  dispose(loseContext = false) {
    const gl = this.gl
    this.pool.dispose()
    this.images.dispose()
    this.dyn.dispose()
    this.js.dispose()
    this.mesh.dispose()
    for (const p of this.effectProgs.values()) if ('prog' in p) gl.deleteProgram(p.prog.prog)
    for (const p of [this.layerProg, this.downProg, this.upProg, this.blitProg, this.warpProg, this.finalProg]) gl.deleteProgram(p.prog)
    gl.deleteTexture(this.blackTex)
    if (loseContext) gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private drawFullscreen() {
    const gl = this.gl
    gl.bindVertexArray(this.fsVao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  private setBlend(mode: 'none' | 'over' | Layer['blend']) {
    const gl = this.gl
    if (mode === 'none') {
      gl.disable(gl.BLEND)
      return
    }
    gl.enable(gl.BLEND)
    gl.blendEquation(gl.FUNC_ADD)
    switch (mode) {
      case 'add':
        gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE)
        break
      case 'screen':
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ZERO, gl.ONE)
        break
      case 'multiply':
        gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE)
        break
      case 'over':
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
        break
      default:
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE)
    }
  }

  /** Dual-Kawase blur of `src` by roughly `radius` px; returns the blurred target (or src when tiny). */
  private blur(src: Target, radius: number, key: string): Target {
    if (radius < 0.75) return src
    const gl = this.gl
    // dual Kawase with n levels spreads about 1.5 × 2^n × offset px
    const n = Math.max(1, Math.min(6, Math.floor(Math.log2(radius / 1.5))))
    const offset = Math.max(0.5, Math.min(2.5, radius / (1.5 * 2 ** n)))
    this.setBlend('none')
    const levels: Target[] = []
    let cur = src
    this.downProg.use()
    for (let i = 1; i <= n; i++) {
      const t = this.pool.get(`${key}:d${i}`, Math.ceil(src.width / 2 ** i), Math.ceil(src.height / 2 ** i))
      bindTarget(gl, t)
      this.downProg.tex('u_src', 0, cur.tex)
      this.downProg.f2('u_half', (0.5 * offset) / cur.width, (0.5 * offset) / cur.height)
      this.drawFullscreen()
      levels.push(t)
      cur = t
    }
    this.upProg.use()
    for (let i = n - 1; i >= 0; i--) {
      const t = i === 0 ? this.pool.get(`${key}:out`, src.width, src.height) : levels[i - 1]
      bindTarget(gl, t)
      this.upProg.tex('u_src', 0, cur.tex)
      this.upProg.f2('u_half', (0.5 * offset) / cur.width, (0.5 * offset) / cur.height)
      this.drawFullscreen()
      cur = t
    }
    return cur
  }

  private blit(tex: WebGLTexture, alpha = 1, flipY = false) {
    this.blitProg.use()
    this.blitProg.tex('u_src', 0, tex)
    this.blitProg.f1('u_alpha', alpha)
    this.blitProg.i1('u_flipY', flipY ? 1 : 0)
    this.drawFullscreen()
  }

  // ── backdrop ───────────────────────────────────────────────────────────────

  /**
   * What goes on air (protocol §1 Scene.mode): the backdrop layers to draw, their brightness, and whether the mapped
   * objects show. `layerOnly` picks one layer from any stack.
   */
  private plan(input: RenderInput, scene: Scene): { layers: Layer[]; level: number; objects: boolean } {
    if (input.layerOnly) return { layers: allLayers(scene).filter((l) => l.id === input.layerOnly), level: 1, objects: false }
    return onAirPlan(scene, input.mode ?? scene.mode ?? 'static')
  }

  private renderBackdrop(input: RenderInput, layers: Layer[], level: number, target: Target) {
    const gl = this.gl
    const k = Math.min(target.width, target.height) / 1080
    let drew = false
    for (const layer of layers) {
      if (input.layerOnly ? layer.id !== input.layerOnly : !layer.visible) continue
      if (layer.opacity <= 0) continue
      const lt = this.pool.get('layer', target.width, target.height)
      bindTarget(gl, lt)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      this.setBlend('none')
      const radius = this.drawLayer(input, layer, lt, k)
      if (radius === null) continue
      const out = this.blur(lt, radius, 'blur')
      bindTarget(gl, target)
      this.setBlend(layer.blend)
      this.blit(out.tex)
      drew = true
    }
    if (drew && level < 1) {
      // the underlay under objects: scale the backdrop's brightness by `level`
      bindTarget(gl, target)
      gl.enable(gl.BLEND)
      gl.blendEquation(gl.FUNC_ADD)
      const l = Math.max(0, level)
      gl.blendColor(l, l, l, 1)
      gl.blendFuncSeparate(gl.ZERO, gl.CONSTANT_COLOR, gl.ZERO, gl.ONE)
      this.blit(this.blackTex)
    }
    this.setBlend('none')
  }

  /** Draws one layer into the bound target. Returns its blur radius in px, or null to skip it. */
  private drawLayer(input: RenderInput, layer: Layer, target: Target, k: number): number | null {
    const p = this.layerProg.use()
    const catalog = input.catalog
    const params = resolveParams(layerParamSchema(catalog, layer), layer.params as Record<string, unknown>)
    const num = (key: string, d = 0) => {
      const v = Number(params[key])
      return Number.isFinite(v) ? v : d
    }
    p.tex('u_tex', 0, this.blackTex) // never leave a target's texture bound (feedback loop)
    p.i1('u_kind', KIND_CODE[layer.kind] ?? 4)
    p.i1('u_blend', BLEND_CODE[layer.blend] ?? 0)
    p.f1('u_opacity', Math.max(0, Math.min(1, layer.opacity)))
    p.f2('u_res', target.width, target.height)
    p.f1('u_clock', input.clock)
    const seed = hashString01(layer.id)
    let radius = 0

    if (layer.kind === 'gobo' || layer.kind === 'procedural') {
      const light = layer.light
      const fx = lightFx(light?.fx.kind, input.clock, light?.fx.speed ?? 0.35, Math.floor(seed * 1000))
      const base = lightRgb(light?.color)
      const inten = (light?.intensity ?? 0.8) * fx.gain
      p.f3('u_light', base[0] * fx.rgb[0] * inten, base[1] * fx.rgb[1] * inten, base[2] * fx.rgb[2] * inten)
      p.f1('u_angle', ((light?.angle ?? 0) * Math.PI) / 180)
      p.f1('u_scale', light?.scale ?? 1)
      p.f2('u_offset', light?.offsetX ?? 0, light?.offsetY ?? 0)
      const softness = light?.softness ?? 0.5
      if (layer.kind === 'gobo') {
        const idx = (GOBO_IDS as readonly string[]).indexOf(layer.ref)
        p.i1('u_ref', idx < 0 ? 7 : idx)
        p.f1('u_seed', seed * 10)
        radius = softness ** 1.5 * 60 * k
      } else {
        const idx = (PROCEDURAL_IDS as readonly string[]).indexOf(layer.ref)
        if (idx < 0) return null
        p.i1('u_ref', idx)
        p.f1('u_seed', num('seed', seed * 100) * 0.137)
        this.proceduralUniforms(p, layer.ref, input.clock, base, num)
        const focus = 'focus' in params ? num('focus', 1) : 1
        radius = (softness ** 1.5 * 30 + (1 - focus) * 30) * k
      }
    } else if (layer.kind === 'gradient') {
      const stops = (Array.isArray(params.stops) ? (params.stops as Array<{ color: string; pos: number }>) : []).slice(0, 8)
      const sorted = [...stops].sort((a, b) => a.pos - b.pos)
      if (!sorted.length) sorted.push({ color: '#000000', pos: 0 })
      sorted.forEach((s, i) => {
        const c = hexToRgb(s.color, [0, 0, 0])
        this.stopColors.set(c, i * 3)
        this.stopPos[i] = Number(s.pos) || 0
      })
      p.v3('u_stopColor', this.stopColors)
      p.v1('u_stopPos', this.stopPos)
      p.i1('u_stopN', sorted.length)
      p.f1('u_gAngle', (num('angle', 135) * Math.PI) / 180)
      p.f1('u_gDrift', num('drift', 0.24))
      p.f1('u_gGrain', num('grain', 0.12))
      p.f1('u_gBright', num('brightness', 0.9))
    } else if (layer.kind === 'photo') {
      const img = this.images.get(photoUrl(layer.ref, this.opts.resolveUrl))
      if (!img) return null
      p.tex('u_tex', 0, img.tex)
      p.f2('u_texSize', img.width, img.height)
      p.f1('u_pBright', num('brightness', 0.66))
      p.f1('u_pWarm', num('warmth', 0))
      p.f1('u_pDrift', num('drift', 0.1))
      radius = num('blur', 0) * 60 * k
    } else {
      const c = hexToRgb(typeof params.color === 'string' ? params.color : '#000000', [0, 0, 0])
      p.f3('u_solid', c[0], c[1], c[2])
    }
    this.drawFullscreen()
    return radius
  }

  private proceduralUniforms(p: GLProgram, ref: string, clock: number, base: RGB, num: (k: string, d?: number) => number) {
    let pa: [number, number, number, number] = [0, 0, 0, 0]
    let pgain = 1
    let pcolor: RGB = [1, 1, 1]
    switch (ref) {
      case 'tree-sway':
      case 'palm-sway':
        pa = [num('wind', 0.4), num('gust', 0.18), num('focus', 0.7), num('seed', 7)]
        break
      case 'clouds':
        pa = [num('speed', 0.2), num('density', 0.5), num('softness', 0.8), 0]
        break
      case 'rain-glass':
        pa = [num('amount', 0.5), num('speed', 0.4), num('drops', 0.6), 0]
        break
      case 'lightning': {
        const f = lightFx('lightning', clock, num('frequency', 0.2), 3)
        pgain = Math.min(1, Math.max(0, (f.gain - 0.06) * num('brightness', 0.9) * 1.2))
        break
      }
      case 'day-cycle': {
        const period = Math.max(1, num('minutes', 20)) * 60
        const ph = (clock / period) % 2
        const tri = ph < 1 ? ph : 2 - ph
        const kel = num('fromKelvin', 3200) + (num('toKelvin', 5600) - num('fromKelvin', 3200)) * tri
        const c = kelvinToRgb(kel)
        const r: RGB = [c[0] / Math.max(base[0], 0.05), c[1] / Math.max(base[1], 0.05), c[2] / Math.max(base[2], 0.05)]
        const m = Math.max(...r)
        pcolor = [r[0] / m, r[1] / m, r[2] / m]
        break
      }
      case 'sun-drift':
        pa = [num('speed', 0.1), num('travel', 0.3), 0, 0]
        break
      case 'candle-flicker': {
        const amount = num('amount', 0.5)
        const f = 0.7 + 0.45 * fbm1(clock * (2 + num('speed', 0.5) * 10), 11, 3)
        pgain = Math.min(1, 1 - amount + amount * f)
        pa = [amount, num('speed', 0.5), 0, 0]
        break
      }
      case 'caustics':
        pa = [num('speed', 0.3), num('scale', 0.5), num('sharpness', 0.5), 0]
        break
      case 'dapple':
        pa = [num('speed', 0.2), num('density', 0.5), 0, 0]
        break
      case 'film-grain':
        pa = [num('amount', 0.15), num('size', 0.3), 0, 0]
        break
      case 'haze':
        pa = [num('amount', 0.3), num('drift', 0.1), 0, 0]
        break
    }
    p.f4('u_pa', pa[0], pa[1], pa[2], pa[3])
    p.f4('u_pb', 0, 0, 0, 0)
    p.f1('u_pgain', pgain)
    p.f3('u_pcolor', pcolor[0], pcolor[1], pcolor[2])
  }

  // ── mapping ────────────────────────────────────────────────────────────────

  private effectSchema(id: string, input: RenderInput): { def: EffectDef | null; schema: ParamSchema } {
    const user = input.effects?.find((e) => e.id === id) ?? null
    if (user && user.kind !== 'builtin') return { def: user, schema: user.params ?? {} }
    const cat = input.catalog?.effects.find((e) => e.id === id)
    return { def: cat ?? user ?? null, schema: cat?.params ?? BUILTIN_SCHEMAS[id] ?? user?.params ?? {} }
  }

  private effectProgram(id: string, def: EffectDef | null, schema: ParamSchema): EffectProgram | null {
    let source: string
    let extra = ''
    let text = false
    let drawing = false
    if (def && def.kind === 'glsl') {
      source = def.source ?? ''
    } else {
      const b = BUILTINS[id]
      if (!b) return null
      source = b.source
      extra = b.extra ?? ''
      text = !!b.text
      drawing = !!b.drawing
    }
    const key = `${id}|${hashString01(source)}|${Object.keys(schema).join(',')}`
    let p = this.effectProgs.get(key)
    if (!p) {
      try {
        const prog = createProgram(this.gl, FULLSCREEN_VS, wrapEffect(source, schema, extra))
        p = { prog, uniforms: paramUniforms(schema), text, drawing }
        this.errors.delete(id)
      } catch (e) {
        const msg = e instanceof ShaderError ? cleanLog(e.message) : String(e)
        p = { error: msg }
        this.reportError(id, msg)
      }
      this.effectProgs.set(key, p)
    }
    return p
  }

  private renderMapping(input: RenderInput, scene: Scene, target: Target, keep: Set<string>, dynKeep: Set<string>) {
    const gl = this.gl
    const pts = new Map<string, Point>(scene.points.map((p) => [p.id, p]))
    const activeClips = evaluateTimeline(scene, input.t, input.mutedTracks)
    const sx = target.width / sceneSizeOf(input.setup).width
    const sy = target.height / sceneSizeOf(input.setup).height
    const geoCache = new Map<string, SurfaceGeometry | null>()
    const geoOf = (s: Surface) => {
      if (!geoCache.has(s.id)) geoCache.set(s.id, surfaceGeometry(s, pts))
      return geoCache.get(s.id) ?? null
    }
    const byId = new Map<string, Surface>()
    for (const o of scene.objects) for (const s of o.surfaces) byId.set(s.id, s)

    for (const obj of scene.objects) {
      if (!obj.visible) continue
      for (const s of obj.surfaces) {
        if (!s.visible || input.hiddenSurfaces?.has(s.id)) continue
        const geo = geoOf(s)
        if (!geo) continue
        if (s.kind === 'mask') {
          bindTarget(gl, target)
          this.drawWarp(geo, null, { sx, sy, mode: 1, color: [0, 0, 0, 1], opacity: s.opacity, soft: s.softEdge }, target)
          continue
        }
        const content = this.drawContent(input, s, geo, activeClips.get(s.id) ?? [], keep, dynKeep)
        if (!content) continue

        bindTarget(gl, target)
        const parent = s.parentId ? byId.get(s.parentId) : undefined
        const parentGeo = parent ? geoOf(parent) : null
        if (parentGeo) {
          gl.enable(gl.STENCIL_TEST)
          gl.clear(gl.STENCIL_BUFFER_BIT)
          gl.stencilFunc(gl.ALWAYS, 1, 0xff)
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE)
          gl.colorMask(false, false, false, false)
          this.drawWarp(parentGeo, null, { sx, sy, mode: 1, color: [1, 1, 1, 1], opacity: 1, soft: 0 }, target)
          gl.colorMask(true, true, true, true)
          gl.stencilFunc(gl.EQUAL, 1, 0xff)
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP)
        }
        this.drawWarp(geo, content.tex, { sx, sy, mode: 0, color: [0, 0, 0, 0], opacity: s.opacity, soft: s.kind === 'line' ? 0 : s.softEdge }, target)
        if (parentGeo) gl.disable(gl.STENCIL_TEST)
      }
    }
    this.setBlend('none')
  }

  /**
   * Draws a surface's content (its always-on effects, then the active clips) into its content target in UV space,
   * at most CONTENT_MAX on the longest side with the surface's aspect. Returns null when nothing is on it.
   */
  private drawContent(input: RenderInput, s: Surface, geo: SurfaceGeometry, active: ActiveClip[], keep: Set<string>, dynKeep: Set<string>): Target | null {
    const gl = this.gl
    const layers: EffectLayer[] = []
    for (const e of s.effects) if (e.enabled) layers.push({ inst: `${s.id}/${e.id}`, effect: e.effect, params: e.params as Record<string, unknown>, progress: 1, alpha: 1, time: input.clock })
    for (const a of active) layers.push({ inst: `${s.id}/${a.clip.id}`, effect: a.effect, params: a.params as Record<string, unknown>, progress: a.progress, alpha: a.alpha, time: input.t })
    if (!layers.length) return null

    const aspect = Math.max(1e-3, geo.aspect)
    const cw = aspect >= 1 ? CONTENT_MAX : Math.max(16, Math.round(CONTENT_MAX * aspect))
    const ch = aspect >= 1 ? Math.max(16, Math.round(CONTENT_MAX / aspect)) : CONTENT_MAX
    const ckey = `content:${s.id}`
    keep.add(ckey)
    const content = this.pool.get(ckey, cw, ch)
    bindTarget(gl, content)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    this.setBlend('over')
    const seed = hashString01(s.id)
    const outline = capOutline(geo.outlineUv)
    let perimeterPx = 0
    for (let i = 0; i < geo.outline.length - (geo.closed ? 0 : 1); i++) {
      const a = geo.outline[i], b = geo.outline[(i + 1) % geo.outline.length]
      perimeterPx += Math.hypot(b[0] - a[0], b[1] - a[1])
    }
    for (const l of layers) {
      const { def, schema } = this.effectSchema(l.effect, input)
      const params = resolveParams(schema, l.params)
      if (def?.kind === 'js') {
        const key = `${def.id}|${hashString01(def.source ?? '')}`
        this.jsWanted?.push({ inst: l.inst, key })
        const bmp = this.js.request({ key, source: def.source ?? '', inst: l.inst, t: l.time, progress: l.progress, width: cw, height: ch, aspect, seed, params })
        if (bmp) {
          dynKeep.add('js:' + l.inst)
          const tex = this.dyn.upload('js:' + l.inst, bmp)
          this.blit(tex, l.alpha, true)
        }
        continue
      }
      const ep = this.effectProgram(l.effect, def, schema)
      if (!ep || 'error' in ep) continue
      const p = ep.prog.use()
      if (ep.text || ep.drawing) p.tex('u_text', 0, this.blackTex)
      p.f1('u_time', l.time)
      p.f1('u_progress', l.progress)
      p.f2('u_resolution', cw, ch)
      p.f1('u_aspect', aspect)
      p.f1('u_seed', seed)
      p.f1('u_alpha', l.alpha)
      p.f2('u_surfacePx', geo.size[0], geo.size[1])
      p.f1('u_perimeterPx', perimeterPx)
      p.i1('u_lineMode', geo.kind === 'line' ? 1 : 0)
      this.outlineBuf.fill(0)
      outline.forEach((v, i) => {
        this.outlineBuf[i * 2] = v[0]
        this.outlineBuf[i * 2 + 1] = v[1]
      })
      p.v2('u_outline', this.outlineBuf)
      p.i1('u_outlineN', outline.length)
      for (const u of ep.uniforms) {
        const v = paramValue(u, params[u.key])
        if (u.glsl === 'vec3') p.f3(u.name, ...(v as [number, number, number]))
        else if (u.glsl === 'int') p.i1(u.name, v as number)
        else p.f1(u.name, v as number)
      }
      if (ep.drawing) {
        // strokes are in surface px; k converts them to content px. A clip reveals with its progress.
        const k = cw / Math.max(1, geo.size[0])
        const reveal = Math.max(0, Math.min(1, Number(params.reveal ?? 1))) * l.progress
        const dkey = `draw:${l.inst}`
        const vkey = `${strokesKey(params.strokes)}|${Math.round(reveal * 1000)}|${cw}x${ch}`
        let cv = this.drawCanvases.get(dkey)
        if (!cv || cv.key !== vkey) {
          cv = { key: vkey, canvas: makeDrawingCanvas(parseStrokes(params.strokes), cw, ch, k, reveal) }
          this.drawCanvases.set(dkey, cv)
        }
        dynKeep.add(dkey)
        p.tex('u_text', 0, this.dyn.upload(dkey, cv.canvas as TexImageSource))
      }
      if (ep.text) {
        const text = String(params.text ?? '')
        const size = Number(params.size ?? 48) * (cw / Math.max(1, geo.size[0]))
        const color = typeof params.color === 'string' ? params.color : '#ffffff'
        const tkey = `${text}|${size.toFixed(1)}|${color}|${cw}x${ch}`
        let cv = this.textCanvases.get(tkey)
        if (!cv) {
          cv = makeTextCanvas(text, size, color, cw, ch)
          this.textCanvases.set(tkey, cv)
        }
        dynKeep.add('text:' + tkey)
        const tex = this.dyn.upload('text:' + tkey, cv as TexImageSource)
        p.tex('u_text', 0, tex)
      }
      this.drawFullscreen()
    }

    return content
  }

  private drawWarp(
    geo: SurfaceGeometry,
    content: WebGLTexture | null,
    o: { sx: number; sy: number; mode: number; color: [number, number, number, number]; opacity: number; soft: number },
    target: Target,
  ) {
    // geometry is in authored scene px; scale into the (possibly capped) target
    let verts = geo.verts
    if (o.sx !== 1 || o.sy !== 1) {
      verts = geo.verts.slice()
      for (let i = 0; i < verts.length; i += 4) {
        verts[i] *= o.sx
        verts[i + 1] *= o.sy
      }
    }
    this.mesh.set(verts, geo.indices)
    const p = this.warpProg.use()
    p.f2('u_res', target.width, target.height)
    p.i1('u_mode', o.mode)
    p.f4('u_color', ...o.color)
    p.f1('u_opacity', Math.max(0, Math.min(1, o.opacity)))
    const soft = Math.max(0, o.soft) * o.sx
    p.f1('u_soft', geo.closed ? soft : 0)
    const ol = capOutline(geo.outline)
    this.outlineBuf.fill(0)
    ol.forEach((v, i) => {
      this.outlineBuf[i * 2] = v[0] * o.sx
      this.outlineBuf[i * 2 + 1] = v[1] * o.sy
    })
    p.v2('u_outline', this.outlineBuf)
    p.i1('u_outlineN', ol.length)
    if (geo.hInv && (o.sx !== 1 || o.sy !== 1)) {
      // compose with the inverse scale: uv = Hinv · S⁻¹ · pos
      const h = geo.hInv
      const s: typeof h = [h[0] / o.sx, h[1] / o.sy, h[2], h[3] / o.sx, h[4] / o.sy, h[5], h[6] / o.sx, h[7] / o.sy, h[8]]
      p.m3('u_hInv', toGlMat3(s, this.m3))
    } else if (geo.hInv) p.m3('u_hInv', toGlMat3(geo.hInv, this.m3))
    p.i1('u_useH', geo.hInv ? 1 : 0)
    p.tex('u_content', 0, content ?? this.blackTex)
    this.setBlend('over')
    this.mesh.draw()
  }

  // ── overlay and final ──────────────────────────────────────────────────────

  private renderOutline(input: RenderInput, scene: Scene, S: { width: number; height: number }): Target {
    const gl = this.gl
    const t = this.pool.get('overlay', S.width, S.height)
    bindTarget(gl, t)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const o = input.outline!
    const pts = new Map<string, Point>(scene.points.map((p) => [p.id, p]))
    const c = hexToRgb(o.color, [1, 1, 1])
    const sx = S.width / sceneSizeOf(input.setup).width
    const sy = S.height / sceneSizeOf(input.setup).height
    for (const obj of scene.objects) for (const s of obj.surfaces) {
      if (!o.surfaceIds.includes(s.id)) continue
      const geo = surfaceGeometry(s, pts)
      if (!geo) continue
      const line = geo.closed ? [...geo.outline, geo.outline[0]] : geo.outline
      const g = strokePolyline(line, Math.max(1, o.width))
      this.drawWarp({ ...g, kind: 'line', closed: false }, null, { sx, sy, mode: 2, color: [c[0], c[1], c[2], 1], opacity: 1, soft: 0 }, t)
    }
    this.setBlend('none')
    return t
  }

  private finalPass(input: RenderInput, scene: Target, overlay: Target | null, S: { width: number; height: number }) {
    const gl = this.gl
    bindTarget(gl, null, this.canvas.width, this.canvas.height)
    this.setBlend('none')
    const p = this.finalProg.use()
    const physical = this.opts.space === 'physical'
    const out = input.setup.output
    p.tex('u_scene', 0, scene.tex)
    p.tex('u_overlay', 1, overlay ? overlay.tex : this.blackTex)
    p.i1('u_hasOverlay', overlay ? 1 : 0)
    p.i1('u_space', physical ? 1 : 0)
    p.i1('u_orient', physical ? ORIENTATION_CODE[out.orientation] ?? 0 : 0)
    p.f2('u_flip', physical && out.flipH ? 1 : 0, physical && out.flipV ? 1 : 0)
    p.f1('u_master', Math.max(0, input.setup.master ?? 1))
    p.f1('u_blackout', input.blackout)
    const test = input.testPattern ?? input.setup.testPattern ?? 'off'
    p.i1('u_test', TEST_CODE[test] ?? 0)
    const authored = sceneSizeOf(input.setup)
    p.f2('u_sceneSize', authored.width, authored.height)
    void S
    p.f2('u_canvas', this.canvas.width, this.canvas.height)
    const pat = physical ? input.pattern : null
    let code = 0
    if (pat) {
      if (pat.kind === 'gray') {
        code = 1
        p.i1('u_axis', pat.axis === 'y' ? 1 : 0)
        p.u1('u_bit', Math.max(0, Math.floor(pat.bit)))
        p.i1('u_inverse', pat.inverse ? 1 : 0)
      } else code = pat.kind === 'white' ? 2 : pat.kind === 'black' ? 3 : 0
    }
    p.i1('u_pattern', code)
    this.drawFullscreen()
  }
}

/** Renders one frame offscreen at `width` px wide (height from the scene's aspect) and encodes a PNG. */
export async function renderFrameToBlob(input: RenderInput, width: number, opts: Partial<RendererOptions> = {}): Promise<Blob> {
  const s = sceneSizeOf(input.setup)
  const height = Math.max(1, Math.round((width * s.height) / s.width))
  const canvas = new OffscreenCanvas(width, height)
  const r = new Renderer(canvas, { space: 'scene', ...opts })
  r.setSize(width, height)
  try {
    await r.ready(input)
    r.render(input)
    return await canvas.convertToBlob({ type: 'image/png' })
  } finally {
    r.dispose(true)
  }
}


/**
 * A surface's flat size in scene px (quads: the mean of opposite edges, so roughly its real aspect) or null.
 * The editor's flat view sizes its canvas with it.
 */
export function surfaceFlatSize(scene: Scene, surfaceId: string): { width: number; height: number } | null {
  const pts = new Map<string, Point>(scene.points.map((p) => [p.id, p]))
  for (const o of scene.objects) for (const s of o.surfaces) {
    if (s.id !== surfaceId) continue
    const geo = surfaceGeometry(s, pts)
    return geo ? { width: geo.size[0], height: geo.size[1] } : null
  }
  return null
}
