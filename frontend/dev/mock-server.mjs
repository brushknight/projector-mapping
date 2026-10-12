#!/usr/bin/env node
/**
 * A small stand-in for the Go backend, built from contract/fixtures and docs/protocol.md, for frontend dev and e2e.
 * Not the product: no persistence, no auth, no validation beyond the basics.
 *
 *   node dev/mock-server.mjs            → http://localhost:7400
 *   PORT=7499 node dev/mock-server.mjs  → another port (the e2e run uses 7499)
 *   MOCK_CAMERA=1                       → sends a fake phone camera feed on the `camera` channel
 *
 * Test hooks (not part of the protocol): GET /__mock/log?t=param, POST /__mock/rpc {method,args,role?},
 * POST /__mock/reset, GET /__mock/state.
 */
import { createHash } from 'node:crypto'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve } from 'node:path'
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
let S
function reset() {
  const scene = fixture('scene.json')
  const setup = fixture('setup.json')
  S = {
    setups: new Map([[setup.id, { doc: setup, version: 1 }]]),
    scenes: new Map([[scene.id, { doc: scene, version: scene.version, undo: [], redo: [] }]]),
    history: new Map([[scene.id, []]]),
    show: { activeSetupId: setup.id, activeSceneId: scene.id, onAir: true, transport: { state: 'stopped', startedAt: 0, offset: 0, cue: 0 }, version: 1 },
    presets: [fixture('preset.json')],
    effects: [fixture('effect-glsl.json')],
    devices: new Map(),
    drafts: new Map(),
    sessions: new Map(),
    events: new Map(),
    calibs: new Map(),
    assets: new Map(),
    settings: { agentMayPreview: false, agentMayGoLive: false },
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
  const [kind, id] = ch.split(':')
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
      break
    case 'seek': {
      const at = Number(args.t ?? 0)
      Object.assign(t, { offset: at, startedAt: nowNs() })
      break
    }
    case 'go': {
      if (!scene) throw Object.assign(new Error('No active scene.'), { code: 'no_scene' })
      const ph = playheadOf(t)
      const next = cues.findIndex((c) => c.at > ph + 1e-3)
      const idx = next < 0 ? 0 : next
      Object.assign(t, { state: 'playing', offset: cues[idx]?.at ?? 0, startedAt: nowNs(), cue: idx })
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
      Object.assign(t, { state: 'stopped', offset: 0, startedAt: 0, cue: 0 })
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
    if (name) out[name] = ct || /filename=/.test(head) ? { data: body, type: ct ?? 'application/octet-stream' } : body.toString()
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
  if (path === '/scenes' && m === 'GET') return json(res, 200, [...S.scenes.values()].map((s) => ({ id: s.doc.id, name: s.doc.name, setupId: s.doc.setupId, version: s.version })))
  if (path === '/scenes' && m === 'POST') {
    const b = j()
    const id = rid('scn')
    const doc = { id, setupId: b.setupId ?? S.show.activeSetupId, name: b.name ?? 'untitled', version: 1, mode: 'static', backdrop: { static: { layers: [] }, live: { layers: [] }, color: { layers: [] }, scenery: { layers: [] } }, underlay: { on: false, from: 'static', level: 0.35 }, points: [], objects: [], timeline: { duration: 20, tracks: [], clips: [], cues: [] } }
    S.scenes.set(id, { doc, version: 1, undo: [], redo: [] })
    S.history.set(id, [])
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
      S.scenes.delete(r[1])
      return json(res, 204)
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
      commit(`scene:${sid}`, [{ op: 'replace', path: `/backdrop/${p.mode}`, value: { layers: p.backdrop.layers } }, { op: 'replace', path: '/mode', value: p.mode }], 'rest')
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
    return json(res, 201, storeAsset(parts.file.data, parts.file.type, typeof parts.kind === 'string' ? parts.kind : 'photo'))
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
    if (path === '/__mock/state') return json(res, 200, { show: S.show, scenes: [...S.scenes.values()].map((s) => ({ id: s.doc.id, version: s.version })), clients: [...clients].map((c) => ({ role: c.role, subs: [...c.subs] })) })
    if (path === '/__mock/reset' && req.method === 'POST') {
      reset()
      return json(res, 200, { ok: true })
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
