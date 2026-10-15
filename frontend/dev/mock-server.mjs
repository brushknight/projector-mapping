#!/usr/bin/env node
/**
 * A small stand-in for the Go backend, built from contract/fixtures and docs/protocol.md, for frontend dev and e2e.
 * Not the product: no persistence, no auth, no validation beyond the basics.
 *
 *   node dev/mock-server.mjs            → http://localhost:7400
 *   PORT=7499 node dev/mock-server.mjs  → another port (the e2e run uses 7499)
 *   MOCK_CAMERA=1                       → sends a fake phone camera feed on the `camera` channel
 *
 * Test hooks (not part of the protocol): GET /__mock/log?t=param, POST /__mock/rpc {method,args,role?}, POST /__mock/attach {agent?},
 * POST /__mock/reset, GET /__mock/state.
 *
 * Protocol §14 (show control, sound and video), all in memory:
 *   scenes     GET/POST /scenes {name, setupId?, duplicate?}, PATCH /scenes/{id} {name}, DELETE (409 scene_active),
 *              channel `scenes` (summary list, v = ms timestamp; also after a patch that changes /name)
 *   audio      cmd show.audio / POST /show/audio {output?, volume?, muted?}; show.audio.loops toggles looping pads
 *   sounds     GET/POST /sounds (multipart file, name?, duration?, peaks? kept as sent), PATCH/DELETE /sounds/{sha},
 *              POST /assets kind=sound does the same; channel `sounds`. Seeded with two generated WAVs under the
 *              fixture shas: 5d1e0a "rain on glass" (12.48 s) and a77c31 "thunder" (3 s), served at /a/{sha}.
 *   playing    cmd sound.play {padId?|soundId?, volume?, sceneId?} / POST /sounds/play, cmd sound.stop / POST
 *              /sounds/stop: direct `sound.play` / `sound.stop` messages to every connection with cap `audio` whose
 *              role matches show.audio.output (projector → output, editor → editor, phone → remote); 409 no_audio
 *              (cmd: error no_audio) when there is none. show.go fires the started cue's `sound` (with cueId).
 *   outputs    GET /outputs/displays (two fake displays), POST /outputs/launch {display, route} records the launch (§17)
 *   videos     GET/POST /videos (multipart file), PATCH/DELETE /videos/{id}, GET /videos/tools, POST /videos/import
 *              {url, maxHeight?, start?, end?, name?} (400 invalid_url), GET /videos/import/{id}; channels `videos`
 *              and `import:{id}`. Seeded with one embed video (youtube:aqz-KE-bpKQ, the fixture's lay_waves).
 *              Without yt-dlp (the default) an import is `done` at once with mode `embed`. MOCK_YTDLP=1 or
 *              POST /__mock/tools {ytdlp, ffmpeg} pretends yt-dlp exists: the job runs (mode `download`) with a
 *              progress snapshot on `import:{id}` every 150 ms (0 → 0.8 download, 0.95 trim, 1 store) and ends with
 *              a Video `asset:<sha>` (fake bytes, so it draws no texture).
 *   hooks      GET /__mock/state also lists clients with caps; POST /__mock/send {role?, cap?, t, d} sends any message.
 */
import { createHash } from 'node:crypto'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const PORT = Number(process.env.PORT ?? 7400)
const fixture = (f) => JSON.parse(readFileSync(join(root, 'contract/fixtures', f), 'utf8'))
const catalogDoc = JSON.parse(readFileSync(join(root, 'contract/catalog.json'), 'utf8'))
const catalogAssets = join(root, 'backend/internal/catalog/assets')
const nowNs = () => Date.now() * 1e6
const clone = (v) => JSON.parse(JSON.stringify(v))
let seq = 0
const rid = (p) => `${p}_${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`

// ── JSON Patch (same semantics as src/shared/lib/jsonPatch.ts) ───────────────
const parsePtr = (p) => (p === '' ? [] : p.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~')))
function getAt(doc, path) {
  let cur = doc
  for (const k of parsePtr(path)) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = Array.isArray(cur) ? cur[k === '-' ? cur.length : Number(k)] : cur[k]
  }
  return cur
}
function parentOf(doc, path) {
  const keys = parsePtr(path)
  const last = keys.pop()
  let cur = doc
  for (const k of keys) {
    cur = Array.isArray(cur) ? cur[Number(k)] : cur?.[k]
    if (cur == null) throw new Error(`path not found: ${path}`)
  }
  return [cur, last]
}
function applyOp(doc, op) {
  if (op.op === 'test') {
    if (JSON.stringify(getAt(doc, op.path)) !== JSON.stringify(op.value)) throw new Error('test failed')
    return doc
  }
  if (op.path === '' && (op.op === 'replace' || op.op === 'add')) return clone(op.value)
  if (op.op === 'move' || op.op === 'copy') {
    const v = clone(getAt(doc, op.from))
    if (op.op === 'move') doc = applyOp(doc, { op: 'remove', path: op.from })
    return applyOp(doc, { op: 'add', path: op.path, value: v })
  }
  const [parent, key] = parentOf(doc, op.path)
  if (Array.isArray(parent)) {
    const i = key === '-' ? parent.length : Number(key)
    if (op.op === 'add') {
      if (i < 0 || i > parent.length) throw new Error(`index out of range: ${op.path}`)
      parent.splice(i, 0, clone(op.value))
    } else if (op.op === 'replace') {
      if (i < 0 || i >= parent.length) throw new Error(`index out of range: ${op.path}`)
      parent[i] = clone(op.value)
    } else if (op.op === 'remove') {
      if (i < 0 || i >= parent.length) throw new Error(`index out of range: ${op.path}`)
      parent.splice(i, 1)
    }
  } else if (parent && typeof parent === 'object') {
    if (op.op === 'remove' || op.op === 'replace') if (!(key in parent)) throw new Error(`missing: ${op.path}`)
    if (op.op === 'remove') delete parent[key]
    else parent[key] = clone(op.value)
  } else throw new Error(`bad path: ${op.path}`)
  return doc
}
const applyPatch = (doc, ops) => ops.reduce((d, op) => applyOp(d, op), clone(doc))
const leafOnly = (ops, doc) => ops.every((op) => op.op === 'replace' && (getAt(doc, op.path) === null || typeof getAt(doc, op.path) !== 'object'))

