import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { photoGain, photoLook, type RGB3 } from './photoLook'
import { LAYER_FS } from './shaders/layer'

describe('photo controls (§16)', () => {
  it('shows the original picture at brightness 100 % and warmth 0', () => {
    const grey: RGB3 = [0.5, 0.5, 0.5]
    const red: RGB3 = [1, 0.1, 0.05]
    expect(photoLook(grey, 1, 0)).toEqual(grey)
    expect(photoLook(red, 1, 0)).toEqual(red)
    expect(photoGain(1, 0)).toEqual([1, 1, 1])
  })

  it('never lifts a channel above its original value', () => {
    for (const w of [-1, -0.4, 0, 0.3, 1]) {
      for (const g of photoGain(1, w)) expect(g).toBeLessThanOrEqual(1)
      const c = photoLook([1, 1, 1], 1, w)
      expect(Math.max(...c)).toBeCloseTo(1, 10)
    }
    expect(photoGain(1, 1)[2]).toBeLessThan(0.7)
    expect(photoGain(0.5, 0)).toEqual([0.5, 0.5, 0.5])
  })

  it('matches the layer shader', () => {
    expect(LAYER_FS).toContain('vec3 wg = vec3(1.0 + 0.22 * u_pWarm, 1.0 + 0.04 * u_pWarm, 1.0 - 0.22 * u_pWarm);')
    expect(LAYER_FS).toContain('c *= u_pBright * wg / max(wg.r, max(wg.g, wg.b));')
    expect(LAYER_FS).not.toMatch(/u_pBright \* 1\.4/)
  })

  it('starts photos and videos at 90 %', () => {
    const catalog = JSON.parse(readFileSync(fileURLToPath(new URL('../../../contract/catalog.json', import.meta.url)), 'utf8'))
    expect(catalog.photoParams.brightness.default).toBe(0.9)
    expect(catalog.videoParams.brightness.default).toBe(0.9)
    expect(catalog.videoParams.audio.label).toBe('sound')
  })
})
