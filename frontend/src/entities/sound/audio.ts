/**
 * The Web Audio engine (protocol §14): one AudioContext per page, a buffer cache (fetch /a/{sha}, decode once), and
 * engines that each own a master gain: one-shots from `sound.play` (pads, cue sounds, library sounds), `sound.stop`
 * by playId / padId / all, and timeline sound clips planned by audioSchedule.ts and started sample-accurately with
 * AudioBufferSourceNode.start(when, offset), with the fades as gain ramps.
 *
 * Framework-free; React bindings are in audioHooks.ts. Test hook: `window.__pmAudio` (see PmAudioProbe).
 */
import { assetUrl } from '../asset/types'
import type { ClipPlan } from './audioSchedule'
import type { SoundPlayMsg, SoundStopMsg } from './types'

/** What e2e tests read: every source node that started or stopped on this page. */
export interface PmAudioProbe {
  unlocked: boolean
  started: Array<{ kind: 'oneshot' | 'clip'; playId?: string; padId?: string; cueId?: string; clipId?: string; sound: string; when: number; offset: number; ctxTime: number }>
  stopped: Array<{ playId?: string; padId?: string; clipId?: string }>
}

declare global {
  interface Window {
    __pmAudio?: PmAudioProbe
  }
}

function probe(): PmAudioProbe | null {
  if (typeof window === 'undefined') return null
  if (!window.__pmAudio) window.__pmAudio = { unlocked: false, started: [], stopped: [] }
  return window.__pmAudio
}

// ── the page's context and buffers ───────────────────────────────────────────

let sharedCtx: AudioContext | null = null
const stateListeners = new Set<(running: boolean) => void>()

/** The page's AudioContext (created on first use), or null where Web Audio is missing. */
export function audioContext(): AudioContext | null {
  if (sharedCtx) return sharedCtx
  const Ctor = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined
  if (!Ctor) return null
  try {
    sharedCtx = new Ctor({ latencyHint: 'interactive' })
  } catch {
    return null
  }
  const ctx = sharedCtx
  const p = probe()
  if (p) p.unlocked = ctx.state === 'running'
  ctx.addEventListener('statechange', () => {
    const running = ctx.state === 'running'
    const pr = probe()
    if (pr) pr.unlocked = running
    for (const fn of stateListeners) fn(running)
  })
  return ctx
}

/** True while the page's context runs (the browser allows sound). */
export function audioUnlocked(): boolean {
  return audioContext()?.state === 'running'
}

/** Resumes the context; call it from a click or key press. Resolves true when it runs. */
export async function unlockAudio(): Promise<boolean> {
  const ctx = audioContext()
  if (!ctx) return false
  if (ctx.state !== 'running') {
    try {
      await ctx.resume()
    } catch {
      /* the browser still blocks it */
    }
  }
  return ctx.state === 'running'
}

/** Hears the context start and stop running. */
export function onAudioState(fn: (running: boolean) => void): () => void {
  stateListeners.add(fn)
  return () => stateListeners.delete(fn)
}

/** Resumes the context on the page's next click or key press (once it runs, the listeners go away). */
export function unlockOnGesture(): () => void {
  if (typeof document === 'undefined') return () => {}
  const go = () => {
    void unlockAudio().then((ok) => ok && off())
  }
  const off = () => {
    document.removeEventListener('pointerdown', go, true)
    document.removeEventListener('keydown', go, true)
  }
  document.addEventListener('pointerdown', go, true)
  document.addEventListener('keydown', go, true)
  return off
}

const buffers = new Map<string, Promise<AudioBuffer | null>>()
const decoded = new Map<string, AudioBuffer>()

/** Fetches and decodes a sound once per page; null when it is missing or cannot be decoded. */
export function loadSound(sha: string, url = assetUrl(sha)): Promise<AudioBuffer | null> {
  let p = buffers.get(sha)
  if (p) return p
  p = (async () => {
    const ctx = audioContext()
    if (!ctx) return null
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = await ctx.decodeAudioData(await res.arrayBuffer())
      decoded.set(sha, buf)
      return buf
    } catch {
      // let a later play try again (the sound may be uploaded by then)
      setTimeout(() => buffers.delete(sha), 5000)
      return null
    }
  })()
  buffers.set(sha, p)
  return p
}