// ── state ────────────────────────────────────────────────────────────────────
// ── generated sounds (§14): small mono 16-bit WAVs so Web Audio can decode them in e2e ─
function wav(seconds, sample, rate = 8000) {
  const n = Math.round(seconds * rate)
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + n * 2, 4)
  b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(rate, 24)
  b.writeUInt32LE(rate * 2, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36)
  b.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(sample(i / rate) * 32767))), 44 + i * 2)
  return b
}
function peaksOf(seconds, sample, count = 128) {
  const out = []
  for (let k = 0; k < count; k++) {
    let m = 0
    for (let j = 0; j < 40; j++) m = Math.max(m, Math.abs(sample(((k + j / 40) / count) * seconds)))
    out.push(Math.round(m * 100) / 100)
  }
  return out
}
let noiseSeed = 7
const noise = () => ((noiseSeed = (noiseSeed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1
const rainSample = (t) => noise() * 0.25 * (0.6 + 0.4 * Math.sin(t * 1.3))
const thunderSample = (t) => (Math.sin(2 * Math.PI * 55 * t) * 0.5 + noise() * 0.3) * Math.exp(-t * 1.2)
function seededSounds() {
  const base = fixture('sound.json')
  const mk = (sha, name, seconds, sample) => {
    const data = wav(seconds, sample)
    const asset = { ...base, sha, mime: 'audio/wav', bytes: data.length, name, duration: seconds, peaks: sha === base.sha ? base.peaks : peaksOf(seconds, sample) }
    return { asset, data }
  }
  return [mk('a77c31', 'thunder', 3, thunderSample), mk(base.sha, base.name, base.duration, rainSample)]
}
const SEEDED_SOUNDS = seededSounds()

let S
function reset() {
  const scene = fixture('scene.json')
  const setup = fixture('setup.json')
  const showFx = fixture('show.json')
  S = {
    setups: new Map([[setup.id, { doc: setup, version: 1 }]]),
    scenes: new Map([[scene.id, { doc: scene, version: scene.version, undo: [], redo: [] }]]),
    history: new Map([[scene.id, []]]),
    show: { activeSetupId: setup.id, activeSceneId: scene.id, onAir: true, transport: { state: 'stopped', startedAt: 0, offset: 0, cue: 0 }, version: 1, audio: { ...showFx.audio, volume: 1, loops: [] } },
    presets: [fixture('preset.json')],
    effects: [fixture('effect-glsl.json')],
    devices: new Map(),
    drafts: new Map(),
    sessions: new Map(),
    events: new Map(),
    calibs: new Map(),
    assets: new Map(SEEDED_SOUNDS.map((x) => [x.asset.sha, { asset: clone(x.asset), data: x.data }])),
    // newest first
    sounds: SEEDED_SOUNDS.map((x) => clone(x.asset)).reverse(),
    videos: [{ id: 'vid_bunny', name: 'big buck bunny', ref: 'youtube:aqz-KE-bpKQ', source: 'youtube', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', youtubeId: 'aqz-KE-bpKQ', sha: null, thumb: null, duration: 0, width: 0, height: 0, createdAt: '2026-10-14T10:00:00Z' }],
    imports: new Map(),
    tools: { ytdlp: !!process.env.MOCK_YTDLP, ffmpeg: !!process.env.MOCK_YTDLP },
    settings: { agentMayPreview: false, agentMayGoLive: false, agentMayApply: false, agentLiveEdits: false },
    log: [],
    camera: null,
    pairCode: 'K7Q2',
  }
}
reset()

// ── hub ──────────────────────────────────────────────────────────────────────
const clients = new Set()
const pendingRpc = new Map()
const paramTimers = new Map()

const send = (c, env) => c.ws.readyState === 1 && c.ws.send(JSON.stringify(env))
const subscribers = (ch) => [...clients].filter((c) => c.subs.has(ch))
const broadcast = (ch, env, except) => subscribers(ch).forEach((c) => c !== except && send(c, { ch, ...env }))

function devicesList() {
  return [...S.devices.values()]
}
function channelDoc(ch) {
  if (ch === 'show') return { v: S.show.version, d: S.show }
  if (ch === 'presets') return { v: 1, d: S.presets }
  if (ch === 'devices') return { v: 1, d: devicesList() }
  if (ch === 'camera') return null
  if (ch === 'scenes') return { v: Date.now(), d: sceneList() }
  if (ch === 'sounds') return { v: Date.now(), d: S.sounds }
  if (ch === 'videos') return { v: Date.now(), d: S.videos }
  const [kind, id] = ch.split(':')
  if (kind === 'import') { const j = S.imports.get(id); return j ? { v: j.n, d: j.job } : null }
  if (kind === 'scene') { const s = S.scenes.get(id); return s ? { v: s.version, d: s.doc } : null }
  if (kind === 'setup') { const s = S.setups.get(id); return s ? { v: s.version, d: s.doc } : null }
  if (kind === 'draft') { const d = S.drafts.get(id); return d ? { v: d.ops.length, d } : null }
  if (kind === 'agent') return { v: (S.events.get(id) ?? []).length, d: { session: S.sessions.get(id) ?? null, events: S.events.get(id) ?? [] } }
  if (kind === 'calib') { const c = S.calibs.get(id); return c ? { v: c.progress.done, d: c.progress } : null }
  return null
}
function pushSnapshot(ch) {
  const doc = channelDoc(ch)
  if (doc) broadcast(ch, { t: 'snapshot', v: doc.v, d: doc.d })
}
const sceneList = () => [...S.scenes.values()].map((s) => ({ id: s.doc.id, name: s.doc.name, setupId: s.doc.setupId, version: s.version, kind: kindOf(s.doc), mode: s.doc.mode }))

// ── §15 scene kinds and templates (the Go server builds the same documents) ───
function kindOf(doc) {
  if (doc.kind) return doc.kind
  if (doc.objects?.length) return 'mapping'
  return doc.mode === 'objects' ? 'mapping' : doc.mode ?? 'static'
}
const kindMode = (k) => (k === 'mapping' ? 'objects' : k)
const schemaDefaults = (schema) => Object.fromEntries(Object.entries(schema ?? {}).map(([k, v]) => [k, v.default]))
function mockAttachment(gobo, id) {
  const item = catalogDoc.gobos.find((g) => g.id === gobo)
  const params = { ...schemaDefaults(catalogDoc.goboParams), ...(item?.defaults ?? {}), ...schemaDefaults(item?.params) }
  // (§16) a window preset's geometry stays out of the params: missing params take the preset
  if (item?.family === 'window') for (const g of catalogDoc.windowParamGroups ?? []) for (const k of g.params) delete params[k]
  return {
    id, gobo, name: item?.name ?? gobo, visible: true, opacity: 1, rotation: item?.attachment?.rotation ?? 0, offsetX: 0, offsetY: 0,
    scale: item?.attachment?.scale ?? 1, params, motion: null,
  }
}
/** (§16) the templates' window: the 6-pane grid window preset, a little low-sun stretched and larger, as on the server */
function templateWindow() {
  const a = mockAttachment('plate-grid-window', rid('att'))
  a.params.throw = 0.25
  a.scale = 1.25
  return a
}
function mockLight(over = {}) {
  return { intensity: 0.85, focus: 1, color: { mode: 'cct', kelvin: catalogDoc.stackLight?.kelvin ?? 5600, tint: 0, hue: 212, sat: 0.7 }, fx: { kind: 'none', speed: 0.35 }, colorLayer: null, fringe: 0.2, vignette: 0, backgroundFocus: 1, slide: { x: 0, y: 0 }, motion: null, ...over }
}
const TEMPLATE_OF_KIND = { static: 'static-window', live: 'live-window-tree', color: 'color-ember', scenery: 'scenery-flowers', mapping: 'mapping-empty' }
function sceneFromTemplate(id, name, setupId, template) {
  const doc = { id, setupId, name, version: 1, kind: 'static', mode: 'static', backdrop: { static: { layers: [], light: mockLight(), attachments: [] }, live: { layers: [], light: null, attachments: [] }, color: { layers: [] }, scenery: { layers: [] } }, underlay: { on: false, from: 'static', level: 0.35 }, points: [], objects: [], sounds: { pads: [] }, timeline: { duration: 20, tracks: [], clips: [], cues: [] } }
  const warm = { mode: 'cct', kelvin: 3200, tint: 0, hue: 212, sat: 0.7 }
  const sun = catalogDoc.motionPresets?.find((m) => m.id === 'sun-lr')?.motion
  switch (template) {
    case 'static-window': {
      const a = templateWindow()
      // off, parked in the middle of its path (phase 0.5), ready to play
      a.motion = sun ? { ...clone(sun), on: false, phase: 0.5, startedAt: Date.now() } : null
      doc.backdrop.static = { layers: [], light: mockLight({ color: warm, intensity: 0.85 }), attachments: [a] }
      break
    }
    case 'live-window-tree': {
      const tree = catalogDoc.procedural.find((x) => x.id === 'tree-sway')
      doc.kind = doc.mode = 'live'
      doc.backdrop.live = {
        light: mockLight({ color: warm, focus: 0.68 }),
        attachments: [templateWindow()],
        layers: [{ id: rid('lay'), kind: 'procedural', ref: 'tree-sway', name: tree?.name ?? 'tree sway', visible: true, opacity: 0.9, blend: 'multiply', light: { intensity: 0.8, softness: 0.5, angle: 0, scale: 1, offsetX: 0, offsetY: 0, color: warm, fx: { kind: 'none', speed: 0.35 } }, params: schemaDefaults(tree?.params) }],
      }
      break
    }
    case 'color-ember': {
      const g = catalogDoc.gradients.find((x) => x.id === 'ember')
      doc.kind = doc.mode = 'color'
      doc.backdrop.color = { layers: [{ id: rid('lay'), kind: 'gradient', ref: 'ember', name: 'ember', visible: true, opacity: 1, blend: 'normal', light: null, params: clone(g?.defaults ?? {}) }] }
      break
    }
    case 'scenery-flowers':
      doc.kind = doc.mode = 'scenery'
      doc.backdrop.scenery = { layers: [{ id: rid('lay'), kind: 'photo', ref: 'flowers', name: 'flowers', visible: true, opacity: 1, blend: 'normal', light: null, params: schemaDefaults(catalogDoc.photoParams) }] }
      break
    case 'mapping-empty':
      doc.kind = 'mapping'
      doc.mode = 'objects'
      break
  }
  return doc
}

// ── §14 audio routing ────────────────────────────────────────────────────────
const AUDIO_ROLE = { projector: 'output', editor: 'editor', phone: 'remote' }
const audioClients = () => [...clients].filter((c) => c.caps?.includes('audio') && c.role === AUDIO_ROLE[S.show.audio?.output ?? 'projector'])
const fail = (code, message) => Object.assign(new Error(message), { code })
const NO_AUDIO = 'Nothing plays sound right now. Open /out on the projector computer and click it once.'
function soundName(sha) {
  return S.sounds.find((x) => x.sha === sha)?.name
}
function sendAudio(t, d) {
  const to = audioClients()
  to.forEach((c) => send(c, { t, d }))
  return to.length
}
/** cmd sound.play / POST /sounds/play */
function soundPlay(args = {}) {
  if (args.padId) {
    const sc = S.scenes.get(String(args.sceneId ?? S.show.activeSceneId))
    const pad = sc?.doc.sounds?.pads?.find((p) => p.id === args.padId)
    if (!pad) throw fail('not_found', `Pad ${args.padId} does not exist.`)
    if (!pad.sound) throw fail('bad_request', 'This pad has no sound.')
    const loops = S.show.audio.loops ?? (S.show.audio.loops = [])
    if (pad.loop && loops.includes(pad.id)) {
      sendAudio('sound.stop', { padId: pad.id })
      S.show.audio.loops = loops.filter((x) => x !== pad.id)
      bumpShow()
      return { stopped: true }
    }
    if (!audioClients().length) throw fail('no_audio', NO_AUDIO)
    const playId = rid('ply')
    const outputs = sendAudio('sound.play', { playId, sound: pad.sound, padId: pad.id, name: pad.name, volume: (pad.volume ?? 1) * Number(args.volume ?? 1), loop: !!pad.loop })
    if (pad.loop) {
      loops.push(pad.id)
      bumpShow()
    }
    return { playId, outputs }
  }
  if (!args.soundId) throw fail('bad_request', 'Send padId or soundId.')
  if (!audioClients().length) throw fail('no_audio', NO_AUDIO)
  const playId = rid('ply')
  const outputs = sendAudio('sound.play', { playId, sound: String(args.soundId), name: soundName(args.soundId), volume: Number(args.volume ?? 1), loop: false })
  return { playId, outputs }
}
/** cmd sound.stop / POST /sounds/stop */
function soundStop(args = {}) {
  const d = {}
  if (args.playId) d.playId = String(args.playId)
  if (args.padId) d.padId = String(args.padId)
  sendAudio('sound.stop', d)
  const loops = S.show.audio.loops ?? []
  const left = d.playId ? loops : d.padId ? loops.filter((x) => x !== d.padId) : []
  if (left.length !== loops.length) {
    S.show.audio.loops = left
    bumpShow()
  }
  return {}
}
function clearLoops() {
  for (const padId of S.show.audio.loops ?? []) sendAudio('sound.stop', { padId })
  S.show.audio.loops = []
}
function cueSound(sortedCues, idx) {
  const cue = sortedCues[idx]
  if (!cue?.sound?.sound) return
  sendAudio('sound.play', { playId: rid('ply'), sound: cue.sound.sound, cueId: cue.id, name: soundName(cue.sound.sound) ?? cue.label, volume: cue.sound.volume ?? 1, loop: false })
}

function bumpShow() {
  S.show.version++
  pushSnapshot('show')
}
function playheadOf(t) {
  return t.state === 'playing' ? t.offset + (nowNs() - t.startedAt) / 1e9 : t.offset
}

/** Commits ops to a scene or setup document (versioned). */
function commit(ch, ops, by, re) {
  const [kind, id] = ch.split(':')
  const store = kind === 'scene' ? S.scenes.get(id) : kind === 'setup' ? S.setups.get(id) : null
  if (!store) throw Object.assign(new Error(`no document for ${ch}`), { code: 'not_found' })
  const before = store.doc
  store.doc = applyPatch(store.doc, ops)
  store.version++
  if (kind === 'scene') {
    store.doc.version = store.version
    store.undo.push(before)
    store.redo = []
    S.history.get(id)?.push({ version: store.version, author: by, ts: new Date().toISOString(), ops })
  }
  broadcast(ch, { t: 'patched', v: store.version, re, d: { ops, by } })
  if (kind === 'scene' && ops.some((o) => o.path === '/name' || o.path === '')) pushSnapshot('scenes')
  return store.version
}

function commitDraft(id, ops, by, re, onValid) {
  const d = S.drafts.get(id)
  if (!d) throw Object.assign(new Error(`no draft ${id}`), { code: 'not_found' })
  // validate against the scene view
  const sc = S.scenes.get(d.sceneId)
  applyPatch(sc.doc, [...d.ops, ...ops])
  onValid?.()
  d.ops.push(...ops)
  void by
  void re
  // as the Go server does (protocol §9): the whole Draft as a snapshot
  pushSnapshot(`draft:${id}`)
}

function showAction(action, args = {}) {
  const t = S.show.transport
  const scene = S.scenes.get(S.show.activeSceneId)?.doc
  const cues = scene?.timeline.cues ?? []
  switch (action) {
    case 'play':
      if (t.state !== 'playing') Object.assign(t, { state: 'playing', startedAt: nowNs() })
      break
    case 'pause':
      Object.assign(t, { offset: playheadOf(t), state: 'paused' })
      break
    case 'stop':
      Object.assign(t, { state: 'stopped', offset: 0, startedAt: 0, cue: 0 })
      clearLoops()
      break
    case 'audio': {
      const a = S.show.audio
      if (args.output != null) {
        if (!['projector', 'editor', 'phone'].includes(args.output)) throw fail('bad_request', 'output must be projector, editor or phone.')
        a.output = args.output
      }
      if (args.volume != null) a.volume = Math.max(0, Math.min(1, Number(args.volume)))
      if (args.muted != null) a.muted = !!args.muted
      break
    }
    case 'seek': {
      const at = Number(args.t ?? 0)
      Object.assign(t, { offset: at, startedAt: nowNs() })
      break
    }
    case 'go': {
      if (!scene) throw Object.assign(new Error('No active scene.'), { code: 'no_scene' })
      // backend §9: from stopped GO starts cue `cue` (0 after a stop); from playing or paused the next one
      const sorted = [...cues].sort((a, b) => a.at - b.at)
      const idx = t.state === 'stopped' ? t.cue ?? 0 : (t.cue ?? 0) + 1
      if (sorted.length && idx >= sorted.length) throw Object.assign(new Error('That was the last cue.'), { code: 'no_cue' })
      Object.assign(t, { state: 'playing', offset: sorted[idx]?.at ?? 0, startedAt: nowNs(), cue: idx })
      cueSound(sorted, idx)
      break
    }
    case 'back': {
      const ph = playheadOf(t)
      let idx = -1
      cues.forEach((c, i) => c.at < ph - 0.5 && (idx = i))
      Object.assign(t, { offset: cues[Math.max(0, idx)]?.at ?? 0, startedAt: nowNs(), cue: Math.max(0, idx) })
      break
    }
    case 'blackout':
      S.show.onAir = !args.on
      break
    case 'activate': {
      const s = S.scenes.get(String(args.sceneId))
      if (!s) throw Object.assign(new Error(`Scene ${args.sceneId} does not exist.`), { code: 'not_found' })
      S.show.activeSceneId = s.doc.id
      S.show.activeSetupId = s.doc.setupId
      // (§15) its kind's mode goes on air
      const want = kindMode(kindOf(s.doc))
      if (s.doc.mode !== want) commit(`scene:${s.doc.id}`, [{ op: 'replace', path: '/mode', value: want }], 'server')
      Object.assign(t, { state: 'stopped', offset: 0, startedAt: 0, cue: 0 })
      S.show.preview = null
      clearLoops()
      break
    }
    case 'solo': {
      // protocol §12: only these surfaces on the wall until `until`, renewable, [] turns it off
      const ids = Array.isArray(args.surfaceIds) ? args.surfaceIds.map(String) : []
      const fill = args.fill ?? 'content'
      if (!['content', 'white', 'grid'].includes(fill)) throw Object.assign(new Error('fill must be content, white or grid.'), { code: 'bad_request' })
      const secs = args.seconds == null ? 60 : Number(args.seconds)
      if (!(secs >= 1 && secs <= 600)) throw Object.assign(new Error('seconds must be 1..600.'), { code: 'bad_request' })
      clearTimeout(soloTimer)
      if (!ids.length) delete S.show.solo
      else {
        S.show.solo = { surfaceIds: ids, fill, until: nowNs() + secs * 1e9 }
        soloTimer = setTimeout(() => {
          delete S.show.solo
          bumpShow()
        }, secs * 1000)
      }
      break
    }
    case 'preview': {
      if (!args.draftId) {
        S.show.preview = null
        Object.assign(t, { state: 'stopped', offset: 0, startedAt: 0, cue: 0 })
      } else {
        S.show.preview = { draftId: String(args.draftId) }
        Object.assign(t, { state: args.play ? 'playing' : 'paused', offset: Number(args.t ?? 0), startedAt: nowNs() })
      }
      break
    }
    default:
      throw Object.assign(new Error(`Unknown action ${action}.`), { code: 'bad_request' })
  }
  bumpShow()
  return S.show
}
let soloTimer = null

// test patterns turn off by themselves after `seconds` (default 60), as the Go server does (protocol §1 Setup)
const patternTimers = new Map()
function setTestPattern(args) {
  const id = String(args.setupId ?? S.show.activeSetupId)
  const s = S.setups.get(id)
  if (!s) throw Object.assign(new Error('No setup.'), { code: 'not_found' })
  const pattern = String(args.pattern ?? args.kind ?? 'off')
  const secs = Math.max(1, Math.min(600, Number(args.seconds) || 60))
  const until = pattern === 'off' ? null : nowNs() + secs * 1e9
  commit(`setup:${id}`, [{ op: 'replace', path: '/testPattern', value: pattern }, { op: pattern === 'off' || 'testPatternUntil' in s.doc ? 'replace' : 'add', path: '/testPatternUntil', value: until }], 'server')
  clearTimeout(patternTimers.get(id))
  if (until) patternTimers.set(id, setTimeout(() => {
    const cur = S.setups.get(id)
    if (cur && cur.doc.testPattern !== 'off' && cur.doc.testPatternUntil === until) commit(`setup:${id}`, [{ op: 'replace', path: '/testPattern', value: 'off' }, { op: 'replace', path: '/testPatternUntil', value: null }], 'server')
  }, secs * 1000))
}

function onMessage(c, env) {
  S.log.push({ ...env, from: c.device?.id ?? null, role: c.role ?? null, at: Date.now() })
  if (S.log.length > 2000) S.log.splice(0, 500)
  const by = c.device?.id ?? 'anon'
  switch (env.t) {
    case 'hello': {
      const d = env.d ?? {}
      const dev = { id: rid('dev'), name: d.name ?? 'device', role: d.role ?? 'remote', lastSeen: new Date().toISOString(), online: true, telemetry: null }
      c.device = dev
      c.role = dev.role
      c.caps = d.caps ?? []
      S.devices.set(dev.id, dev)
      send(c, { t: 'welcome', d: { device: dev, serverTime: nowNs(), show: S.show, catalogVersion: catalogDoc.version } })
      pushSnapshot('devices')
      return
    }
    case 'ping':
      send(c, { t: 'pong', d: { t0: env.d?.t0, ts: nowNs() } })
      return
    case 'sub': {
      c.subs.add(env.ch)
      const doc = channelDoc(env.ch)
      if (doc) send(c, { t: 'snapshot', ch: env.ch, v: doc.v, d: doc.d })
      if (env.ch === 'camera' && S.camera) send(c, { t: 'camera.frame', ch: 'camera', d: S.camera })
      return
    }
    case 'unsub':
      c.subs.delete(env.ch)
      return
    case 'param': {
      const { path, value } = env.d ?? {}
      const ch = env.ch
      broadcast(ch, { t: 'param', d: { path, value, by } }, c)
      const key = `${ch}|${path}`
      clearTimeout(paramTimers.get(key))
      paramTimers.set(key, setTimeout(() => {
        paramTimers.delete(key)
        try {
          if (ch.startsWith('draft:')) commitDraft(ch.slice(6), [{ op: 'replace', path, value }], by)
          else commit(ch, [{ op: 'replace', path, value }], by)
        } catch (e) {
          send(c, { t: 'error', d: { code: 'invalid', message: String(e.message) } })
        }
      }, 200))
      return
    }
    case 'patch': {
      const ch = env.ch
      const ops = Array.isArray(env.d) ? env.d : env.d?.ops ?? []
      try {
        if (ch.startsWith('draft:')) {
          commitDraft(ch.slice(6), ops, by, env.id, () => send(c, { t: 'ack', re: env.id }))
          return
        }
        const [kind, id] = ch.split(':')
        const store = kind === 'scene' ? S.scenes.get(id) : S.setups.get(id)
        if (!store) throw Object.assign(new Error(`no document for ${ch}`), { code: 'not_found' })
        if (env.base !== store.version && !leafOnly(ops, store.doc)) {
          send(c, { t: 'reject', re: env.id, v: store.version, d: { code: 'stale', message: `Scene changed; rebase on version ${store.version}.` } })
          return
        }
        commit(ch, ops, by, env.id)
      } catch (e) {
        send(c, { t: 'error', re: env.id, d: { code: e.code ?? 'invalid', message: String(e.message) } })
      }
      return
    }
    case 'cmd': {
      const { name, args } = env.d ?? {}
      try {
        if (name === 'setup.testPattern') setTestPattern(args ?? {})
        else if (name === 'scene.mode') {
          const sid = args?.sceneId ?? S.show.activeSceneId
          if (!S.scenes.get(sid)) throw Object.assign(new Error('No active scene.'), { code: 'no_scene' })
          if (!['static', 'live', 'color', 'scenery', 'objects'].includes(args?.mode)) throw Object.assign(new Error(`mode ${args?.mode} is not one of static, live, color, scenery, objects`), { code: 'invalid' })
          commit(`scene:${sid}`, [{ op: 'replace', path: '/mode', value: args.mode }], by)
        }
        else if (name === 'sound.play') return send(c, { t: 'ack', re: env.id, d: soundPlay(args ?? {}) })
        else if (name === 'sound.stop') return send(c, { t: 'ack', re: env.id, d: soundStop(args ?? {}) })
        else if (name?.startsWith('show.')) showAction(name.slice(5), args ?? {})
        else throw Object.assign(new Error(`Unknown command ${name}.`), { code: 'unknown_command' })
        send(c, { t: 'ack', re: env.id })
      } catch (e) {
        send(c, { t: 'error', re: env.id, d: { code: e.code ?? 'error', message: e.message } })
      }
      return
    }
    case 'telemetry':
      if (c.device) {
        c.device.telemetry = env.d
        c.device.lastSeen = new Date().toISOString()
        pushSnapshot('devices')
      }
      return
    case 'rpc.result':
    case 'rpc.error': {
      const p = pendingRpc.get(env.re)
      if (p) {
        pendingRpc.delete(env.re)
        p({ ok: env.t === 'rpc.result', d: env.d })
      }
      return
    }
    case 'camera.frame':
      S.camera = env.d
      broadcast('camera', { t: 'camera.frame', d: env.d }, c)
      return
    case 'camera.status':
      broadcast('camera', { t: 'camera.status', d: env.d }, c)
      return
  }
}

function rpcTo(role, method, args, timeoutMs = 10000) {
  const target = [...clients].find((c) => c.role === role || (role === 'render' && c.caps?.includes('render')))
  if (!target) return Promise.resolve({ ok: false, d: { code: 'no_client', message: `No ${role} connected.` } })
  const id = rid('r')
  return new Promise((res) => {
    const timer = setTimeout(() => {
      pendingRpc.delete(id)
      res({ ok: false, d: { code: 'timeout', message: 'No answer.' } })
    }, timeoutMs)
    pendingRpc.set(id, (r) => {
      clearTimeout(timer)
      res(r)
    })
    send(target, { t: 'rpc', id, d: { method, args } })
  })
}

// ── agents and calibration (scripted) ────────────────────────────────────────
function startAgent({ agent = 'codex', prompt = '', sceneId }) {
  const sc = S.scenes.get(sceneId) ?? S.scenes.get(S.show.activeSceneId)
  const draft = { id: rid('drf'), sceneId: sc.doc.id, author: `agent:${agent}#${seq}`, baseVersion: sc.version, ops: [], status: 'open', summary: '' }
  S.drafts.set(draft.id, draft)
  const session = { id: rid('agt'), agent, prompt, status: 'running', sceneId: sc.doc.id, draftId: draft.id, createdAt: new Date().toISOString() }
  S.sessions.set(session.id, session)
  S.events.set(session.id, [])
  const script = [
    { kind: 'tool', tool: 'scene_get', text: 'scene_get', durationMs: 120 },
    { kind: 'tool', tool: 'reference_photo_get', text: 'reference_photo_get', durationMs: 400 },
    { kind: 'tool', tool: 'surface_get', text: 'surface_get · top, left, right', durationMs: 90 },
    { kind: 'tool', tool: 'surface_nudge', text: 'surface_nudge · right face 1 px', durationMs: 200, ops: [{ op: 'replace', path: '/points/1/x', value: (sc.doc.points[1]?.x ?? 0) + 1 }] },
    { kind: 'tool', tool: 'output_render', text: 'output_render · t 4.0', durationMs: 900 },
    { kind: 'message', text: `done: nudged the right corner by 1 px. ${prompt ? 'asked: ' + prompt.slice(0, 60) : ''}` },
    { kind: 'status', text: 'proposal ready' },
  ]
  let i = 0
  const tick = () => {
    const s = S.sessions.get(session.id)
    if (!s || s.status !== 'running') return
    if (i >= script.length) {
      s.status = 'done'
      draft.status = 'proposed'
      draft.summary = 'nudged the right face corner by 1 px'
      pushSnapshot(`draft:${draft.id}`)
      broadcast(`agent:${session.id}`, { t: 'session', d: s })
      return
    }
    const step = script[i++]
    const ev = { seq: i, kind: step.kind, tool: step.tool ?? null, text: step.text, durationMs: step.durationMs ?? null, ok: true, ts: new Date().toISOString() }
    S.events.get(session.id).push(ev)
    if (step.ops) {
      draft.ops.push(...step.ops)
      pushSnapshot(`draft:${draft.id}`)
    }
    broadcast(`agent:${session.id}`, { t: 'event', v: ev.seq, d: ev })
    setTimeout(tick, 500)
  }
  setTimeout(tick, 300)
  return session
}

function startCalibration(setupId) {
  const id = rid('cal')
  const steps = ['stand', 'patterns', 'matching', 'surfaces']
  const cal = { id, setupId, status: 'running', progress: { step: 'stand', done: 0, total: 22, message: 'locking exposure' }, quality: null }
  S.calibs.set(id, cal)
  let n = 0
  const tick = async () => {
    n++
    const total = 22
    if (n <= total) {
      const bit = (n - 1) >> 1
      cal.progress = { step: n < 3 ? 'stand' : n < 19 ? 'patterns' : 'matching', done: n, total, message: `pattern ${n} of ${total}` }
      await rpcTo('output', 'output.pattern', { kind: 'gray', axis: n % 4 < 2 ? 'x' : 'y', bit: bit % 11, inverse: n % 2 === 0 }, 3000)
      pushSnapshot(`calib:${id}`)
      setTimeout(tick, 120)
    } else {
      await rpcTo('output', 'output.pattern', { kind: 'off' }, 3000)
      cal.status = 'done'
      cal.quality = { coverage: 0.94, errorPx: 0.6 }
      cal.progress = { step: 'surfaces', done: total, total, message: 'calibrated · 0.6 px · 3 surfaces found' }
      const set = S.setups.get(setupId)
      if (set) commit(`setup:${setupId}`, [{ op: 'replace', path: '/calibrationId', value: id }], 'server')
      pushSnapshot(`calib:${id}`)
    }
    void steps
  }
  setTimeout(tick, 200)
  return { id }
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json' }

const MOCK_DISPLAYS = [
  { index: 1, name: 'Built-in Retina Display', width: 3024, height: 1964, scale: 2, x: 0, y: 0, main: true },
  { index: 2, name: 'EPSON PJ', width: 1920, height: 1080, scale: 1, x: 1512, y: 0, main: false },
]

function readBody(req) {
  return new Promise((res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => res(Buffer.concat(chunks)))
  })
}
function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(body === undefined ? '' : JSON.stringify(body))
}
const err = (res, status, code, message) => json(res, status, { code, message })

function parseMultipart(buf, ctype) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(ctype ?? '')
  if (!m) return {}
  const boundary = Buffer.from('--' + (m[1] ?? m[2]))
  const out = {}
  let pos = buf.indexOf(boundary)
  while (pos >= 0) {
    const next = buf.indexOf(boundary, pos + boundary.length)
    if (next < 0) break
    const part = buf.subarray(pos + boundary.length + 2, next - 2)
    const sep = part.indexOf('\r\n\r\n')
    const head = part.subarray(0, sep).toString()
    const body = part.subarray(sep + 4)
    const name = /name="([^"]+)"/.exec(head)?.[1]
    const ct = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]
    const filename = /filename="([^"]*)"/.exec(head)?.[1]
    if (name) out[name] = ct || filename != null ? { data: body, type: ct ?? 'application/octet-stream', filename } : body.toString()
    pos = next
  }
  return out
}

