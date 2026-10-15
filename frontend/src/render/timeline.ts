/** Timeline evaluation: which clips are active on which surface at time t. Pure. */
import type { Clip, Scene } from '../entities/scene/types'
import { trackSurfaces } from '../entities/scene/lib'

export interface ActiveClip {
  clip: Clip
  effect: string
  params: Clip['params']
  progress: number
  alpha: number
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

/** Map surfaceId → active clips in track order then clip order. */
export function evaluateTimeline(scene: Scene, t: number, mutedTracks?: ReadonlySet<string>): Map<string, ActiveClip[]> {
  const out = new Map<string, ActiveClip[]>()
  for (const track of scene.timeline.tracks) {
    if (mutedTracks?.has(track.id)) continue
    const clips = scene.timeline.clips.filter((c) => c.trackId === track.id && t >= c.start && t < c.end)
    if (!clips.length) continue
    const surfaces = trackSurfaces(scene, track)
    for (const clip of clips) {
      const a: ActiveClip = { clip, effect: clip.effect, params: clip.params, progress: clipProgress(clip, t), alpha: clipAlpha(clip, t) }
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
 * Per content layer id, the animated values at t: during a clip `from + (to − from) × progress`, after it the `to`
 * until the next clip starts, before the first clip its `from`.
 */
export function evaluateLayerClips(scene: Scene, t: number, mutedTracks?: ReadonlySet<string>): Map<string, LayerAnim> {
  const out = new Map<string, LayerAnim>()
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
      let v = val(clips[0], 'from')
      for (const c of clips) {
        if (t < c.start) break
        v = t < c.end ? val(c, 'from') + (val(c, 'to') - val(c, 'from')) * clipProgress(c, t) : val(c, 'to')
      }
      const cur = out.get(layerId) ?? {}
      cur[effect] = v
      out.set(layerId, cur)
    }
  }
  return out
}
