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
