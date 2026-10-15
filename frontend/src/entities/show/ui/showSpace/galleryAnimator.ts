/**
 * (§16) Animates the live gallery's tiles with the real engine: ONE offscreen WebGL renderer draws the visible tiles
 * in turn (one live layer under a warm light, galleryScene) and copies each frame into the tile's own 2D canvas. Each
 * animation frame spends at most BUDGET_MS on tiles, round robin, so a slow GPU shows slower tiles instead of a
 * slower editor; a tile is never drawn faster than FPS. Tiles off screen, and every tile while the tab is hidden,
 * stop. The renderer is let go a few seconds after the last tile goes away.
 */
import { Renderer } from '../../../../render'
import { galleryScene, type Catalog } from '../../../catalog'
import type { Scene } from '../../../scene/types'
import type { Setup } from '../../../setup/types'

/** tile frame size in px (16:9), and the gallery's frame rate */
export const TILE_W = 256
export const TILE_H = 144
const FPS = 15
const BUDGET_MS = 5

const SETUP = {
  id: 'gallery', name: 'gallery', output: { width: 1920, height: 1080, orientation: 'landscape', flipH: false, flipV: false },
  master: 1, blackoutFadeMs: 0, testPattern: 'off', testPatternUntil: null, referenceAsset: null, calibrationId: null,
} as unknown as Setup

interface Tile {
  ref: string
  /** (§16, static gallery) a scene of its own instead of galleryScene(ref) */
  scene?: Scene
  ctx: CanvasRenderingContext2D
  visible: boolean
  /** each tile runs a little ahead so neighbours never move in step */
  offset: number
  /** when it was last drawn (performance.now ms) */
  drawn: number
}

const tiles = new Map<HTMLCanvasElement, Tile>()
let shared: { canvas: HTMLCanvasElement; r: Renderer } | null = null
let catalog: Catalog | null = null
const scenes = new Map<string, Scene>()
let raf = 0
let cursor = 0
let idle: ReturnType<typeof setTimeout> | null = null
let failed = false
let io: IntersectionObserver | null = null

function renderer() {
  if (shared || failed) return shared
  try {
    const canvas = document.createElement('canvas')
    canvas.width = TILE_W
    canvas.height = TILE_H
    const r = new Renderer(canvas, { space: 'scene', preserveDrawingBuffer: true, maxSceneSize: TILE_W })
    r.setSize(TILE_W, TILE_H)
    shared = { canvas, r }
  } catch {
    failed = true
  }
  return shared
}

function sceneOf(ref: string): Scene {
  let s = scenes.get(ref)
  if (!s) {
    s = galleryScene(catalog, ref)
    scenes.set(ref, s)
  }
  return s
}

function frame(ts: number) {
  raf = requestAnimationFrame(frame)
  if (document.hidden) return
  const sh = renderer()
  if (!sh) return
  const list = [...tiles.values()]
  const start = performance.now()
  const base = cursor
  for (let k = 0; k < list.length && performance.now() - start < BUDGET_MS; k++) {
    const t = list[(base + k) % list.length]
    if (!t.visible || ts - t.drawn < 1000 / FPS) continue
    t.drawn = ts
    sh.r.render({ setup: SETUP, scene: t.scene ?? sceneOf(t.ref), catalog, t: 0, clock: ts / 1000 + t.offset, now: Date.now(), blackout: 0 })
    t.ctx.drawImage(sh.canvas, 0, 0, t.ctx.canvas.width, t.ctx.canvas.height)
    cursor = (base + k + 1) % list.length
  }
}

function observer() {
  if (!io && typeof IntersectionObserver !== 'undefined') {
    io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const t = tiles.get(e.target as HTMLCanvasElement)
        if (t) t.visible = e.isIntersecting
      }
    })
  }
  return io
}

/** Whether the engine can draw tiles here (false without WebGL2: tiles then show the still thumbnails). */
export const galleryAvailable = () => !!renderer()

/** Starts animating `canvas` with live layer `ref`; returns the function that stops it. */
export function animateTile(canvas: HTMLCanvasElement, ref: string, cat: Catalog | null): () => void {
  return animate(canvas, ref, cat)
}

/**
 * (§16) Starts animating `canvas` with a scene of its own (the static gallery: a background layer under the light, or
 * a plate in front of it); returns the function that stops it.
 */
export function animateScene(canvas: HTMLCanvasElement, scene: Scene, cat: Catalog | null): () => void {
  return animate(canvas, scene.id, cat, scene)
}

function animate(canvas: HTMLCanvasElement, ref: string, cat: Catalog | null, scene?: Scene): () => void {
  if (cat !== catalog) {
    catalog = cat
    scenes.clear()
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => {}
  if (idle) {
    clearTimeout(idle)
    idle = null
  }
  tiles.set(canvas, { ref, scene, ctx, visible: !observer(), offset: tiles.size * 1.37, drawn: 0 })
  observer()?.observe(canvas)
  if (!raf) raf = requestAnimationFrame(frame)
  return () => {
    tiles.delete(canvas)
    io?.unobserve(canvas)
    if (tiles.size) return
    cancelAnimationFrame(raf)
    raf = 0
    idle = setTimeout(() => {
      shared?.r.dispose(true)
      shared = null
    }, 4000)
  }
}
