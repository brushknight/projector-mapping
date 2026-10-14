import { describe, expect, it } from 'vitest'
import { baseName, computePeaks, isSoundFile } from './peaks'

describe('sound peaks', () => {
  it('takes the largest absolute sample per slice over every channel', () => {
    const l = new Float32Array([0, 0.5, -0.25, 0, 0, 0, 0.1, -0.9])
    const r = new Float32Array([0, 0, 0, -0.75, 0, 0, 0, 0])
    expect(computePeaks([l, r], 4)).toEqual([0.5, 0.75, 0, 0.9])
  })
  it('handles short files and empty input', () => {
    expect(computePeaks([new Float32Array([0.2, -0.4])], 4)).toHaveLength(4)
    expect(computePeaks([], 128)).toEqual([])
  })
  it('accepts the §14 formats only and names by the file', () => {
    expect(['a.wav', 'b.MP3', 'c.m4a', 'd.aiff', 'e.aif', 'f.ogg'].every((n) => isSoundFile({ name: n }))).toBe(true)
    expect(isSoundFile({ name: 'x.flac' })).toBe(false)
    expect(baseName('rain on glass.mp3')).toBe('rain on glass')
  })
})
