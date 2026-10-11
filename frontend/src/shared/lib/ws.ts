/**
 * The realtime hub client (protocol §3): hello/welcome, reconnect with backoff, clock sync (8 pings, median, every
 * 30 s), channel subscriptions applied into a local store (snapshot / patched / param), optimistic patches that
 * rebase on `reject stale`, commands with ack/error promises, server→client RPC handlers and telemetry.
 *
 * Framework-free so the output, the preview, the editor and the tests share it; React bindings live in useHub.ts.
 */
import { applyPatch, setAt, type JsonOp } from './jsonPatch'

export interface Envelope {
  t: string
  ch?: string
  id?: string
  re?: string
  v?: number
  base?: number
  d?: unknown
}

/** The bits of WebSocket the hub uses, so tests can pass a fake. */
export interface SocketLike {
  readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((ev: unknown) => void) | null
  onclose: ((ev: unknown) => void) | null
  onerror: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
}

export type HubStatus = 'idle' | 'connecting' | 'open' | 'closed'

export interface HubOptions {
  /** ws URL; defaults to ws(s)://<page host>/ws */
  url?: string
  role: 'output' | 'editor' | 'remote' | 'agent'
  name: string
  caps?: string[]
  token?: string | null
  build?: string
  socketFactory?: (url: string) => SocketLike
  now?: () => number
  /** ms; the first retry delay, doubled per failure up to maxBackoffMs */
  backoffMs?: number
  maxBackoffMs?: number
  cmdTimeoutMs?: number
  clockResyncMs?: number
}

export interface Welcome {
  device: { id: string; name: string; role: string; lastSeen?: string; online?: boolean }
  serverTime: number
  show: unknown
  catalogVersion: number
}

export interface ChannelSnapshot<T> {
  /** the local view: server-confirmed document plus this client's pending patches */
  doc: T | null
  /** last server-confirmed version */
  version: number
  /** true while this client has unconfirmed patches on the channel */
  pending: boolean
}

export class HubError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

interface Pending {
  id: string
  ops: JsonOp[]
  /** recomputes the ops on a newer document when the server rejects them as stale */
  intent?: (doc: unknown) => JsonOp[] | null
  retries: number
  waitingFor: number | null
  resolve: (v: number) => void
  reject: (e: Error) => void
}

interface Channel {
  name: string
  confirmed: unknown
  version: number
  hasDoc: boolean
  view: unknown
  pending: Pending[]
  listeners: Set<(s: ChannelSnapshot<unknown>) => void>
  messageListeners: Set<(env: Envelope) => void>
  subscribed: boolean
}

type RpcHandler = (args: Record<string, unknown>, env: Envelope) => unknown | Promise<unknown>

type HubEvents = {
  status: HubStatus
  welcome: Welcome
  clock: number
  message: Envelope
  error: { code: string; message: string }
}

const OPEN = 1
const PINGS = 8

export class Hub {
  readonly opts: Required<Omit<HubOptions, 'url' | 'token' | 'socketFactory'>> & Pick<HubOptions, 'url' | 'token' | 'socketFactory'>
  status: HubStatus = 'idle'
  device: Welcome['device'] | null = null
  welcome: Welcome | null = null
  /** server clock − local clock, ms (median of the last ping burst) */
  clockOffset = 0
  clockSynced = false

