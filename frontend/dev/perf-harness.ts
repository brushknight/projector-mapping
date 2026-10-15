/**
 * Perf harness for the render engine (not part of the app; `npm run perf`). Query params:
 *   w, h            the canvas size (the renderer's output)
 *   preview=1       a light renderer like /preview (maxSceneSize = w, preview tier masks)
 *   test=switch     time from a plate pick to the first frame that draws the new plate's mask (median of `n` picks)
 *   test=frame      steady frame time (ms, GPU synced) for `scenario`: sharp | soft | live | live-soft
 * Writes window.__result and sets window.__done.
 */
import catalog from '../../contract/catalog.json'
import sceneFx from '../../contract/fixtures/scene.json'
import setupFx from '../../contract/fixtures/setup.json'
import { Renderer } from '../src/render'
import { maskStore } from '../src/render/plates/masks'
import { newAttachment, newLayer, stackLightOf } from '../src/entities/catalog/layers'
import type { Catalog } from '../src/entities/catalog/types'
import type { Scene } from '../src/entities/scene/types'
import type { Setup } from '../src/entities/setup/types'
import type { RenderInput } from '../src/render/types'

const q = new URLSearchParams(location.search)
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d)
const cat = catalog as unknown as Catalog
const setup: Setup = JSON.parse(JSON.stringify(setupFx))
const w = num('w', 1920), h = num('h', 1080)
const canvas = document.getElementById('c') as HTMLCanvasElement
canvas.style.width = `${w}px`
canvas.style.height = `${h}px`
const preview = q.get('preview') === '1'
const r = new Renderer(canvas, { space: 'scene', maxSceneSize: preview ? w : undefined, preview, hold: true } as ConstructorParameters<typeof Renderer>[1])
r.setSize(w, h)
const w2 = window as unknown as Record<string, unknown>

function sceneWith(gobo: string, scenario: string): Scene {
  const scene: Scene = JSON.parse(JSON.stringify(sceneFx))
  const soft = scenario.includes('soft')
  const light = stackLightOf({ focus: soft ? 0.45 : 1, backgroundFocus: soft ? 0.5 : 1, color: { mode: 'cct', kelvin: 3200, tint: 0, hue: 212, sat: 0.7 } }, cat)
  const atts = [newAttachment(cat, gobo, 'att_0')]
  if (scenario.startsWith('live')) {
    scene.backdrop.live = { layers: [newLayer(cat, 'procedural', 'tree-sway', 'lay_t'), newLayer(cat, 'procedural', 'clouds', 'lay_c')], attachments: atts, light }
    scene.mode = 'live'
  } else {
    scene.backdrop.static = { layers: [], attachments: atts, light }
    scene.mode = 'static'
  }
  scene.objects = []
  return scene
}
const input = (scene: Scene, i = 0): RenderInput => ({ setup, scene, catalog: cat, t: 1 + i / 60, clock: 12 + i / 60, now: 0, blackout: 0 })
const sync = () => r.readPixels(0, 0, 1, 1)
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const raf = () => new Promise<number>((res) => requestAnimationFrame(res))
const hasMask = (r as unknown as { masksReady?: (i: RenderInput) => boolean }).masksReady?.bind(r)

async function run() {
  const test = q.get('test') ?? 'frame'
  const scenario = q.get('scenario') ?? 'sharp'
  if (test === 'switch') {
    const plates = cat.gobos.map((g) => g.id).filter((id) => !id.includes('window') && !id.includes('blinds') && !id.includes('lines'))
    const n = Math.min(num('n', 8), plates.length)
    // warm the programs with one plate
    r.render(input(sceneWith(cat.gobos[0].id, scenario)))
    sync()
    // warm=1: the page has prefetched the plates' small masks (what /out and the galleries do at idle)
    if (q.get('warm') === '1') await Promise.all(plates.map((id) => maskStore.load(id, 1024)))
    const times: number[] = []
    const shown: number[] = []
    for (let i = 0; i < n; i++) {
      const sc = sceneWith(plates[(i * 7) % plates.length], scenario)
      await raf()
      const t0 = performance.now()
      let first = 0
      for (let f = 0; f < 600; f++) {
        const drew = r.render(input(sc, f)) !== false
        sync()
        if (drew && !first) first = performance.now() - t0
        if (!hasMask || hasMask(input(sc, f))) break
        await raf()
      }
      times.push(performance.now() - t0)
      shown.push(first)
    }
    w2.__result = { test, scenario, w, h, preview, median: median(times), max: Math.max(...times), times: times.map((t) => Math.round(t)), shown: median(shown), shownTimes: shown.map((t) => Math.round(t)) }
  } else {
    const sc = sceneWith('plate-tree-with-leaves', scenario)
    const inp0 = input(sc)
    await r.ready(inp0)
    for (let i = 0; i < 10; i++) r.render(input(sc, i))
    sync()
    const N = num('n', 60)
    const t0 = performance.now()
    for (let i = 0; i < N; i++) {
      r.render(input(sc, i))
      sync()
    }
    w2.__result = { test, scenario, w, h, preview, frameMs: (performance.now() - t0) / N }
  }
  w2.__done = true
}
run().catch((e) => {
  w2.__result = { error: String(e) }
  w2.__done = true
})
