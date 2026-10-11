import { describe, expect, it } from 'vitest'
import { activeTestPattern, testPatternSecondsLeft } from './types'

describe('test pattern expiry', () => {
  const now = 1_791_700_000_000 // server ms
  it('counts an expired pattern as off', () => {
    expect(activeTestPattern({ testPattern: 'grid', testPatternUntil: (now - 1) * 1e6 }, now)).toBe('off')
    expect(activeTestPattern({ testPattern: 'grid', testPatternUntil: (now + 5000) * 1e6 }, now)).toBe('grid')
    expect(activeTestPattern({ testPattern: 'off', testPatternUntil: null }, now)).toBe('off')
    // a server that predates expiry sends no deadline: trust the pattern
    expect(activeTestPattern({ testPattern: 'white' }, now)).toBe('white')
    expect(activeTestPattern(null, now)).toBe('off')
  })
  it('says how many seconds are left', () => {
    expect(testPatternSecondsLeft({ testPattern: 'grid', testPatternUntil: (now + 41_200) * 1e6 }, now)).toBe(42)
    expect(testPatternSecondsLeft({ testPattern: 'grid', testPatternUntil: (now - 10) * 1e6 }, now)).toBe(0)
    expect(testPatternSecondsLeft({ testPattern: 'off', testPatternUntil: null }, now)).toBeNull()
  })
})