/** A decoded sound, or undefined while it loads. */
export const loadedSound = (sha: string): AudioBuffer | undefined => decoded.get(sha)

/** The file length of a decoded sound in seconds. */
export const soundLength = (sha: string): number | undefined => decoded.get(sha)?.duration

// ── engines ──────────────────────────────────────────────────────────────────

interface OneShot {
  src: AudioBufferSourceNode
  gain: GainNode
  playId: string
  padId?: string
  cueId?: string
}

interface ClipVoice {
  src: AudioBufferSourceNode
  gain: GainNode
  sig: string
  /** context time the source starts */
  when: number
  /** file position at `when` */
  offset: number
  end: number
}

/** A clip plan placed on the context clock: the source starts at `when` (context seconds). */
export type TimedPlan = ClipPlan & { when: number }

/** Makes the timed plans at context time `ctxNow`; called again whenever a sound finishes loading. */
export type Planner = (ctxNow: number) => TimedPlan[]

/** Seconds of lead so a planned start lands in the future (scheduling runs on the main thread). */
export const LEAD = 0.05
const FADE = 0.012

export class AudioEngine {
  private master: GainNode | null = null
  private shots = new Map<string, OneShot>()
  private voices = new Map<string, ClipVoice>()
  private planner: Planner | null = null
  private volume = 1
  private muted = false
  private disposed = false

  private ctx(): AudioContext | null {
    const ctx = audioContext()
    if (!ctx) return null
    if (!this.master) {
      this.master = ctx.createGain()
      this.master.gain.value = this.muted ? 0 : this.volume
      this.master.connect(ctx.destination)
    }
    return ctx
  }

