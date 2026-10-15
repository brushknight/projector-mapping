import { describe, expect, it } from 'vitest'
import type { Motion } from '../entities/scene/types'
import { durationFromSpeed, ease, loopProgress, motionProgress, pathPoint, pauseMotion, playMotion, retimeMotion, sampleMotion, speedFromDuration } from './motion'

const base: Motion = {
  on: true, preset: 'sun-lr', from: { x: -0.6, y: 0.08 }, via: { x: 0, y: -0.04 }, to: { x: 0.6, y: 0.08 }, duration: 600,
  easing: 'inOut', loop: 'loop', rotate: 8, scaleFrom: 1, scaleTo: 1, kelvinFrom: 0, kelvinTo: 0, phase: 0, startedAt: 1_000_000,
}

describe('motion (§15)', () => {
  it('eases', () => {
    expect(ease('linear', 0.25)).toBeCloseTo(0.25)
    expect(ease('in', 0.5)).toBeCloseTo(0.25)
    expect(ease('out', 0.5)).toBeCloseTo(0.75)
    expect(ease('inOut', 0.5)).toBeCloseTo(0.5)
    expect(ease('sine', 0)).toBeCloseTo(0)
    expect(ease('sine', 1)).toBeCloseTo(1)
  })
  it('loops', () => {
    expect(loopProgress('once', 1.4)).toBe(1)
    expect(loopProgress('loop', 1.25)).toBeCloseTo(0.25)
    expect(loopProgress('pingpong', 1.25)).toBeCloseTo(0.75)
    expect(loopProgress('pingpong', 0.25)).toBeCloseTo(0.25)
  })
  it('runs on the server clock and holds while off', () => {
    expect(motionProgress(base, 1_000_000 + 300_000)).toBeCloseTo(0.5)
    expect(motionProgress({ ...base, on: false, phase: 0.3 }, 9e12)).toBe(0.3)
  })
  it('passes through via at the middle', () => {
    const p = pathPoint(base.from, base.to, base.via, 0.5)
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(-0.04)
    expect(pathPoint(base.from, base.to, null, 0.5).y).toBeCloseTo(0.08)
  })
  it('samples rotation, scale and kelvin drift', () => {
    const m = { ...base, loop: 'once' as const, easing: 'linear' as const, scaleFrom: 1.5, scaleTo: 1, kelvinFrom: 2300, kelvinTo: 4300 }
    const s = sampleMotion(m, 1_000_000 + 600_000)
    expect(s.rotate).toBeCloseTo(8)
    expect(s.scale).toBeCloseTo(1)
    expect(s.kelvin).toBeCloseTo(4300)
    expect(sampleMotion(base, 0).kelvin).toBeNull()
    expect(sampleMotion({ ...base, on: false, phase: 0 }, 0, 1).x).toBeCloseTo(0.6)
  })
  it('pauses, plays and retimes in place', () => {
    const now = 1_000_000 + 120_000
    const p = pauseMotion(base, now)
    expect(p.on).toBe(false)
    expect(p.phase).toBeCloseTo(0.2)
    const r = playMotion(p, now + 5000)
    expect(motionProgress(r, now + 5000)).toBeCloseTo(0.2)
    const t = retimeMotion(base, 60, now)
    expect(motionProgress(t, now)).toBeCloseTo(0.2)
    expect(motionProgress(t, now + 6000)).toBeCloseTo(0.3)
  })
  it('maps speed to duration on a log scale', () => {
    expect(durationFromSpeed(0)).toBe(7200)
    expect(durationFromSpeed(1)).toBe(5)
    expect(speedFromDuration(durationFromSpeed(0.4))).toBeCloseTo(0.4, 2)
  })
})