function jpegSize(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) {
    if (b.subarray(1, 4).toString() === 'PNG') return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
    return { width: 0, height: 0 }
  }
  let i = 2
  while (i < b.length) {
    if (b[i] !== 0xff) return { width: 0, height: 0 }
    const marker = b[i + 1]
    const len = b.readUInt16BE(i + 2)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) }
    i += 2 + len
  }
  return { width: 0, height: 0 }
}

const stem = (f) => String(f ?? '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
const SOUND_EXT = /\.(wav|wave|mp3|m4a|aac|aif|aiff|ogg|oga|opus)$/i
function addSound(res, parts) {
  const f = parts.file
  if (!/^audio\//.test(f.type) && !SOUND_EXT.test(f.filename ?? '')) return err(res, 400, 'unsupported', 'Send a WAV, MP3, M4A, AIFF or OGG file.')
  const a = storeAsset(f.data, f.type.startsWith('audio/') ? f.type : 'audio/wav', 'sound')
  let peaks = []
  try {
    const p = JSON.parse(typeof parts.peaks === 'string' ? parts.peaks : '[]')
    if (Array.isArray(p)) peaks = p.map(Number).filter((x) => Number.isFinite(x))
  } catch {
    peaks = []
  }
  a.width = 0
  a.height = 0
  a.name = typeof parts.name === 'string' && parts.name.trim() ? parts.name.trim() : stem(f.filename) || 'sound'
  a.duration = Number(parts.duration) || 0
  a.peaks = peaks
  S.sounds = [a, ...S.sounds.filter((x) => x.sha !== a.sha)]
  pushSnapshot('sounds')
  return json(res, 201, a)
}

function youtubeIdOf(url) {
  let u
  try {
    u = new URL(url.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const ok = (id) => (id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null)
  const host = u.hostname.toLowerCase()
  if (host === 'youtu.be') return ok(u.pathname.split('/')[1])
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
    if (u.pathname === '/watch') return ok(u.searchParams.get('v'))
    const sh = /^\/shorts\/([^/]+)/.exec(u.pathname)
    if (sh) return ok(sh[1])
  }
  return null
}

const EMBED_MESSAGE = 'yt-dlp is not installed, so this loop plays as an embedded YouTube player. Install it with brew install yt-dlp for offline, sharper loops you can fully blur.'
function startImport({ url, youtubeId, maxHeight, start, end, name }) {
  const id = rid('imp')
  const createdAt = new Date().toISOString()
  const download = S.tools.ytdlp
  const job = { id, url, youtubeId, mode: download ? 'download' : 'embed', status: 'running', progress: 0, message: 'starting', maxHeight, start, end, videoId: null, ref: null, createdAt }
  const entry = { job, n: 0 }
  S.imports.set(id, entry)
  const update = (patch) => {
    Object.assign(job, patch)
    entry.n++
    pushSnapshot(`import:${id}`)
  }
  const finish = (ref, sha) => {
    const v = { id: rid('vid'), name: name ?? `youtube ${youtubeId}`, ref, source: 'youtube', url, youtubeId, sha: sha ?? null, thumb: null, duration: end ? end - start : 0, width: sha ? 1920 : 0, height: sha ? 1080 : 0, createdAt }
    S.videos.unshift(v)
    pushSnapshot('videos')
    return v
  }
  if (!download) {
    const v = finish(`youtube:${youtubeId}`)
    Object.assign(job, { status: 'done', progress: 1, message: EMBED_MESSAGE, videoId: v.id, ref: v.ref })
    entry.n++
    return job
  }
  let step = 0
  const tick = () => {
    step++
    if (step <= 8) {
      const p = Math.round(step * 10) / 100
      update({ progress: p, message: `downloading ${Math.round((p / 0.8) * 100)}%` })
    } else if (step === 9) update({ progress: 0.95, message: 'trimming' })
    else {
      const a = storeAsset(Buffer.from(`mock video ${id}`), 'video/mp4', 'video')
      const v = finish(`asset:${a.sha}`, a.sha)
      update({ status: 'done', progress: 1, message: 'done', videoId: v.id, ref: v.ref })
      return
    }
    setTimeout(tick, 150)
  }
  setTimeout(tick, 150)
  return job
}

function storeAsset(data, mime, kind) {
  const sha = createHash('sha256').update(data).digest('hex')
  const { width, height } = jpegSize(data)
  const asset = { sha, mime, width, height, bytes: data.length, kind }
  S.assets.set(sha, { asset, data })
  return asset
}

async function api(req, res, path, url) {
  const m = req.method
  const body = m === 'GET' || m === 'DELETE' ? null : await readBody(req)
  const j = () => {
    try {
      return body && body.length ? JSON.parse(body.toString()) : {}
    } catch {
      return {}
    }
  }
  let r
  if (path === '/info') return json(res, 200, { name: 'projmap (mock)', version: '0.0.0-mock', port: PORT, hostname: 'localhost', pairingRequired: false })
  if (path === '/pair/code') return json(res, 200, { code: S.pairCode, expiresAt: new Date(Date.now() + 600000).toISOString() })
  if (path === '/pair' && m === 'POST') {
    const b = j()
    if (b.code !== S.pairCode) return err(res, 400, 'bad_code', 'That code is wrong or expired.')
    const dev = { id: rid('dev'), name: b.name ?? 'phone', role: b.role ?? 'remote', lastSeen: new Date().toISOString(), online: false }
    S.devices.set(dev.id, dev)
    return json(res, 200, { token: rid('tok'), device: dev })
  }
  if (path === '/catalog') return json(res, 200, catalogDoc)
  if (path === '/setups' && m === 'GET') return json(res, 200, [...S.setups.values()].map((s) => s.doc))
  if (path === '/setups' && m === 'POST') {
    const b = j()
    const doc = { ...clone(fixture('setup.json')), ...b, id: rid('set') }
    S.setups.set(doc.id, { doc, version: 1 })
    return json(res, 201, doc)
  }
  if ((r = /^\/setups\/([^/]+)$/.exec(path))) {
    const s = S.setups.get(r[1])
    if (!s) return err(res, 404, 'not_found', `Setup ${r[1]} does not exist.`)
    if (m === 'GET') return json(res, 200, s.doc)
    if (m === 'DELETE') {
      S.setups.delete(r[1])
      return json(res, 204)
    }
    if (m === 'PATCH') {
      const b = j()
      const ops = []
      for (const [k, v] of Object.entries(b)) {
        if (k === 'output' && v && typeof v === 'object') for (const [k2, v2] of Object.entries(v)) ops.push({ op: 'replace', path: `/output/${k2}`, value: v2 })
        else if (k !== 'id' && k !== 'testPattern' && k !== 'testPatternUntil') ops.push({ op: k in s.doc ? 'replace' : 'add', path: `/${k}`, value: v })
      }
      if (ops.length) commit(`setup:${r[1]}`, ops, 'rest')
      if (typeof b.testPattern === 'string') setTestPattern({ setupId: r[1], pattern: b.testPattern })
      return json(res, 200, s.doc)
    }
  }
  if (path === '/scenes' && m === 'GET') return json(res, 200, sceneList())
  if (path === '/scenes' && m === 'POST') {
    const b = j()
    const id = rid('scn')
    const name = String(b.name ?? 'untitled').trim()
    if (!name || name.length > 80) return err(res, 400, 'bad_request', 'Name the scene (1 to 80 characters).')
    let doc
    if (b.duplicate) {
      const src = S.scenes.get(String(b.duplicate))
      if (!src) return err(res, 404, 'not_found', `Scene ${b.duplicate} does not exist.`)
      doc = { ...clone(src.doc), id, name, version: 1 }
    } else {
      const template = b.template ?? (b.kind ? TEMPLATE_OF_KIND[b.kind] : null)
      if (b.kind && !TEMPLATE_OF_KIND[b.kind]) return err(res, 400, 'bad_request', `kind ${b.kind} is not one of static, live, color, scenery, mapping.`)
      doc = sceneFromTemplate(id, name, b.setupId ?? S.show.activeSetupId, template)
    }
    S.scenes.set(id, { doc, version: 1, undo: [], redo: [] })
    S.history.set(id, [])
    pushSnapshot('scenes')
    return json(res, 201, doc)
  }
  if (path === '/scenes/from-photo' && m === 'POST') {
    const b = j()
    const id = rid('scn')
    const base = clone(fixture('scene.json'))
    const doc = { ...base, id, name: b.name || 'from photo', version: 1, objects: [], points: [], timeline: { duration: 20, tracks: [], clips: [], cues: [] } }
    S.scenes.set(id, { doc, version: 1, undo: [], redo: [] })
    S.history.set(id, [])
    const set = S.setups.get(doc.setupId)
    if (set && b.asset) commit(`setup:${doc.setupId}`, [{ op: 'replace', path: '/referenceAsset', value: b.asset }], 'rest')
    return json(res, 201, doc)
  }
  if ((r = /^\/scenes\/([^/]+)(?:\/(patch|undo|redo|history))?$/.exec(path))) {
    const s = S.scenes.get(r[1])
    if (!s) return err(res, 404, 'not_found', `Scene ${r[1]} does not exist.`)
    const act = r[2]
    if (!act && m === 'GET') return json(res, 200, s.doc)
    if (!act && m === 'DELETE') {
      if (S.show.activeSceneId === r[1]) return err(res, 409, 'scene_active', 'Activate another scene first.')
      S.scenes.delete(r[1])
      pushSnapshot('scenes')
      return json(res, 204)
    }
    if (!act && m === 'PATCH') {
      const name = String(j().name ?? '').trim()
      if (!name || name.length > 80) return err(res, 400, 'bad_request', 'Name the scene (1 to 80 characters).')
      commit(`scene:${r[1]}`, [{ op: 'replace', path: '/name', value: name }], 'rest')
      return json(res, 200, sceneList().find((x) => x.id === r[1]))
    }
    if (act === 'history') return json(res, 200, (S.history.get(r[1]) ?? []).slice(-Number(url.searchParams.get('limit') ?? 50)).reverse())
    if (act === 'patch') {
      const b = j()
      if (b.base !== s.version && !leafOnly(b.ops ?? [], s.doc)) return json(res, 409, { code: 'stale', version: s.version })
      try {
        return json(res, 200, { version: commit(`scene:${r[1]}`, b.ops ?? [], 'rest') })
      } catch (e) {
        return err(res, 400, 'invalid', String(e.message))
      }
    }
    if (act === 'undo' || act === 'redo') {
      const from = act === 'undo' ? s.undo : s.redo
      const to = act === 'undo' ? s.redo : s.undo
      if (!from.length) return err(res, 409, 'nothing', `Nothing to ${act}.`)
      to.push(s.doc)
      s.doc = from.pop()
      s.version++
      s.doc.version = s.version
      pushSnapshot(`scene:${r[1]}`)
      return json(res, 200, { version: s.version })
    }
  }
  if (path === '/presets' && m === 'GET') return json(res, 200, S.presets)
  if (path === '/presets' && m === 'POST') {
    const b = j()
    const sc = S.scenes.get(b.sceneId)
    const mode = b.mode ?? (sc && sc.doc.mode !== 'objects' ? sc.doc.mode : 'static')
    const p = { id: rid('pre'), name: b.name ?? 'preset', mode, backdrop: clone(sc?.doc.backdrop?.[mode] ?? { layers: [] }), thumbAsset: null, createdAt: new Date().toISOString() }
    S.presets.push(p)
    pushSnapshot('presets')
    return json(res, 201, p)
  }
  if ((r = /^\/presets\/([^/]+)(\/apply)?$/.exec(path))) {
    const p = S.presets.find((x) => x.id === r[1])
    if (!p) return err(res, 404, 'not_found', 'No such preset.')
    if (r[2]) {
      const b = j()
      const sid = b.sceneId ?? S.show.activeSceneId
      commit(`scene:${sid}`, [{ op: 'replace', path: `/backdrop/${p.mode}`, value: clone(p.backdrop) }, { op: 'replace', path: '/mode', value: p.mode }], 'rest')
      return json(res, 200, { ok: true })
    }
    if (m === 'DELETE') {
      S.presets = S.presets.filter((x) => x !== p)
      pushSnapshot('presets')
      return json(res, 204)
    }
  }
  if (path === '/effects' && m === 'GET') return json(res, 200, S.effects)
  if (path === '/effects' && m === 'POST') {
    const b = j()
    const e = { id: rid('eff'), name: b.name ?? 'effect', kind: b.kind ?? 'glsl', origin: 'user', params: b.params ?? {}, source: b.source ?? '' }
    S.effects.push(e)
    return json(res, 201, e)
  }
  if ((r = /^\/effects\/([^/]+)$/.exec(path))) {
    const e = S.effects.find((x) => x.id === r[1])
    if (!e) return err(res, 404, 'not_found', 'No such effect.')
    if (m === 'GET') return json(res, 200, e)
    if (m === 'PUT') {
      Object.assign(e, j(), { id: e.id })
      return json(res, 200, e)
    }
    if (m === 'DELETE') {
      S.effects = S.effects.filter((x) => x !== e)
      return json(res, 204)
    }
  }
  if (path === '/show' && m === 'GET') return json(res, 200, S.show)
  if ((r = /^\/show\/([a-z]+)$/.exec(path)) && m === 'POST') {
    try {
      return json(res, 200, showAction(r[1], j()))
    } catch (e) {
      return err(res, e.code === 'not_found' ? 404 : 409, e.code ?? 'error', e.message)
    }
  }
  if (path === '/assets' && m === 'POST') {
    const parts = parseMultipart(body, req.headers['content-type'])
    if (!parts.file?.data) return err(res, 400, 'bad_request', 'Send a file.')
    if (parts.kind === 'sound') return addSound(res, parts)
    return json(res, 201, storeAsset(parts.file.data, parts.file.type, typeof parts.kind === 'string' ? parts.kind : 'photo'))
  }
  // ── §14 sounds ──
  if (path === '/sounds' && m === 'GET') return json(res, 200, S.sounds)
  if (path === '/sounds' && m === 'POST') {
    const parts = parseMultipart(body, req.headers['content-type'])
    if (!parts.file?.data) return err(res, 400, 'bad_request', 'Send a file.')
    return addSound(res, parts)
  }
  if ((path === '/sounds/play' || path === '/sounds/stop') && m === 'POST') {
    try {
      return json(res, 200, path === '/sounds/play' ? soundPlay(j()) : soundStop(j()))
    } catch (e) {
      return err(res, e.code === 'not_found' ? 404 : e.code === 'bad_request' ? 400 : 409, e.code ?? 'error', e.message)
    }
  }
  if ((r = /^\/sounds\/([^/]+)$/.exec(path))) {
    const snd = S.sounds.find((x) => x.sha === r[1])
    if (!snd) return err(res, 404, 'not_found', 'No such sound.')
    if (m === 'GET') return json(res, 200, snd)
    if (m === 'PATCH') {
      const name = String(j().name ?? '').trim()
      if (!name) return err(res, 400, 'bad_request', 'Name the sound.')
      snd.name = name
      pushSnapshot('sounds')
      return json(res, 200, snd)
    }
    if (m === 'DELETE') {
      S.sounds = S.sounds.filter((x) => x !== snd)
      pushSnapshot('sounds')
      return json(res, 204)
    }
  }
  // ── §14 videos ──
  if (path === '/videos' && m === 'GET') return json(res, 200, S.videos)
  if (path === '/videos' && m === 'POST') {
    const parts = parseMultipart(body, req.headers['content-type'])
    const f = parts.file
    if (!f?.data) return err(res, 400, 'bad_request', 'Send a file.')
    if (!/^video\/(mp4|quicktime|webm)$/.test(f.type) && !/\.(mp4|mov|webm)$/i.test(f.filename ?? '')) return err(res, 400, 'unsupported', 'Send an MP4, MOV or WebM file.')
    const a = storeAsset(f.data, f.type.startsWith('video/') ? f.type : 'video/mp4', 'video')
    const name = typeof parts.name === 'string' && parts.name.trim() ? parts.name.trim() : stem(f.filename) || 'video'
    a.name = name
    const v = { id: rid('vid'), name, ref: `asset:${a.sha}`, source: 'file', url: null, youtubeId: null, sha: a.sha, thumb: null, duration: 0, width: 0, height: 0, createdAt: new Date().toISOString() }
    S.videos.unshift(v)
    pushSnapshot('videos')
    return json(res, 201, v)
  }
  if (path === '/videos/tools' && m === 'GET') return json(res, 200, S.tools)
  // (§17) put the output on a display: two fake displays; a launch only records what would open (S.launches)
  if (path === '/outputs/displays' && m === 'GET') return json(res, 200, MOCK_DISPLAYS)
  if (path === '/outputs/launch' && m === 'POST') {
    const b = j()
    const route = b.route ?? 'out'
    if (route !== 'out' && route !== 'view') return err(res, 400, 'bad_request', 'route must be out or view.')
    const d = MOCK_DISPLAYS.find((x) => x.index === b.display)
    if (!d) return err(res, 404, 'not_found', `Display ${b.display} is not connected. This Mac has ${MOCK_DISPLAYS.length}.`)
    const url = `http://127.0.0.1:7400/${route}`
    ;(S.launches ??= []).push({ display: d.index, route })
    return json(res, 202, { launched: true, url, display: d })
  }
  if (path === '/videos/import' && m === 'POST') {
    const b = j()
    const yt = youtubeIdOf(String(b.url ?? ''))
    if (!yt) return err(res, 400, 'invalid_url', 'Paste a YouTube link: youtube.com/watch, youtu.be or a Shorts link.')
    const maxHeight = b.maxHeight == null ? 1080 : Number(b.maxHeight)
    if (![360, 480, 720, 1080, 1440, 2160].includes(maxHeight)) return err(res, 400, 'bad_request', 'maxHeight must be 360, 480, 720, 1080, 1440 or 2160.')
    const start = Math.max(0, Number(b.start ?? 0) || 0)
    const end = Math.max(0, Number(b.end ?? 0) || 0)
    if (end && end <= start) return err(res, 400, 'bad_request', 'The end must be after the start.')
    return json(res, 202, startImport({ url: String(b.url), youtubeId: yt, maxHeight, start, end, name: typeof b.name === 'string' && b.name.trim() ? b.name.trim() : null }))
  }
  if ((r = /^\/videos\/import\/([^/]+)$/.exec(path))) {
    const jb = S.imports.get(r[1])
    return jb ? json(res, 200, jb.job) : err(res, 404, 'not_found', 'No such import.')
  }
  if ((r = /^\/videos\/([^/]+)$/.exec(path))) {
    const v = S.videos.find((x) => x.id === r[1])
    if (!v) return err(res, 404, 'not_found', 'No such video.')
    if (m === 'GET') return json(res, 200, v)
    if (m === 'PATCH') {
      const name = String(j().name ?? '').trim()
      if (!name) return err(res, 400, 'bad_request', 'Name the video.')
      v.name = name
      pushSnapshot('videos')
      return json(res, 200, v)
    }
    if (m === 'DELETE') {
      S.videos = S.videos.filter((x) => x !== v)
      pushSnapshot('videos')
      return json(res, 204)
    }
  }
  if (path === '/devices') return json(res, 200, devicesList())
  if ((r = /^\/devices\/([^/]+)$/.exec(path)) && m === 'DELETE') {
    S.devices.delete(r[1])
    pushSnapshot('devices')
    return json(res, 204)
  }
  if (path === '/drafts' && m === 'GET') return json(res, 200, [...S.drafts.values()])
  if (path === '/drafts' && m === 'POST') {
    const b = j()
    const sc = S.scenes.get(b.sceneId)
    if (!sc) return err(res, 404, 'not_found', 'No such scene.')
    const d = { id: rid('drf'), sceneId: b.sceneId, author: b.author ?? 'user:editor', baseVersion: sc.version, ops: [], status: 'open', summary: '' }
    S.drafts.set(d.id, d)
    return json(res, 201, d)
  }
  if ((r = /^\/drafts\/([^/]+)\/(apply|discard)$/.exec(path)) && m === 'POST') {
    const d = S.drafts.get(r[1])
    if (!d) return err(res, 404, 'not_found', 'No such draft.')
    if (r[2] === 'apply') {
      try {
        if (d.ops.length) commit(`scene:${d.sceneId}`, d.ops, d.author)
      } catch (e) {
        return err(res, 409, 'conflict', String(e.message))
      }
      d.status = 'applied'
    } else d.status = 'discarded'
    pushSnapshot(`draft:${d.id}`)
    return json(res, 200, d)
  }
  if (path === '/agents/sessions' && m === 'GET') return json(res, 200, [...S.sessions.values()].reverse())
  if (path === '/agents/sessions' && m === 'POST') return json(res, 201, startAgent(j()))
  if ((r = /^\/agents\/sessions\/([^/]+)\/(events|cancel)$/.exec(path))) {
    const s = S.sessions.get(r[1])
    if (!s) return err(res, 404, 'not_found', 'No such session.')
    if (r[2] === 'events') return json(res, 200, S.events.get(r[1]) ?? [])
    s.status = 'cancelled'
    broadcast(`agent:${s.id}`, { t: 'session', d: s })
    return json(res, 200, s)
  }
  if (path === '/calibrations' && m === 'POST') return json(res, 201, startCalibration(j().setupId ?? S.show.activeSetupId))
  if ((r = /^\/calibrations\/([^/]+)$/.exec(path))) {
    const c = S.calibs.get(r[1])
    return c ? json(res, 200, { id: c.id, setupId: c.setupId, status: c.status, quality: c.quality }) : err(res, 404, 'not_found', 'No such calibration.')
  }
  if (path === '/settings') {
    if (m === 'PATCH' || m === 'PUT') Object.assign(S.settings, j())
    return json(res, 200, S.settings)
  }
  if (path === '/camera/stills' && m === 'POST') {
    const parts = parseMultipart(body, req.headers['content-type'])
    if (!parts.file?.data) return err(res, 400, 'bad_request', 'Send a file.')
    return json(res, 201, storeAsset(parts.file.data, 'image/jpeg', 'photo'))
  }
  return err(res, 404, 'not_found', `No route ${m} ${path}.`)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const path = url.pathname
  try {
    if (path.startsWith('/api/v1/')) return await api(req, res, path.slice(7), url)
    if (path.startsWith('/a/')) {
      const a = S.assets.get(path.slice(3))
      if (!a) return err(res, 404, 'not_found', 'No such asset.')
      res.writeHead(200, { 'content-type': a.asset.mime, 'cache-control': 'public, max-age=31536000, immutable' })
      return res.end(a.data)
    }
    // (§15) thumbnails rendered at build time
    if (path.startsWith('/catalog/thumbs/')) {
      const f = resolve(catalogAssets, 'thumbs', basename(decodeURIComponent(path.slice('/catalog/thumbs/'.length))))
      if (!f.startsWith(catalogAssets) || !existsSync(f)) return err(res, 404, 'not_found', 'No such thumbnail.')
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' })
      return res.end(readFileSync(f))
    }
    if (path.startsWith('/catalog/assets/')) {
      const f = resolve(catalogAssets, '.' + decodeURIComponent(path.slice('/catalog/assets'.length)))
      if (!f.startsWith(catalogAssets) || !existsSync(f)) return err(res, 404, 'not_found', 'No such catalog file.')
      res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream', 'cache-control': 'public, max-age=3600' })
      return res.end(readFileSync(f))
    }
    if (path === '/__mock/log') {
      const t = url.searchParams.get('t')
      return json(res, 200, t ? S.log.filter((e) => e.t === t) : S.log)
    }
    if (path === '/__mock/state') return json(res, 200, { show: S.show, scenes: [...S.scenes.values()].map((s) => ({ id: s.doc.id, version: s.version })), clients: [...clients].map((c) => ({ role: c.role, caps: c.caps ?? [], subs: [...c.subs] })), launches: S.launches ?? [] })
    if (path === '/__mock/tools' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)).toString() || '{}')
      S.tools = { ytdlp: !!b.ytdlp, ffmpeg: b.ffmpeg == null ? !!b.ytdlp : !!b.ffmpeg }
      return json(res, 200, S.tools)
    }
    if (path === '/__mock/send' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)).toString() || '{}')
      const to = [...clients].filter((c) => (!b.role || c.role === b.role) && (!b.cap || c.caps?.includes(b.cap)))
      to.forEach((c) => send(c, { t: b.t, d: b.d }))
      return json(res, 200, { sent: to.length })
    }
    if (path === '/__mock/reset' && req.method === 'POST') {
      reset()
      return json(res, 200, { ok: true })
    }
    if (path === '/__mock/attach' && req.method === 'POST') {
      // an MCP client that connected on its own (Claude Code, Codex): the server attaches a session on its first write
      const b = JSON.parse((await readBody(req)).toString() || '{}')
      return json(res, 200, startAgent({ agent: b.agent ?? 'claude', prompt: '(connected over MCP)', sceneId: b.sceneId }))
    }
    if (path === '/__mock/rpc' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)).toString() || '{}')
      return json(res, 200, await rpcTo(b.role ?? 'output', b.method, b.args ?? {}, b.timeoutMs ?? 10000))
    }
    err(res, 404, 'not_found', `No route ${path}.`)
  } catch (e) {
    err(res, 500, 'internal', String(e?.message ?? e))
  }
})

