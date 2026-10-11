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
import { patchOpShape, sceneShape } from './scene/schema'
import { setupShape } from './setup/schema'
import { showShape } from './show/schema'
import type { Scene } from './scene/types'

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
}

const envelope = obj({ t: str, ch: nullable(str), id: nullable(str), re: nullable(str), v: nullable(int), base: nullable(int) })
const payloads: Record<string, Guard> = {
  hello: obj({ token: nullable(str), role: lit('output', 'editor', 'remote', 'agent'), name: str, caps: arr(str), build: str }),
  welcome: obj({ device: deviceShape, serverTime: num, show: showShape, catalogVersion: num }),
  ping: obj({ t0: num }),
  pong: obj({ t0: num, ts: num }),
  sub: any,
  snapshot: any,
  param: obj({ path: str, value: any, by: nullable(str) }),
  patch: arr(patchOpShape),
  patched: obj({ ops: arr(patchOpShape), by: str }),
  reject: obj({ code: str, message: nullable(str) }),
  cmd: obj({ name: str, args: any }),
  ack: any,
  error: obj({ code: str, message: str }),
  rpc: obj({ method: str, args: any }),
  'rpc.result': any,
  telemetry: telemetryShape,
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
      if (m.t === 'snapshot' && m.ch?.startsWith('setup:')) assertShape(setupShape, m.d, 'setup snapshot')
    }
  })

  it('decodes the catalog', () => {
    expect(() => assertShape(catalogShape, read('catalog.json'), 'catalog')).not.toThrow()
  })

  it('rejects a drifted shape', () => {
    const scene = read('fixtures/scene.json') as Scene
    const bad = { ...scene, points: [{ id: 'p', x: '1', y: 2 }] }
    expect(() => assertShape(sceneShape, bad, 'scene')).toThrow(/points\[0\]\.x/)
    expect(sceneShape({ ...scene, objects: [{ ...scene.objects[0], visible: 'yes' }] }, '')).toHaveLength(1)
    void bool
  })
})
