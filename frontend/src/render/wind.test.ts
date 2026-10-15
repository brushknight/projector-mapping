import { describe, expect, it } from 'vitest'
import { windState } from './wind'

describe('wind (§16)', () => {
  it('is the same for the same clock', () => {
    expect(windState(12.3, 0.4, 0.2, 1)).toEqual(windState(12.3, 0.4, 0.2, 1))
  })
  it('moves smoothly: no jumps between frames', () => {
    let prev = windState(0, 0.6, 0.8, 2)
    let maxStep = 0
    for (let i = 1; i < 60 * 120; i++) {
      const w = windState(i / 60, 0.6, 0.8, 2)
      maxStep = Math.max(maxStep, Math.abs(w.sway - prev.sway), Math.abs(w.gust - prev.gust))
      prev = w
    }
    expect(maxStep).toBeLessThan(0.05)
  })
  it('blows harder with more wind and gusts that come and go', () => {
    const range = (wind: number, gust: number) => {
      let lo = Infinity, hi = -Infinity, g = 0
      for (let i = 0; i < 6000; i++) {
        const w = windState(i / 10, wind, gust, 3)
        lo = Math.min(lo, w.sway)
        hi = Math.max(hi, w.sway)
        g = Math.max(g, w.gust)
      }
      return { span: hi - lo, g }
    }
    expect(range(0.9, 0).span).toBeGreaterThan(range(0.1, 0).span)
    expect(range(0.4, 1).g).toBeGreaterThan(0.5)
    expect(range(0.4, 0).g).toBe(0)
  })
})
