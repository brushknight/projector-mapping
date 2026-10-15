/**
 * Motion (protocol §15): a move across the wall on the server clock. Pure: pass the server time in ms.
 */
import type { FramePt, Motion, MotionEasing, MotionLoop } from '../entities/scene/types'

export interface MotionSample {
  /** raw progress before the loop mode */
  u: number
  /** eased position along the path, 0..1 */
  e: number
  /** offset to add, frame fractions */
  x: number
  y: number
  /** degrees to add */
  rotate: number
  /** multiplier */
  scale: number
  /** the drifted CCT, or null when the motion has no kelvin drift */
  kelvin: number | null
}

export const NO_MOTION: MotionSample = { u: 0, e: 0, x: 0, y: 0, rotate: 0, scale: 1, kelvin: null }

export function ease(kind: MotionEasing | string | undefined, u: number): number {
  const x = Math.max(0, Math.min(1, u))
  switch (kind) {
    case 'in':
      return x * x
    case 'out':
      return 1 - (1 - x) * (1 - x)
    case 'inOut':
      return x * x * (3 - 2 * x)
    case 'sine':
      return 0.5 - 0.5 * Math.cos(Math.PI * x)
    default:
      return x
  }
}

/** Maps a raw progress through the loop mode to 0..1. */
export function loopProgress(loop: MotionLoop | string | undefined, u: number): number {
  if (!Number.isFinite(u)) return 0
  if (loop === 'loop') return u - Math.floor(u)
  if (loop === 'pingpong') {
    const m = ((u % 2) + 2) % 2
    return 1 - Math.abs(1 - m)
  }
  return Math.max(0, Math.min(1, u))
}

/** The raw progress at server time `nowMs`: phase while off, phase + elapsed / duration while on. */
export function motionProgress(m: Pick<Motion, 'on' | 'phase' | 'startedAt' | 'duration'>, nowMs: number): number {
  const phase = Number.isFinite(m.phase) ? m.phase : 0
  if (!m.on) return phase
  const dur = Math.max(0.001, m.duration || 1)
  const started = Number.isFinite(m.startedAt) && m.startedAt > 0 ? m.startedAt : nowMs
  return phase + Math.max(0, nowMs - started) / (1000 * dur)
}

/** A point on the path at eased progress e: straight, or the quadratic curve through `via`. */
export function pathPoint(from: FramePt, to: FramePt, via: FramePt | null | undefined, e: number): FramePt {
  if (!via) return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e }
  const cx = 2 * via.x - (from.x + to.x) / 2
  const cy = 2 * via.y - (from.y + to.y) / 2
  const a = (1 - e) * (1 - e), b = 2 * e * (1 - e), c = e * e
  return { x: a * from.x + b * cx + c * to.x, y: a * from.y + b * cy + c * to.y }
}

/**
 * Where a motion is at server time `nowMs`. `override` is a progress set by a timeline motion clip (it replaces the
 * clock). Missing or null motion → NO_MOTION.
 */
export function sampleMotion(m: Motion | null | undefined, nowMs: number, override?: number | null): MotionSample {
  if (!m) return NO_MOTION
  // a timeline clip sets the place along the path directly (0..1), whatever the loop mode
  const u = override ?? motionProgress(m, nowMs)
  const e = ease(m.easing, override != null ? Math.max(0, Math.min(1, override)) : loopProgress(m.loop, u))
  const p = pathPoint(m.from ?? { x: 0, y: 0 }, m.to ?? { x: 0, y: 0 }, m.via, e)
  const s0 = m.scaleFrom || 1, s1 = m.scaleTo || 1
  const k0 = m.kelvinFrom || 0, k1 = m.kelvinTo || 0
  return {
    u,
    e,
    x: p.x,
    y: p.y,
    rotate: (m.rotate || 0) * e,
    scale: s0 + (s1 - s0) * e,
    kelvin: k0 > 0 && k1 > 0 ? k0 + (k1 - k0) * e : null,
  }
}

/** Pausing keeps the place: phase = the progress now, on = false (§15). */
export function pauseMotion(m: Motion, nowMs: number): Motion {
  return { ...m, on: false, phase: motionProgress(m, nowMs) }
}

/** Playing again starts the clock from the held place. */
export function playMotion(m: Motion, nowMs: number): Motion {
  return { ...m, on: true, startedAt: Math.round(nowMs) }
}

/** A speed change keeps the place: phase = progress now, startedAt = now, then the new duration. */
export function retimeMotion(m: Motion, duration: number, nowMs: number): Motion {
  return { ...m, phase: motionProgress(m, nowMs), startedAt: Math.round(nowMs), duration: Math.max(1, Math.min(86400, duration)) }
}

/** Keeps phase in 0..2 after long runs (loop and ping-pong repeat every 1 and 2). */
export function normalizePhase(m: Motion): Motion {
  if (m.loop === 'once') return { ...m, phase: Math.max(0, Math.min(1, m.phase)) }
  const period = m.loop === 'pingpong' ? 2 : 1
  return { ...m, phase: ((m.phase % period) + period) % period }
}

/** The phone's and editor's speed slider: 0..1 ↔ duration 5 s … 2 h on a log scale. */
export const SPEED_MIN_S = 5
export const SPEED_MAX_S = 7200
export function durationFromSpeed(speed: number): number {
  const s = Math.max(0, Math.min(1, speed))
  // speed 1 = fastest (shortest)
  return Math.round(SPEED_MAX_S * (SPEED_MIN_S / SPEED_MAX_S) ** s)
}
export function speedFromDuration(duration: number): number {
  const d = Math.max(SPEED_MIN_S, Math.min(SPEED_MAX_S, duration))
  return Math.log(d / SPEED_MAX_S) / Math.log(SPEED_MIN_S / SPEED_MAX_S)
}
