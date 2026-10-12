import { describe, expect, it } from 'vitest'
import { crc32 } from './template'

describe('zip helpers', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
})
