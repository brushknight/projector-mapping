/**
 * Visual harness for the render engine (not part of the app). Open /dev/render-harness.html with query params:
 *   t, clock, w, h, space=scene|physical, orient, flipH, flipV, layers=<json Layer[]>, pattern=gray&axis&bit&inverse,
 *   test=grid|..., blackout, mapping=0, backdrop=0, glsl=<source> (adds a user effect on srf_top),
 *   mode=static|live|color|scenery|objects (default objects, so mapping shows), underlay=<level> (backdrop under objects)
 */
import catalog from '../../contract/catalog.json'
import sceneFx from '../../contract/fixtures/scene.json'
import setupFx from '../../contract/fixtures/setup.json'
import { Renderer } from '../src/render'
import { newAttachment, newLayer, stackLightOf } from '../src/entities/catalog/layers'
import type { Catalog } from '../src/entities/catalog/types'
import type { Scene } from '../src/entities/scene/types'
import type { Setup } from '../src/entities/setup/types'
import type { RenderInput } from '../src/render/types'
import type { EffectDef } from '../src/entities/effect/types'

const scenery = import.meta.glob('../../backend/internal/catalog/assets/scenery/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const q = new URLSearchParams(location.search)
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d)

const setup: Setup = JSON.parse(JSON.stringify(setupFx))
if (q.get('orient')) setup.output.orientation = q.get('orient') as Setup['output']['orientation']
setup.output.flipH = q.get('flipH') === '1'
setup.output.flipV = q.get('flipV') === '1'
const scene: Scene = JSON.parse(JSON.stringify(sceneFx))
if (q.get('layers')) scene.backdrop.live.layers = JSON.parse(q.get('layers')!)
scene.mode = (q.get('mode') as Scene['mode']) ?? (q.get('layers') ? 'live' : 'objects')
// (§15) gobo=<id>[,<id>…] puts those attachments (catalog defaults, params=<json> merged into the first) on the static
// light; light=<json> overrides the light; atts=<json Attachment[]> replaces the attachments
if (q.get('gobo') || q.get('atts') || q.get('light')) {
  const cat = catalog as unknown as Catalog
  const atts = q.get('atts') ? JSON.parse(q.get('atts')!) : (q.get('gobo') ?? '').split(',').filter(Boolean).map((g, i) => newAttachment(cat, g, `att_${i}`))
  if (atts[0] && q.get('params')) atts[0].params = { ...atts[0].params, ...JSON.parse(q.get('params')!) }
  if (atts[0] && q.get('att')) Object.assign(atts[0], JSON.parse(q.get('att')!))
  const item = cat.gobos.find((g) => g.id === atts[0]?.gobo)
  scene.backdrop.static = { layers: [], attachments: atts, light: stackLightOf({ focus: item?.focus ?? 0.7, color: { mode: 'cct', kelvin: 3200, tint: 0, hue: 212, sat: 0.7 }, ...(q.get('light') ? JSON.parse(q.get('light')!) : {}) }, cat) }
  scene.mode = (q.get('mode') as Scene['mode']) ?? 'static'
}
if (q.get('underlay')) scene.underlay = { on: true, from: 'live', level: Number(q.get('underlay')) }
// (§15) proc=<id>: one procedural layer; a shadow (multiply) blocks a warm light, the others draw over black
if (q.get('proc')) {
  const cat = catalog as unknown as Catalog
  const layer = newLayer(cat, 'procedural', q.get('proc')!, 'lay_p')
  const shadow = layer.blend === 'multiply'
  scene.backdrop.live = { layers: [layer], attachments: [], light: shadow ? stackLightOf({ focus: 0.75, color: { mode: 'cct', kelvin: 3200, tint: 0, hue: 212, sat: 0.7 } }, cat) : null }
  scene.mode = 'live'
}
const effects: EffectDef[] = []
if (q.get('glsl')) {
  effects.push({ id: 'eff_user', name: 'user', kind: 'glsl', origin: 'user', params: { speed: { type: 'number', min: 0, max: 1, default: 0.5 } }, source: q.get('glsl') })
  scene.objects[0].surfaces[0].effects = [{ id: 'fx_u', effect: 'eff_user', enabled: true, params: {} }]
}
if (q.get('js')) {
  effects.push({ id: 'eff_js', name: 'js', kind: 'js', origin: 'user', params: {}, source: q.get('js') })
  scene.objects[0].surfaces[0].effects = [{ id: 'fx_j', effect: 'eff_js', enabled: true, params: {} }]
}
if (q.get('mesh')) {
  const left = scene.objects[0].surfaces[1]
  left.mesh = { cols: 2, rows: 2, bezier: q.get('mesh') === 'bezier', offsets: [[0, 0], [0, 0], [0, 0], [0, 0], [60, -20], [0, 0], [0, 0], [0, 0], [0, 0]] }
  left.effects = [{ id: 'g', effect: 'grid-build', enabled: true, params: { cells: 10 } }]
  scene.objects[0].surfaces[2].effects = [{ id: 'f', effect: 'fill', enabled: true, params: { color: '#3355ff' } }]
  scene.objects[0].surfaces[2].softEdge = 30
  scene.objects.push({ id: 'obj_m', name: 'm', tags: [], visible: true, surfaces: [{ id: 'srf_m', name: 'm', kind: 'mask', role: 'face', pointIds: ['p_bay1_0', 'p_bay2_1', 'p_bay2_2', 'p_bay1_3'], parentId: null, visible: true, mesh: null, effects: [], opacity: 1, softEdge: 0 }] })
}
if (q.get('surfaceFx')) scene.objects[0].surfaces[1].effects = JSON.parse(q.get('surfaceFx')!)