const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (req, sock, head) => {
  if (!req.url?.startsWith('/ws')) return sock.destroy()
  wss.handleUpgrade(req, sock, head, (ws) => {
    const c = { ws, subs: new Set(), device: null, role: null }
    clients.add(c)
    ws.on('message', (raw) => {
      let env
      try {
        env = JSON.parse(raw.toString())
      } catch {
        return
      }
      onMessage(c, env)
    })
    ws.on('close', () => {
      clients.delete(c)
      if (c.device) {
        c.device.online = false
        pushSnapshot('devices')
      }
    })
  })
})

if (process.env.MOCK_CAMERA) {
  const photos = join(root, 'design/photos')
  const files = existsSync(photos) ? readdirSync(photos).filter((f) => f.endsWith('.jpg')) : []
  let n = 0
  setInterval(() => {
    if (!files.length) return
    const jpeg = readFileSync(join(photos, files[Math.floor(n / 40) % files.length])).toString('base64')
    S.camera = { seq: ++n, width: 960, height: 720, jpeg }
    broadcast('camera', { t: 'camera.frame', d: S.camera })
    if (n % 8 === 0) broadcast('camera', { t: 'camera.status', d: { streaming: true, fps: 8, width: 960, height: 720, steady: true, level: 0.4 } })
  }, 125)
}

server.listen(PORT, '127.0.0.1', () => console.log(`projmap mock server on http://localhost:${PORT}`))
