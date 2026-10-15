import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { arr, assertShape, bool, int, lit, nullable, num, obj, str, any, type Guard } from '../shared/lib/guard'
import { agentEventShape, agentSessionShape } from './agent/schema'
import { assetShape } from './asset/schema'
import { catalogShape } from './catalog/schema'
import { deviceShape, telemetryShape } from './device/schema'
import { draftShape } from './draft/schema'
import { effectShape } from './effect/schema'
import { presetShape } from './preset/schema'
import { patchOpShape, sceneShape, sceneSummaryShape } from './scene/schema'
import { setupShape } from './setup/schema'
import { showShape } from './show/schema'
import type { Scene } from './scene/types'
import { soundPlayShape, soundStopShape } from './sound/schema'
import { importJobShape, videoShape } from './video/schema'

// (§14) a library sound: an asset of kind sound with its name, duration and peaks
const soundShape: Guard = (v, p) => [...assetShape(v, p), ...obj({ kind: lit('sound'), name: str, duration: num, peaks: arr(num) })(v, p)]
const settingsShape = obj({ agentMayPreview: bool, agentMayGoLive: bool, agentMayApply: nullable(bool), agentLiveEdits: nullable(bool) })
/** snapshot payloads by channel (prefix before ':') */
const snapshots: Record<string, Guard> = {
  sounds: arr(soundShape),
  videos: arr(videoShape),
  scenes: arr(sceneSummaryShape),
  import: importJobShape,
  show: showShape,
  setup: setupShape,
  scene: sceneShape,
}
/** cmd args by command name (§14) */
const cmdArgs: Record<string, Guard> = {
  'sound.play': obj({ padId: nullable(str), soundId: nullable(str), volume: nullable(num), sceneId: nullable(str) }),
  'sound.stop': obj({ playId: nullable(str), padId: nullable(str) }),
  'show.audio': obj({ output: nullable(lit('projector', 'editor', 'phone')), volume: nullable(num), muted: nullable(bool) }),
}

const dir = fileURLToPath(new URL('../../../contract/', import.meta.url))
const read = (f: string) => JSON.parse(readFileSync(dir + f, 'utf8'))

const byFile: Record<string, Guard> = {
  'agent-event.json': agentEventShape,
  'agent-session.json': agentSessionShape,
  'asset.json': assetShape,
  'device.json': deviceShape,
  'draft.json': draftShape,
  'effect-glsl.json': effectShape,
  'preset.json': presetShape,
  'scene.json': sceneShape,
  'setup.json': setupShape,
  'show.json': showShape,
  'sound.json': soundShape,
  'video.json': videoShape,
  'import.json': importJobShape,
  'scene-summary.json': arr(sceneSummaryShape),
  'settings.json': settingsShape,
}

const envelope = obj({ t: str, ch: nullable(str), id: nullable(str), re: nullable(str), v: nullable(int), base: nullable(int) })
const payloads: Record<string, Guard> = {
  hello: obj({ token: nullable(str), role: lit('output', 'editor', 'remote', 'agent'), name: str, caps: arr(str), build: str }),
  welcome: obj({ device: deviceShape, serverTime: num, show: showShape, catalogVersion: num }),
  ping: obj({ t0: num }),
  pong: obj({ t0: num, ts: num }),
  sub: any,
  snapshot: any,
  param: obj({ path: str, value: any, pointId: nullable(str), by: nullable(str) }),
  patch: arr(patchOpShape),
  patched: obj({ ops: arr(patchOpShape), by: str }),
  reject: obj({ code: str, message: nullable(str) }),
  cmd: obj({ name: str, args: any }),
  ack: any,
  error: obj({ code: str, message: str }),
  rpc: obj({ method: str, args: any }),
  'rpc.result': any,
  telemetry: telemetryShape,
  'sound.play': soundPlayShape,
  'sound.stop': soundStopShape,
}