  private sock: SocketLike | null = null
  private channels = new Map<string, Channel>()
  private cmds = new Map<string, { resolve: (d: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private rpc = new Map<string, RpcHandler>()
  private listeners = new Map<keyof HubEvents, Set<(v: never) => void>>()
  private seq = 0
  private attempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private clockTimer: ReturnType<typeof setInterval> | null = null
  private samples: number[] = []
  private pingsLeft = 0
  private stopped = true

  constructor(opts: HubOptions) {
    this.opts = {
      caps: [],
      build: '0.1.0',
      now: () => Date.now(),
      backoffMs: 500,
      maxBackoffMs: 10_000,
      cmdTimeoutMs: 10_000,
      clockResyncMs: 30_000,
      ...opts,
    }
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  connect() {
    this.stopped = false
    this.open()
  }

  close() {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.clockTimer) clearInterval(this.clockTimer)
    this.reconnectTimer = null
    this.clockTimer = null
    const s = this.sock
    this.sock = null
    if (s) {
      s.onclose = null
      s.onmessage = null
      s.close()
    }
    this.setStatus('closed')
  }

  /** The server clock in ms (local clock + measured offset). */
  serverNow(): number {
    return this.opts.now() + this.clockOffset
  }

  private url(): string {
    if (this.opts.url) return this.opts.url
    const loc = globalThis.location
    const proto = loc?.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${loc?.host ?? 'localhost:7400'}/ws`
  }

  private open() {
    if (this.stopped) return
    this.setStatus('connecting')
    const make = this.opts.socketFactory ?? ((u: string) => new WebSocket(u) as unknown as SocketLike)
    let s: SocketLike
    try {
      s = make(this.url())
    } catch {
      this.scheduleReconnect()
      return
    }
    this.sock = s
    s.onopen = () => {
      this.sendRaw({
        t: 'hello',
        d: { token: this.opts.token ?? undefined, role: this.opts.role, name: this.opts.name, caps: this.opts.caps, build: this.opts.build },
      })
    }
    s.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return
      let env: Envelope
      try {
        env = JSON.parse(ev.data)
      } catch {
        return
      }
      this.handle(env)
    }
    s.onclose = () => {
      if (this.sock !== s) return
      this.sock = null
      if (this.clockTimer) clearInterval(this.clockTimer)
      this.clockTimer = null
      for (const c of this.channels.values()) c.subscribed = false
      // commands in flight never get an answer from a dead socket
      for (const [id, c] of this.cmds) {
        clearTimeout(c.timer)
        c.reject(new HubError('disconnected', 'Lost the connection to the server.'))
        this.cmds.delete(id)
      }
      this.setStatus('closed')
      this.scheduleReconnect()
    }
    s.onerror = () => {
      /* onclose follows */
    }
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return
    const delay = Math.min(this.opts.maxBackoffMs, this.opts.backoffMs * 2 ** this.attempts)
    this.attempts++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.open()
    }, delay)
  }

  private setStatus(s: HubStatus) {
    if (this.status === s) return
    this.status = s
    this.emit('status', s)
  }

  // ── events ─────────────────────────────────────────────────────────────────

  on<K extends keyof HubEvents>(ev: K, fn: (v: HubEvents[K]) => void): () => void {
    let set = this.listeners.get(ev)
    if (!set) this.listeners.set(ev, (set = new Set()))
    set.add(fn as (v: never) => void)
    return () => set.delete(fn as (v: never) => void)
  }

  private emit<K extends keyof HubEvents>(ev: K, v: HubEvents[K]) {
    for (const fn of this.listeners.get(ev) ?? []) (fn as (v: HubEvents[K]) => void)(v)
  }

  // ── sending ────────────────────────────────────────────────────────────────

  private nextId(prefix: string) {
    return `${prefix}-${++this.seq}`
  }

  private sendRaw(env: Envelope): boolean {
    const s = this.sock
    if (!s || s.readyState !== OPEN) return false
    s.send(JSON.stringify(env))
    return true
  }

  /** Sends when connected and welcomed; returns false otherwise (live controls never queue). */
  send(env: Envelope): boolean {
    if (this.status !== 'open') return false
    return this.sendRaw(env)
  }

  // ── channels ───────────────────────────────────────────────────────────────

  private channel(name: string): Channel {
    let c = this.channels.get(name)
    if (!c) {
      c = { name, confirmed: null, version: 0, hasDoc: false, view: null, pending: [], listeners: new Set(), messageListeners: new Set(), subscribed: false }
      this.channels.set(name, c)
    }
    return c
  }

  /**
   * Subscribes to a channel. `onChange` gets the local view after every snapshot, patch and param; `onMessage`
   * gets every raw envelope on the channel (camera frames, agent events, calibration progress…).
   */
  subscribe<T = unknown>(name: string, onChange?: (s: ChannelSnapshot<T>) => void, onMessage?: (env: Envelope) => void): () => void {
    const c = this.channel(name)
    const first = c.listeners.size === 0 && c.messageListeners.size === 0
    if (onChange) c.listeners.add(onChange as (s: ChannelSnapshot<unknown>) => void)
    if (onMessage) c.messageListeners.add(onMessage)
    if (first || !c.subscribed) this.sendSub(c)
    if (onChange && c.hasDoc) onChange(this.snapshotOf<T>(c))
    return () => {
      if (onChange) c.listeners.delete(onChange as (s: ChannelSnapshot<unknown>) => void)
      if (onMessage) c.messageListeners.delete(onMessage)
      if (c.listeners.size === 0 && c.messageListeners.size === 0) {
        this.send({ t: 'unsub', ch: name })
        c.subscribed = false
        if (c.pending.length === 0) this.channels.delete(name)
      }
    }
  }

  /** The current local view of a channel. */
  get<T = unknown>(name: string): ChannelSnapshot<T> {
    const c = this.channels.get(name)
    return c ? this.snapshotOf<T>(c) : { doc: null, version: 0, pending: false }
  }

  private snapshotOf<T>(c: Channel): ChannelSnapshot<T> {
    return { doc: c.view as T | null, version: c.version, pending: c.pending.length > 0 }
  }

  private sendSub(c: Channel) {
    if (this.send({ t: 'sub', ch: c.name })) c.subscribed = true
  }

  /** Asks the server for a fresh snapshot (after a version gap or a failed apply). */
  resync(name: string) {
    const c = this.channels.get(name)
    if (c) this.sendSub(c)
  }

  private recompute(c: Channel) {
    let v = c.confirmed
    for (const p of c.pending) {
      if (p.waitingFor !== null) continue
      try {
        v = applyPatch(v, p.ops)
      } catch {
        /* a pending op that no longer applies shows nothing until it rebases */
      }
    }
    c.view = v
    const snap = this.snapshotOf(c)
    for (const fn of c.listeners) fn(snap)
  }

  // ── changing things ────────────────────────────────────────────────────────

  /**
   * A continuous value (drag). Applied locally at once and forwarded by the server to every other subscriber; the
   * server commits it 200 ms after the last param on that path. Dropped while disconnected.
   */
  param(ch: string, path: string, value: unknown): boolean {
    const c = this.channel(ch)
    if (c.hasDoc) {
      try {
        c.confirmed = setAt(c.confirmed, path, value)
      } catch {
        /* the path may not exist locally yet */
      }
      this.recompute(c)
    }
    return this.send({ t: 'param', ch, d: { path, value } })
  }

  /**
   * A structural edit. Applied optimistically; resolves with the committed version. On `reject stale` it rebases:
   * waits for the newer version, recomputes the ops with `intent` (or reuses them) and resends, up to 3 times.
   */
  patch(ch: string, ops: JsonOp[], intent?: (doc: unknown) => JsonOp[] | null): Promise<number> {
    const c = this.channel(ch)
    return new Promise<number>((resolve, reject) => {
      const p: Pending = { id: this.nextId('c'), ops, intent, retries: 0, waitingFor: null, resolve, reject }
      c.pending.push(p)
      this.recompute(c)
      this.sendPending(c, p)
    })
  }

  private sendPending(c: Channel, p: Pending) {
    this.send({ t: 'patch', ch: c.name, id: p.id, base: c.version, d: p.ops })
    // when offline the patch stays pending and is resent after the next snapshot
  }

  private settle(c: Channel, p: Pending, err?: Error, version?: number) {
    c.pending = c.pending.filter((x) => x !== p)
    if (err) p.reject(err)
    else p.resolve(version ?? c.version)
    this.recompute(c)
  }

  private rebase(c: Channel, p: Pending) {
    p.waitingFor = null
    let ops: JsonOp[] | null = p.ops
    if (p.intent) {
      try {
        ops = p.intent(c.confirmed)
      } catch {
        ops = null
      }
    }
    if (!ops || ops.length === 0) {
      this.settle(c, p, new HubError('stale', 'The change no longer applies to the newer scene.'))
      return
    }
    p.ops = ops
    this.recompute(c)
    this.sendPending(c, p)
  }

  /** A show command (`show.go`, `show.blackout`, `setup.testPattern`…). Resolves on ack, rejects on error. */
  cmd(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.nextId('m')
    return new Promise((resolve, reject) => {
      if (!this.send({ t: 'cmd', id, d: { name, args } })) {
        reject(new HubError('not_connected', 'Not connected to the server.'))
        return
      }
      const timer = setTimeout(() => {
        this.cmds.delete(id)
        reject(new HubError('timeout', `${name} got no answer.`))
      }, this.opts.cmdTimeoutMs)
      this.cmds.set(id, { resolve, reject, timer })
    })
  }

  /** Registers the handler for a server→client RPC method. */
  handleRpc(method: string, fn: RpcHandler): () => void {
    this.rpc.set(method, fn)
    return () => {
      if (this.rpc.get(method) === fn) this.rpc.delete(method)
    }
  }

  /** Output telemetry, every 2 s. */
  telemetry(d: { fps: number; dropped: number; width: number; height: number; refresh: number }) {
    this.send({ t: 'telemetry', d })
  }

  // ── clock ──────────────────────────────────────────────────────────────────

  /** Starts a burst of 8 pings; the median offset becomes clockOffset. */
  syncClock() {
    this.samples = []
    this.pingsLeft = PINGS
    this.ping()
  }

  private ping() {
    if (this.pingsLeft <= 0) return
    this.pingsLeft--
    this.send({ t: 'ping', d: { t0: this.opts.now() } })
  }

  private onPong(d: { t0: number; ts: number }) {
    const now = this.opts.now()
    const rtt = now - d.t0
    this.samples.push(d.ts / 1e6 - (d.t0 + rtt / 2))
    if (this.pingsLeft > 0) {
      this.ping()
      return
    }
    this.clockOffset = median(this.samples)
    this.clockSynced = true
    this.emit('clock', this.clockOffset)
  }

  // ── receiving ──────────────────────────────────────────────────────────────

  private handle(env: Envelope) {
    this.emit('message', env)
    const c = env.ch ? this.channels.get(env.ch) : undefined
    switch (env.t) {
      case 'welcome': {
        const w = env.d as Welcome
        this.welcome = w
        this.device = w.device
        this.attempts = 0
        // a first estimate until the ping burst lands
        if (!this.clockSynced && typeof w.serverTime === 'number') this.clockOffset = w.serverTime / 1e6 - this.opts.now()
        this.setStatus('open')
        const show = this.channels.get('show')
        if (show && !show.hasDoc && w.show) {
          show.confirmed = w.show
          show.hasDoc = true
          this.recompute(show)
        }
        for (const ch of this.channels.values()) if (ch.listeners.size || ch.messageListeners.size || ch.pending.length) this.sendSub(ch)
        this.emit('welcome', w)
        this.syncClock()
        if (this.clockTimer) clearInterval(this.clockTimer)
        this.clockTimer = setInterval(() => this.syncClock(), this.opts.clockResyncMs)
        return
      }
      case 'pong':
        this.onPong(env.d as { t0: number; ts: number })
        return
      case 'snapshot':
        if (c) this.onSnapshot(c, env)
        break
      case 'patched':
        if (c) this.onPatched(c, env)
        break
      case 'param':
        if (c && c.hasDoc) {
          const d = env.d as { path: string; value: unknown }
          try {
            c.confirmed = setAt(c.confirmed, d.path, d.value)
            this.recompute(c)
          } catch {
            this.resync(c.name)
          }
        }
        break
      case 'reject':
        this.onReject(env)
        return
      case 'ack':
      case 'error': {
        const pending = env.re ? this.cmds.get(env.re) : undefined
        // a patch on a draft channel is answered with ack (the Draft follows as a snapshot)
        if (!pending && env.t === 'ack' && env.re) {
          const hit = this.findPending(env.re)
          if (hit) {
            this.settle(hit.c, hit.p, undefined, hit.c.version)
            return
          }
        }
        if (pending) {
          clearTimeout(pending.timer)
          this.cmds.delete(env.re!)
          if (env.t === 'ack') pending.resolve(env.d)
          else {
            const e = (env.d ?? {}) as { code?: string; message?: string }
            pending.reject(new HubError(e.code ?? 'error', e.message ?? 'The server refused the command.'))
          }
        } else if (env.t === 'error') {
          // an error for a patch id, or a connection-level error
          const e = (env.d ?? {}) as { code?: string; message?: string }
          if (env.re && this.failPatch(env.re, new HubError(e.code ?? 'error', e.message ?? 'The server refused the change.'))) return
          this.emit('error', { code: e.code ?? 'error', message: e.message ?? '' })
        }
        return
      }
      case 'rpc':
        void this.dispatchRpc(env)
        return
    }
    if (c) for (const fn of c.messageListeners) fn(env)
  }

  private onSnapshot(c: Channel, env: Envelope) {
    c.confirmed = env.d
    c.hasDoc = true
    c.version = env.v ?? c.version
    // pending patches sent before a reconnect (or waiting for this version) go again on the new base
    for (const p of [...c.pending]) {
      if (p.waitingFor !== null && c.version >= p.waitingFor) this.rebase(c, p)
    }
    this.recompute(c)
  }

  private onPatched(c: Channel, env: Envelope) {
    const d = (env.d ?? {}) as { ops?: JsonOp[]; by?: string }
    const v = env.v ?? c.version + 1
    const mine = env.re ? c.pending.find((p) => p.id === env.re) : undefined
    if (c.hasDoc && v > c.version) {
      if (v !== c.version + 1 && c.version !== 0) {
        // a gap: something was missed, take a fresh snapshot
        this.resync(c.name)
      } else {
        try {
          c.confirmed = applyPatch(c.confirmed, d.ops ?? [])
          c.version = v
        } catch {
          this.resync(c.name)
        }
      }
    }
    if (mine) this.settle(c, mine, undefined, v)
    for (const p of [...c.pending]) if (p.waitingFor !== null && c.version >= p.waitingFor) this.rebase(c, p)
    this.recompute(c)
  }

  private findPending(id: string): { c: Channel; p: Pending } | null {
    for (const c of this.channels.values()) {
      const p = c.pending.find((x) => x.id === id)
      if (p) return { c, p }
    }
    return null
  }

  private failPatch(id: string, err: Error): boolean {
    const hit = this.findPending(id)
    if (!hit) return false
    this.settle(hit.c, hit.p, err)
    return true
  }

  private onReject(env: Envelope) {
    if (!env.re) return
    const hit = this.findPending(env.re)
    if (!hit) return
    const { c, p } = hit
    const d = (env.d ?? {}) as { code?: string; message?: string; version?: number; v?: number }
    const code = d.code ?? 'rejected'
    if (code !== 'stale' || p.retries >= 3) {
      this.settle(c, p, new HubError(code, d.message ?? 'The server rejected the change.'))
      return
    }
    p.retries++
    const target = env.v ?? d.v ?? d.version ?? c.version
    if (c.version >= target) {
      this.rebase(c, p)
    } else {
      p.waitingFor = target
      this.recompute(c)
      // the patched messages usually arrive on their own; ask for a snapshot in case they were missed
      this.resync(c.name)
    }
  }

  private async dispatchRpc(env: Envelope) {
    const d = (env.d ?? {}) as { method?: string; args?: Record<string, unknown> }
    const fn = d.method ? this.rpc.get(d.method) : undefined
    if (!fn) {
      this.send({ t: 'rpc.error', re: env.id, d: { code: 'unknown_method', message: `No handler for ${d.method}.` } })
      return
    }
    try {
      const result = await fn(d.args ?? {}, env)
      this.send({ t: 'rpc.result', re: env.id, d: result ?? {} })
    } catch (e) {
      this.send({ t: 'rpc.error', re: env.id, d: { code: e instanceof HubError ? e.code : 'failed', message: e instanceof Error ? e.message : String(e) } })
    }
  }
}

export function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
