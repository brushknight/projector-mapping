/**
 * (§16) Renders a live layer's animated strip for the phone's live gallery (not part of the app):
 * /dev/anim-harness.html?proc=<id>&frames=36&fps=12&w=192&h=108&clock=7.5&tail=8
 * The gallery scene (entities/catalog/liveTry.ts galleryScene) drawn at `frames` clocks, `1 / fps` apart, stacked top to
 * bottom on one canvas. The last `tail` frames fade into the frames just before the first, so the strip loops without
 * a jump. Sets window.__strip (a JPEG data URL) and window.__done.
 */
import catalogJson from '../../contract/catalog.json'
import { galleryScene } from '../src/entities/catalog/liveTry'
import type { Catalog } from '../src/entities/catalog/types'
import type { Setup } from '../src/entities/setup/types'
import { Renderer } from '../src/render'

const q = new URLSearchParams(location.search)
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d)
const catalog = catalogJson as unknown as Catalog
const ref = q.get('proc') ?? 'tree-sway'
const N = num('frames', 36), fps = num('fps', 12), W = num('w', 192), H = num('h', 108), c0 = num('clock', 7.5), X = num('tail', 8)

const setup = {
  id: 'anim', name: 'anim', output: { width: 1920, height: 1080, orientation: 'landscape', flipH: false, flipV: false },
  master: 1, blackoutFadeMs: 0, testPattern: 'off', testPatternUntil: null, referenceAsset: null, calibrationId: null,
} as unknown as Setup

const gl = document.createElement('canvas')
gl.width = W
gl.height = H
const r = new Renderer(gl, { space: 'scene', preserveDrawingBuffer: true, maxSceneSize: Math.max(W, H) })
r.setSize(W, H)
const scene = galleryScene(catalog, ref)
const strip = document.getElementById('c') as HTMLCanvasElement
strip.width = W
strip.height = H * N
const ctx = strip.getContext('2d')!
const draw = (clock: number) => r.render({ setup, scene, catalog, t: 0, clock, now: 0, blackout: 0 })
await r.ready({ setup, scene, catalog, t: 0, clock: c0, now: 0, blackout: 0 })
for (let i = 0; i < N; i++) {
  draw(c0 + i / fps)
  ctx.globalAlpha = 1
  ctx.drawImage(gl, 0, i * H)
  const k = i - (N - X)
  if (k >= 0) {
    // fade towards the frame one step before frame 0, so frame N − 1 runs into frame 0
    draw(c0 + (i - N) / fps)
    ctx.globalAlpha = (k + 1) / (X + 1)
    ctx.drawImage(gl, 0, i * H)
  }
}
ctx.globalAlpha = 1
const w2 = window as unknown as Record<string, unknown>
w2.__strip = strip.toDataURL('image/jpeg', 0.78)
w2.__done = true
