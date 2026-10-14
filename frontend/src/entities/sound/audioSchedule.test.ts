import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Clip, Scene } from '../scene/types'
import { clipEnvelope, clipGainAt, holdPoint, planClips, soundClipParams, soundClips } from './audioSchedule'

const scene: Scene = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../contract/fixtures/scene.json', import.meta.url)), 'utf8'))
// the fixture's clp_rain: start 2, end 9, fadeIn 0.5, fadeOut 1.5, offset 0.5, volume 0.8 on trk_sound
const clip = scene.timeline.clips.find((c) => c.id === 'clp_rain')!

const withCues = (cues: Scene['timeline']['cues']): Scene => ({ ...scene, timeline: { ...scene.timeline, cues } })

describe('sound clip scheduling', () => {
  it('finds only sound clips on sound tracks', () => {
    expect(soundClips(scene).map((c) => c.id)).toEqual(['clp_rain'])
    expect(soundClipParams({ params: {} })).toEqual({ sound: '', offset: 0, volume: 1 })
  })

  it('delays a clip that starts after the playhead and starts at its offset', () => {
    const [p] = planClips(withCues([]), 0)
    expect(p).toMatchObject({ clipId: 'clp_rain', sound: '5d1e0a', delay: 2, offset: 0.5, duration: 7 })
  })

  it('starts a clip already under the playhead at once, at the right file position', () => {
    const [p] = planClips(withCues([]), 5)
    expect(p).toMatchObject({ delay: 0, offset: 3.5, duration: 4 })
    expect(p.envelope[0]).toEqual([0, 0.8])
  })

  it('skips clips that ended, and cuts at the next hold cue', () => {
    expect(planClips(withCues([]), 9.5)).toEqual([])
    // the fixture's cues hold at 4 and 6: playing from 0 stops at 4
    expect(holdPoint(scene, 0)).toBe(4)
    const [p] = planClips(scene, 0, { until: holdPoint(scene, 0) })
    expect(p).toMatchObject({ delay: 2, offset: 0.5, duration: 2 })
    // an autoFollow cue does not hold
    const af = withCues([{ id: 'a', at: 4, label: 'a', autoFollow: true }])
    expect(holdPoint(af, 0)).toBe(scene.timeline.duration)
  })

  it('is silent past the end of the file', () => {
    const [p] = planClips(withCues([]), 0, { fileDuration: () => 3 })
    expect(p.duration).toBeCloseTo(2.5)
    expect(planClips(withCues([]), 6, { fileDuration: () => 3 })).toEqual([])
  })

  it('leaves muted tracks out and respects the horizon', () => {
    expect(planClips(withCues([]), 0, { mutedTracks: new Set(['trk_sound']) })).toEqual([])
    expect(planClips(withCues([]), 0, { horizon: 1 })).toEqual([])
  })

  it('computes the fade envelope', () => {
    expect(clipGainAt(clip, 2)).toBe(0)
    expect(clipGainAt(clip, 2.25)).toBeCloseTo(0.4)
    expect(clipGainAt(clip, 5)).toBeCloseTo(0.8)
    expect(clipGainAt(clip, 8.25)).toBeCloseTo(0.4)
    expect(clipGainAt(clip, 9)).toBe(0)
    expect(clipEnvelope(clip, 2, 9)).toEqual([[0, 0], [0.5, 0.8], [5.5, 0.8], [7, 0]])
    // from inside the fade in
    expect(clipEnvelope(clip, 2.25, 9)[0]).toEqual([0, 0.4])
  })

  it('handles overlapping fades with their crossing point', () => {
    const c: Clip = { id: 'c', trackId: 't', effect: 'sound', start: 0, end: 2, fadeIn: 2, fadeOut: 2, params: { sound: 'x' } }
    expect(clipEnvelope(c, 0, 2)).toEqual([[0, 0], [1, 0.5], [2, 0]])
  })
})
