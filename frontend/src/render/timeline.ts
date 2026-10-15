/**
 * Timeline evaluation: which clips are in effect on which surface at time t. Pure: the state at t is a function of the
 * document and t only (protocol §20), so a seek, back or GO lands on exactly what playing there would show.
 */
import type { Clip, Scene } from '../entities/scene/types'
import { trackSurfaces } from '../entities/scene/lib'

export interface ActiveClip {
  clip: Clip
  effect: string
  params: Clip['params']
  progress: number
  alpha: number
  /** (§20) the clip has ended and holds its end state */
  held?: boolean
}

/** (§20) effects whose clips hold their end state (to the end of their step) when `hold` is absent. */
export const HOLD_BY_DEFAULT: ReadonlySet<string> = new Set(['converge', 'morph', 'shape', 'reveal', 'sweep', 'motion'])
/** (§20) effects the engine draws over the whole scene, not inside surfaces: surface content never gets their clips */
export const SCENE_EFFECTS: ReadonlySet<string> = new Set(['converge', 'morph', 'shape'])

/** (§20, §21) how a clip keeps its end state: not at all, to the end of its step (the next cue), or until replaced. */
export type HoldMode = 'off' | 'step' | 'forever'

/** The clip's hold: its own `hold` (true is `step`, false `off`), else the effect's default (`step` or `off`). */
export function clipHoldMode(c: Pick<Clip, 'effect' | 'hold'>): HoldMode {
  const h = c.hold as unknown
  if (h === 'step' || h === 'forever') return h
  if (h === true) return 'step'
  if (h === false || h === 'off') return 'off'
  return HOLD_BY_DEFAULT.has(c.effect) ? 'step' : 'off'
}

/** Whether a clip keeps its end state after its end at all (step or forever). */
export function clipHolds(c: Pick<Clip, 'effect' | 'hold'>): boolean {
  return clipHoldMode(c) !== 'off'
}

/** (§21) the cue times of a scene, sorted: the step boundaries. */
export function stepBounds(scene: Pick<Scene, 'timeline'> | null | undefined): number[] {
  return (scene?.timeline.cues ?? []).map((c) => c.at).sort((a, b) => a - b)
}

/** (§21) where the step that starts a clip ends: the first cue after its start, Infinity when none. */
export function stepEnd(start: number, bounds: readonly number[]): number {
  for (const b of bounds) if (b > start + 1e-6) return b
  return Infinity
}

export function clipAlpha(c: Pick<Clip, 'start' | 'end' | 'fadeIn' | 'fadeOut'>, t: number): number {
  const fi = c.fadeIn > 0 ? Math.min(1, (t - c.start) / c.fadeIn) : 1
  const fo = c.fadeOut > 0 ? Math.min(1, (c.end - t) / c.fadeOut) : 1
  return Math.max(0, Math.min(fi, 1) * Math.min(fo, 1))
}

export function clipProgress(c: Pick<Clip, 'start' | 'end'>, t: number): number {
  const len = c.end - c.start
  return len > 0 ? Math.max(0, Math.min(1, (t - c.start) / len)) : 1
}

/**
 * (§20) Where a clip stands at t: `play` while start ≤ t < end, `held` after its end when it holds and no later clip
 * with the same effect on its track has started, else null. `clips` are the clips of its track.
 */
export function clipPhase(c: Clip, clips: readonly Clip[], t: number, bounds: readonly number[] = []): 'play' | 'held' | null {
  if (t < c.start) return null
  if (t < c.end) return 'play'
  const mode = clipHoldMode(c)
  if (mode === 'off') return null
  // (§21) a step hold ends with its step: at the cue after its start (still shown while the transport waits on that
  // cue), so the next step draws from scratch
  if (mode === 'step' && t > stepEnd(c.start, bounds) + 1e-6) return null
  // a later clip of the same effect (later start, or the same start further down the list) that has started takes over
  const i = clips.indexOf(c)
  for (let k = 0; k < clips.length; k++) {
    const d = clips[k]
    if (d === c || d.effect !== c.effect || d.start > t) continue
    if (d.start > c.start || (d.start === c.start && k > i)) return null
  }
  return 'held'
}

