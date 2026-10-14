/**
 * Pure scheduling math for timeline sound (protocol §14 "Sound on the timeline"): which sound clips play from a
 * playhead, after what delay, from which file position, for how long, and their gain envelope (linear fades at the
 * clip's ends). No Web Audio here, so it is unit-tested; audio.ts turns plans into source nodes.
 */
import type { Clip, Scene, SoundClipParams } from '../scene/types'

/** One clip to start: times are seconds relative to the playhead the plan was made at. */
export interface ClipPlan {
  clipId: string
  trackId: string
  sound: string
  /** seconds from the planning playhead until the source starts (0 = at once) */
  delay: number
  /** seconds into the file at the moment the source starts */
  offset: number
  /** seconds the source plays */
  duration: number
  /**
   * gain breakpoints as [seconds after the source starts, gain]; linear ramps between them (volume × fades). The first
   * point is at 0.
   */
  envelope: Array<[number, number]>
  /** identifies what the clip sounds like, so a re-plan can keep a source that already plays the same thing */
  sig: string
}

export interface PlanOptions {
  /** tracks muted locally (the editor's eye toggles) */
  mutedTracks?: ReadonlySet<string>
  /** the playhead where playback stops (a hold cue or the end of the timeline); default the timeline's duration */
  until?: number
  /** the file length of a sound when known (clips past the file's end are silent there) */
  fileDuration?: (sha: string) => number | undefined
  /** only clips that start within this many seconds of the playhead (default: all) */
  horizon?: number
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** A sound clip's params with the defaults filled in (§14: offset 0, volume 1). */
export function soundClipParams(clip: Pick<Clip, 'params'>): SoundClipParams {
  const p = (clip.params ?? {}) as Record<string, unknown>
  return { sound: typeof p.sound === 'string' ? p.sound : '', offset: Math.max(0, num(p.offset, 0)), volume: Math.max(0, Math.min(1, num(p.volume, 1))) }
}

/** The ids of the scene's sound tracks. */
export function soundTrackIds(scene: Scene): Set<string> {
  return new Set(scene.timeline.tracks.filter((t) => t.target.kind === 'sound').map((t) => t.id))
}

/** Every clip on a sound track with effect `sound` and a sound set. */
export function soundClips(scene: Scene): Clip[] {
  const tracks = soundTrackIds(scene)
  return scene.timeline.clips.filter((c) => tracks.has(c.trackId) && c.effect === 'sound' && !!soundClipParams(c).sound)
}

/** The clip's gain at playhead `t` (volume × the linear fade in and out), 0 outside the clip. */
export function clipGainAt(clip: Pick<Clip, 'start' | 'end' | 'fadeIn' | 'fadeOut' | 'params'>, t: number): number {
  if (t < clip.start || t > clip.end) return 0
  const v = soundClipParams(clip).volume
  let g = 1
  if (clip.fadeIn > 0) g = Math.min(g, (t - clip.start) / clip.fadeIn)
  if (clip.fadeOut > 0) g = Math.min(g, (clip.end - t) / clip.fadeOut)
  return Math.max(0, Math.min(1, g)) * v
}

/**
 * The gain breakpoints of a clip played from playhead `from` to `to`, as [seconds after `from`, gain]. The fades are
 * linear, so the gain is exact between the breakpoints (the fade corners and where an overlapping fade in and out
 * cross).
 */
export function clipEnvelope(clip: Pick<Clip, 'start' | 'end' | 'fadeIn' | 'fadeOut' | 'params'>, from: number, to: number): Array<[number, number]> {
  const ts = new Set<number>([from, to])
  if (clip.fadeIn > 0) ts.add(clip.start + clip.fadeIn)
  if (clip.fadeOut > 0) ts.add(clip.end - clip.fadeOut)
  if (clip.fadeIn > 0 && clip.fadeOut > 0 && clip.fadeIn + clip.fadeOut > clip.end - clip.start) {
    // (t − start)/fi = (end − t)/fo  →  t = (start·fo + end·fi) / (fi + fo)
    ts.add((clip.start * clip.fadeOut + clip.end * clip.fadeIn) / (clip.fadeIn + clip.fadeOut))
  }
  return [...ts]
    .filter((t) => t >= from - 1e-9 && t <= to + 1e-9)
    .sort((a, b) => a - b)
    .map((t) => [round6(t - from), round6(clipGainAt(clip, Math.max(from, Math.min(to, t))))] as [number, number])
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6

/** Where playback from `playhead` stops on the server (backend §9): the next cue that holds, or the end. */
export function holdPoint(scene: Scene, playhead: number): number {
  const duration = scene.timeline.duration
  const next = [...scene.timeline.cues].filter((c) => c.at > playhead + 1e-3 && c.at < duration).sort((a, b) => a.at - b.at)
  for (const c of next) if (!c.autoFollow) return c.at
  return duration
}

/**
 * The sound clips to start for a transport that plays from `playhead`: each with its delay, file offset, duration and
 * envelope. A clip that started before the playhead starts at once at the right file position (§14).
 */
export function planClips(scene: Scene, playhead: number, opts: PlanOptions = {}): ClipPlan[] {
  const until = Math.min(opts.until ?? scene.timeline.duration, scene.timeline.duration)
  const out: ClipPlan[] = []
  for (const c of soundClips(scene)) {
    if (opts.mutedTracks?.has(c.trackId)) continue
    const end = Math.min(c.end, until)
    if (end <= playhead + 1e-6 || c.start >= end) continue
    if (opts.horizon != null && c.start > playhead + opts.horizon) continue
    const p = soundClipParams(c)
    const from = Math.max(c.start, playhead)
    const offset = p.offset + (from - c.start)
    let duration = end - from
    const len = opts.fileDuration?.(p.sound)
    if (len != null && len > 0) {
      if (offset >= len) continue
      duration = Math.min(duration, len - offset)
    }
    if (duration <= 1e-4) continue
    out.push({
      clipId: c.id,
      trackId: c.trackId,
      sound: p.sound,
      delay: round6(from - playhead),
      offset: round6(offset),
      duration: round6(duration),
      envelope: clipEnvelope(c, from, from + duration),
      sig: JSON.stringify([p.sound, p.offset, p.volume, c.start, c.end, c.fadeIn, c.fadeOut, until]),
    })
  }
  return out
}
