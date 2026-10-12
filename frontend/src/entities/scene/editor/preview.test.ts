import { describe, expect, it } from 'vitest'
import { PREVIEW_STOPPED, previewPause, previewPlay, previewSeek, previewTime } from './preview'

describe('editor preview clock', () => {
  it('plays, pauses and seeks on its own clock', () => {
    let st = previewPlay(PREVIEW_STOPPED, 1000, 20)
    expect(previewTime(st, 3500, 20)).toBeCloseTo(2.5)
    st = previewPause(st, 3500, 20)
    expect(previewTime(st, 99999, 20)).toBeCloseTo(2.5)
    st = previewSeek(st, 7, 4000, 20)
    expect(previewTime(st, 5000, 20)).toBe(7)
  })
  it('holds at the end, or loops', () => {
    const st = previewPlay(PREVIEW_STOPPED, 0, 4)
    expect(previewTime(st, 5000, 4)).toBe(4)
    expect(previewTime({ ...st, loop: true }, 5000, 4)).toBeCloseTo(1)
    // playing again from the end starts over
    expect(previewPlay({ ...PREVIEW_STOPPED, offset: 4 }, 0, 4).offset).toBe(0)
  })
})
