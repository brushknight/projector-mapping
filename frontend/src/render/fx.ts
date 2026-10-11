/**
 * Light FX curves: time-based gain and colour, pure functions of (clock seconds, speed 0..1, seed).
 * The engine passes the result to the layer shader as uniforms.
 */
import type { LightFxKind } from '../entities/scene/types'
import type { RGB } from './math/color'
import { fbm1, hash1, noise1 } from './math/hash'

export interface FxSample {
  gain: number
  rgb: RGB
}

const WHITE: RGB = [1, 1, 1]

export function lightFx(kind: LightFxKind | string | undefined, clock: number, speed: number, seed = 0): FxSample {
  const s = 0.25 + Math.max(0, Math.min(1, speed)) * 2.75 // rate multiplier 0.25..3
  const t = clock * s
  switch (kind) {
    case 'candle': {
      const f = fbm1(t * 6, seed, 3)
      return { gain: 0.78 + 0.3 * f, rgb: [1, 0.92 + 0.05 * f, 0.8] }
    }
    case 'fire': {
      const f = fbm1(t * 9, seed + 3, 4)
      const g = fbm1(t * 2.3, seed + 9, 2)
      return { gain: 0.55 + 0.6 * f * (0.6 + 0.4 * g), rgb: [1, 0.72 + 0.2 * f, 0.45 + 0.2 * f] }
    }
    case 'lightning': {
      // a flash every few seconds: a quick double strike, then dark
      const period = 3.5
      const k = Math.floor(t / period)
      const local = t - k * period
      const at = hash1(k * 31 + seed) * (period - 0.6)
      const d = local - at
      let g = 0
      if (d >= 0 && d < 0.6) g = Math.exp(-d * 18) + (d > 0.12 ? 0.8 * Math.exp(-(d - 0.12) * 14) : 0)
      const strike = hash1(k * 17 + seed + 5) < 0.75 ? 1 : 0
      return { gain: 0.06 + Math.min(1.2, g * strike), rgb: [0.85, 0.9, 1] }
    }
    case 'paparazzi': {
      const slot = Math.floor(t * 8)
      const local = t * 8 - slot
      const flash = hash1(slot * 13 + seed) < 0.18 ? Math.exp(-local * 7) : 0
      return { gain: 0.04 + flash * 1.1, rgb: WHITE }
    }
    case 'tv': {
      const cut = Math.floor(t * 1.3)
      const base = 0.35 + 0.45 * hash1(cut * 7 + seed)
      const f = noise1(t * 14, seed + 1)
      const hue = hash1(cut * 3 + seed + 2)
      return { gain: base * (0.8 + 0.25 * f), rgb: [0.7 + 0.3 * hue, 0.8 + 0.15 * (1 - hue), 1] }
    }
    case 'breathe':
      return { gain: 0.35 + 0.65 * (0.5 - 0.5 * Math.cos(t * Math.PI * 0.8)), rgb: WHITE }
    case 'strobe': {
      const hz = 2 + Math.max(0, Math.min(1, speed)) * 10
      return { gain: (clock * hz) % 1 < 0.22 ? 1.1 : 0, rgb: WHITE }
    }
    case 'police': {
      const phase = Math.floor(t * 2.4) % 2
      const blink = (t * 9.6) % 1 < 0.5 ? 1 : 0.15
      return { gain: blink, rgb: phase === 0 ? [1, 0.08, 0.06] : [0.08, 0.2, 1] }
    }
    default:
      return { gain: 1, rgb: WHITE }
  }
}