  /** The master gain: volume 0..1, muted silences without losing the volume. Applies live to what plays. */
  setMaster(volume: number, muted: boolean) {
    this.volume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1))
    this.muted = muted
    const ctx = this.ctx()
    if (!ctx || !this.master) return
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, ctx.currentTime, 0.015)
  }

  get masterGain(): number {
    return this.muted ? 0 : this.volume
  }

  /** Plays a `sound.play` message: gain = msg.volume × master, looping while `loop`. */
  async playOneShot(msg: SoundPlayMsg): Promise<void> {
    const ctx = this.ctx()
    if (!ctx) return
    const buf = await loadSound(msg.sound)
    if (!buf || this.disposed || !this.master) return
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = !!msg.loop
    const gain = ctx.createGain()
    gain.gain.value = Math.max(0, Math.min(1, Number(msg.volume ?? 1)))
    src.connect(gain).connect(this.master)
    const when = ctx.currentTime
    src.start(when, 0)
    const shot: OneShot = { src, gain, playId: msg.playId, padId: msg.padId, cueId: msg.cueId }
    this.shots.set(msg.playId, shot)
    src.onended = () => {
      if (this.shots.get(msg.playId) === shot) this.shots.delete(msg.playId)
    }
    probe()?.started.push({ kind: 'oneshot', playId: msg.playId, padId: msg.padId, cueId: msg.cueId, sound: msg.sound, when, offset: 0, ctxTime: ctx.currentTime })
  }

  /** `sound.stop`: playId stops one, padId every sound of that pad, neither every one-shot (not the timeline). */
  stop(msg: SoundStopMsg = {}) {
    for (const [id, s] of [...this.shots]) {
      if (msg.playId ? id !== msg.playId : msg.padId ? s.padId !== msg.padId : false) continue
      this.fadeOut(s.src, s.gain)
      this.shots.delete(id)
      probe()?.stopped.push({ playId: id, padId: s.padId })
    }
  }

  /**
   * Plays the timeline from a planner: stops voices that no longer match the plan and starts the new ones. A voice
   * that already plays the same clip at the same file position (within 30 ms) keeps playing, so a show update that
   * changes nothing audible makes no glitch. Sounds still loading start once decoded (the planner runs again).
   */
  syncTimeline(planner: Planner | null) {
    this.planner = planner
    const ctx = this.ctx()
    if (!ctx || !this.master) return
    const now = ctx.currentTime
    const plans = planner ? planner(now) : []
    const want = new Map(plans.map((p) => [p.clipId, p]))
    for (const [id, v] of [...this.voices]) {
      const p = want.get(id)
      const ended = v.end <= now
      const posNow = v.offset + Math.max(0, now - v.when)
      const posPlan = p ? p.offset + (now - p.when) : 0
      const same = p && !ended && p.sig === v.sig && Math.abs(posNow - posPlan) < 0.03
      if (same) {
        want.delete(id)
        continue
      }
      if (!ended) {
        this.fadeOut(v.src, v.gain)
        probe()?.stopped.push({ clipId: id })
      }
      this.voices.delete(id)
    }
    for (const p of want.values()) {
      const buf = loadedSound(p.sound)
      if (!buf) {
        void loadSound(p.sound).then((b) => b && this.planner === planner && !this.disposed && this.syncTimeline(planner))
        continue
      }
      this.startVoice(ctx, buf, p)
    }
  }

  private startVoice(ctx: AudioContext, buf: AudioBuffer, p: TimedPlan) {
    const now = ctx.currentTime
    let when = p.when
    let offset = p.offset
    let duration = p.duration
    // a start that slipped into the past begins now, further into the file
    if (when < now) {
      const late = now - when
      offset += late
      duration -= late
      when = now
    }
    if (duration <= 0.005 || offset >= buf.duration) return
    const src = ctx.createBufferSource()
    src.buffer = buf
    const gain = ctx.createGain()
    const shift = when - p.when
    const env = p.envelope.map(([t, g]) => [t - shift, g] as [number, number]).filter(([t]) => t >= -1e-6)
    const g0 = gainAt(p.envelope, shift)
    gain.gain.setValueAtTime(g0, when)
    for (const [t, g] of env) if (t > 1e-6) gain.gain.linearRampToValueAtTime(g, when + t)
    src.connect(gain).connect(this.master!)
    src.start(when, offset, duration)
    const v: ClipVoice = { src, gain, sig: p.sig, when, offset, end: when + duration }
    this.voices.set(p.clipId, v)
    src.onended = () => {
      if (this.voices.get(p.clipId) === v) this.voices.delete(p.clipId)
    }
    probe()?.started.push({ kind: 'clip', clipId: p.clipId, sound: p.sound, when, offset, ctxTime: now })
  }

  /** Stops every timeline voice (pause, stop, another scene). */
  stopTimeline() {
    this.syncTimeline(null)
  }

  private fadeOut(src: AudioBufferSourceNode, gain: GainNode) {
    const ctx = audioContext()
    if (!ctx) return
    const t = ctx.currentTime
    try {
      gain.gain.cancelScheduledValues(t)
      gain.gain.setTargetAtTime(0, t, FADE / 3)
      src.stop(t + FADE * 2)
    } catch {
      /* already stopped */
    }
  }

  dispose() {
    this.stop()
    this.stopTimeline()
    this.disposed = true
    this.master?.disconnect()
    this.master = null
  }

  /** Makes a disposed engine usable again (React may unmount and mount an effect twice). */
  revive() {
    this.disposed = false
  }
}

/** The gain of a breakpoint envelope at `t` seconds (linear between points, held outside). */
export function gainAt(env: Array<[number, number]>, t: number): number {
  if (!env.length) return 1
  if (t <= env[0][0]) return env[0][1]
  for (let i = 1; i < env.length; i++) {
    const [t1, g1] = env[i]
    if (t <= t1) {
      const [t0, g0] = env[i - 1]
      return t1 - t0 <= 1e-9 ? g1 : g0 + ((g1 - g0) * (t - t0)) / (t1 - t0)
    }
  }
  return env[env.length - 1][1]
}

/**
 * Maps a clock in ms (performance.now or the server clock) onto the context clock: the context time that matches
 * `ms` on that clock, from the context's output timestamp.
 */
export function ctxTimeAt(ctx: BaseAudioContext & { getOutputTimestamp?: () => AudioTimestamp }, perfMs: number): number {
  const ts = ctx.getOutputTimestamp?.()
  if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) return ts.contextTime + (perfMs - ts.performanceTime) / 1000
  return ctx.currentTime + (perfMs - (typeof performance !== 'undefined' ? performance.now() : 0)) / 1000
}