const canvas = document.getElementById('c') as HTMLCanvasElement
const w = num('w', 1280), h = num('h', 720)
canvas.style.width = `${w}px`
canvas.style.height = `${h}px`
const r = new Renderer(canvas, {
  space: (q.get('space') as 'scene' | 'physical') ?? 'scene',
  preserveDrawingBuffer: true,
  resolveUrl: (ref) => scenery[`../../backend/internal/catalog/assets/scenery/${ref}.jpg`] ?? `/a/${ref.slice(6)}`,
})
r.onEffectError = (e) => console.log('effect error', e.effectId, e.message)
r.setSize(w, h)
const pattern = q.get('pattern')
const input: RenderInput = {
  setup,
  scene,
  catalog: catalog as unknown as Catalog,
  effects,
  t: num('t', 5),
  clock: num('clock', 12),
  now: num('now', 0),
  blackout: num('blackout', 0),
  pattern: pattern === 'gray' ? { kind: 'gray', axis: (q.get('axis') as 'x' | 'y') ?? 'x', bit: num('bit', 0), inverse: q.get('inverse') === '1' } : pattern ? ({ kind: pattern } as RenderInput['pattern']) : null,
  testPattern: (q.get('test') as Setup['testPattern']) ?? null,
  hideMapping: q.get('mapping') === '0',
  hideBackdrop: q.get('backdrop') === '0',
  outline: q.get('outline') ? { surfaceIds: q.get('outline')!.split(','), color: '#ff3b30', width: 4 } : null,
}
const w2 = window as unknown as Record<string, unknown>
w2.__renderer = r
await r.ready(input)
const t0 = performance.now()
r.render(input)
const N = num('bench', 0)
for (let i = 0; i < N; i++) r.render({ ...input, clock: input.clock + i / 60, t: input.t + i / 60 })
r.readPixels(0, 0, 1, 1)
w2.__ms = (performance.now() - t0) / Math.max(1, N + 1)
w2.__errors = r.effectErrors()
w2.__done = true
if (q.get('animate')) {
  let c = input.clock
  const loop = () => { c += 1 / 60; r.render({ ...input, clock: c, t: (input.t + c) % 20 }); requestAnimationFrame(loop) }
  loop()
}