/** One clip's state at t, or null when it is not in effect (a held clip has progress 1 and no fade out). */
export function clipState(c: Clip, clips: readonly Clip[], t: number, bounds: readonly number[] = []): Omit<ActiveClip, 'clip' | 'effect' | 'params'> | null {
  const phase = clipPhase(c, clips, t, bounds)
  if (!phase) return null
  if (phase === 'held') return { progress: 1, alpha: clipAlpha({ ...c, fadeOut: 0 }, t), held: true }
  return { progress: clipProgress(c, t), alpha: clipAlpha(c, t) }
}

/**
 * Map surfaceId → clips in effect at t (playing, or held after their end) in track order then clip order. Scene-wide
 * effects (the converge) are left out: render/converge.ts evaluates them.
 */
export function evaluateTimeline(scene: Scene, t: number, mutedTracks?: ReadonlySet<string>): Map<string, ActiveClip[]> {
  const out = new Map<string, ActiveClip[]>()
  const bounds = stepBounds(scene)
  for (const track of scene.timeline.tracks) {
    if (mutedTracks?.has(track.id)) continue
    const all = scene.timeline.clips.filter((c) => c.trackId === track.id && !SCENE_EFFECTS.has(c.effect))
    const states = all.map((clip) => [clip, clipState(clip, all, t, bounds)] as const).filter(([, st]) => !!st)
    if (!states.length) continue
    const surfaces = trackSurfaces(scene, track)
    for (const [clip, st] of states) {
      const a: ActiveClip = { clip, effect: clip.effect, params: clip.params, ...st! }
      for (const s of surfaces) {
        let list = out.get(s.id)
        if (!list) out.set(s.id, (list = []))
        list.push(a)
      }
    }
  }
  return out
}

/** What layer clips (track target `layer`, protocol §12) set at time t. */
export interface LayerAnim {
  reveal?: number
  /** gradient offset or media x */
  sweep?: number
  /** (§15) a motion's progress along its path, set by `motion` clips on an attachment, backdrop layer or light */
  motion?: number
}

export const LAYER_CLIP_EFFECTS = ['reveal', 'sweep', 'motion'] as const
export const LAYER_CLIP_DEFAULTS: Record<string, { from: number; to: number }> = { reveal: { from: 0, to: 1 }, sweep: { from: -1, to: 1 }, motion: { from: 0, to: 1 } }

/**
 * Per content layer id, the animated values at t: during a clip `from + (to − from) × progress`; after a clip that
 * holds (the default for these effects) its `to` until the next clip starts, and with `hold: "step"` (the default) only
 * to the end of its step (§21), then back to the value held for ever before it (the first clip's `from` at first);
 * after one with `hold: false` the value it had before that clip (§20); before the first clip its `from`.
 */
export function evaluateLayerClips(scene: Scene, t: number, mutedTracks?: ReadonlySet<string>): Map<string, LayerAnim> {
  const out = new Map<string, LayerAnim>()
  const bounds = stepBounds(scene)
  for (const track of scene.timeline.tracks) {
    if (track.target.kind !== 'layer' || mutedTracks?.has(track.id)) continue
    const layerId = track.target.id
    for (const effect of LAYER_CLIP_EFFECTS) {
      const clips = scene.timeline.clips.filter((c) => c.trackId === track.id && c.effect === effect).sort((a, b) => a.start - b.start)
      if (!clips.length) continue
      const val = (c: Clip, k: 'from' | 'to') => {
        const v = Number((c.params as Record<string, unknown>)[k])
        return Number.isFinite(v) ? v : LAYER_CLIP_DEFAULTS[effect][k]
      }
      // `kept` is the state carried from the clips before; a playing clip shows over it
      let forever = val(clips[0], 'from')
      let kept = forever
      let keptUntil = Infinity
      let v = kept
      for (const c of clips) {
        if (t < c.start) break
        if (t < c.end) v = val(c, 'from') + (val(c, 'to') - val(c, 'from')) * clipProgress(c, t)
        else {
          const mode = clipHoldMode(c)
          if (mode === 'forever') {
            forever = kept = val(c, 'to')
            keptUntil = Infinity
          } else if (mode === 'step') {
            kept = val(c, 'to')
            keptUntil = stepEnd(c.start, bounds)
          }
          if (t > keptUntil + 1e-6) {
            kept = forever
            keptUntil = Infinity
          }
          v = kept
        }
      }
      const cur = out.get(layerId) ?? {}
      cur[effect] = v
      out.set(layerId, cur)
    }
  }
  return out
}