describe('contract fixtures', () => {
  const files = readdirSync(dir + 'fixtures').filter((f) => f.endsWith('.json'))

  it('has a decoder for every fixture file', () => {
    for (const f of files) expect(f === 'ws-messages.json' || f in byFile, f).toBe(true)
  })

  for (const [f, g] of Object.entries(byFile)) {
    it(`decodes ${f}`, () => {
      expect(() => assertShape(g, read('fixtures/' + f), f)).not.toThrow()
    })
  }

  it('decodes every ws message', () => {
    const msgs = read('fixtures/ws-messages.json') as Array<{ t: string; d?: unknown; ch?: string }>
    for (const m of msgs) {
      assertShape(envelope, m, `envelope ${m.t}`)
      const g = payloads[m.t]
      expect(g, `payload guard for ${m.t}`).toBeTruthy()
      if (m.d !== undefined) assertShape(g, m.d, `payload ${m.t}`)
      if (m.t === 'snapshot' && m.ch) {
        const sg = snapshots[m.ch.split(':')[0]]
        if (sg) assertShape(sg, m.d, `${m.ch} snapshot`)
      }
      if (m.t === 'cmd') {
        const d = m.d as { name: string; args?: unknown }
        if (cmdArgs[d.name]) assertShape(cmdArgs[d.name], d.args ?? {}, `cmd ${d.name}`)
      }
    }
  })

  it('decodes the §14 messages the hub routes', () => {
    const msgs = read('fixtures/ws-messages.json') as Array<{ t: string; d?: unknown; ch?: string }>
    for (const t of ['sound.play', 'sound.stop']) expect(msgs.some((m) => m.t === t && !m.ch), t).toBe(true)
    for (const ch of ['sounds', 'scenes']) expect(msgs.some((m) => m.t === 'snapshot' && m.ch === ch), ch).toBe(true)
    expect(msgs.some((m) => m.t === 'snapshot' && m.ch?.startsWith('import:'))).toBe(true)
    // a sound asset without peaks is not a library sound
    const snd = read('fixtures/sound.json')
    expect(soundShape({ ...snd, peaks: undefined }, '')).not.toHaveLength(0)
    expect(soundShape({ ...snd, kind: 'photo' }, '')).not.toHaveLength(0)
    expect(read('catalog.json').videoParams).toBeTruthy()
  })

  it('decodes the catalog', () => {
    expect(() => assertShape(catalogShape, read('catalog.json'), 'catalog')).not.toThrow()
  })

  it('carries the §15 light, attachments, motion and kind', () => {
    const scene = read('fixtures/scene.json') as Scene
    expect(scene.kind).toBe('mapping')
    expect(scene.backdrop.static.layers).toHaveLength(0)
    expect(scene.backdrop.static.light?.focus).toBeGreaterThan(0)
    expect(scene.backdrop.static.attachments?.[0].gobo).toBe('plate-grid-window')
    expect(scene.format).toBe(6)
    // (§20 "Step 0") the opening step decodes
    expect(scene.intro?.source.mode).toBe('live')
    expect(scene.intro?.converge).toBe(true)
    expect(scene.backdrop.static.attachments?.[0].motion?.preset).toBe('sun-lr')
    const cat = read('catalog.json')
    expect(cat.version).toBe(9)
    expect(cat.gobos.length).toBeGreaterThanOrEqual(45)
    // (catalog 6) every attachment is a metal plate with the reference photo it follows; (catalog 8) no metal thumbnail
    for (const g of cat.gobos) {
      expect(g.metalThumb).toBeUndefined()
      expect(g.source).toMatch(/\.png, /)
    }
    expect(cat.gobos.filter((g: { family?: string }) => g.family === 'window')).toHaveLength(13)
    expect(cat.windowParamGroups.map((g: { id: string }) => g.id)).toEqual(['grid', 'frame', 'arch', 'shape', 'lattice', 'blinds'])
    for (const g of cat.gobos) expect(cat.goboCategories.map((c: { id: string }) => c.id)).toContain(g.category)
    expect(cat.motionPresets.map((m: { id: string }) => m.id)).toEqual(['sun-lr', 'sun-rl', 'drift', 'sway', 'rise', 'set'])
    // an attachment needs its gobo
    expect(sceneShape({ ...scene, backdrop: { ...scene.backdrop, static: { ...scene.backdrop.static, attachments: [{ id: 'att_x' }] } } }, '').length).toBeGreaterThan(0)
  })

  it('carries the §20 converge clip, hold and show.converge', () => {
    const scene = read('fixtures/scene.json') as Scene
    const clip = scene.timeline.clips.find((c) => c.effect === 'converge')!
    expect(clip).toMatchObject({ start: 0, end: 2, hold: 'step', params: { from: 'current', source: 'static', ease: 'inOut', edge: 6, outline: true } })
    expect(scene.timeline.tracks.find((t) => t.id === clip.trackId)?.target).toEqual({ kind: 'object', id: 'obj_cube' })
    expect(sceneShape({ ...scene, timeline: { ...scene.timeline, clips: [{ ...clip, hold: 'yes' }] } }, '')).not.toHaveLength(0)
    const cat = read('catalog.json')
    const fx = cat.effects.find((e: { id: string }) => e.id === 'converge')
    expect(Object.keys(fx.params)).toEqual(['from', 'source', 'ease', 'edge', 'outline'])
    // (§21) the morph clip, its string hold, and the morph and shape effects
    const morph = scene.timeline.clips.find((c) => c.effect === 'morph')!
    expect(morph).toMatchObject({ hold: 'forever', params: { from: 'object', to: 'circle', toR: 240, color: '#ffffff', colorTo: '#ff3b30' } })
    expect(sceneShape({ ...scene, timeline: { ...scene.timeline, clips: [{ ...morph, hold: true }] } }, '')).toHaveLength(0)
    expect(sceneShape({ ...scene, timeline: { ...scene.timeline, clips: [{ ...morph, hold: 'always' }] } }, '')).not.toHaveLength(0)
    for (const id of ['morph', 'shape']) expect(cat.effects.find((e: { id: string }) => e.id === id)?.params.fill.options).toEqual(['color', 'light'])
    const msgs = read('fixtures/ws-messages.json') as Array<{ t: string; d?: { name?: string; args?: Record<string, unknown> } }>
    expect(msgs.find((m) => m.t === 'cmd' && m.d?.name === 'show.converge')?.d?.args).toEqual({ sceneId: 'scn_desk', source: 'static', duration: 2, objectId: 'obj_cube' })
  })

  it('rejects a drifted shape', () => {
    const scene = read('fixtures/scene.json') as Scene
    const bad = { ...scene, points: [{ id: 'p', x: '1', y: 2 }] }
    expect(() => assertShape(sceneShape, bad, 'scene')).toThrow(/points\[0\]\.x/)
    expect(sceneShape({ ...scene, objects: [{ ...scene.objects[0], visible: 'yes' }] }, '')).toHaveLength(1)
    void bool
  })
})
