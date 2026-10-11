/** Colour helpers: hex parsing, sRGB ↔ linear, blackbody (CCT) with tint, HSI. All in 0..1. */
export type RGB = [number, number, number]

export function hexToRgb(hex: string, fallback: RGB = [1, 1, 1]): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex?.trim?.() ?? '')
  if (!m) return fallback
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
export const hexToLinear = (hex: string, fallback?: RGB): RGB => hexToRgb(hex, fallback).map(srgbToLinear) as RGB

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/**
 * Blackbody colour of a temperature in kelvin (1000–40000), Tanner Helland's fit, normalised so the brightest
 * channel is 1. 6500 K ≈ white.
 */
export function kelvinToRgb(kelvin: number): RGB {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100
  let r: number, g: number, b: number
  if (t <= 66) {
    r = 255
    g = 99.4708025861 * Math.log(t) - 161.1195681661
  } else {
    r = 329.698727446 * (t - 60) ** -0.1332047592
    g = 288.1221695283 * (t - 60) ** -0.0755148492
  }
  if (t >= 66) b = 255
  else if (t <= 19) b = 0
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307
  const out: RGB = [clamp01(r / 255), clamp01(g / 255), clamp01(b / 255)]
  const m = Math.max(...out)
  return out.map((c) => c / m) as RGB
}

/** Green/magenta tint: −1 = green, +1 = magenta. Keeps the brightest channel at 1. */
export function applyTint(rgb: RGB, tint: number): RGB {
  const k = Math.max(-1, Math.min(1, tint)) * 0.5
  const out: RGB = k >= 0 ? [rgb[0], rgb[1] * (1 - k), rgb[2]] : [rgb[0] * (1 + k), rgb[1], rgb[2] * (1 + k)]
  const m = Math.max(...out)
  return m > 0 ? (out.map((c) => c / m) as RGB) : out
}

/** Hue 0–360, saturation 0–1, full intensity. */
export function hsiToRgb(hue: number, sat: number): RGB {
  const h = ((((hue % 360) + 360) % 360) / 60)
  const s = clamp01(sat)
  const c = s
  const x = c * (1 - Math.abs((h % 2) - 1))
  let r = 0, g = 0, b = 0
  if (h < 1) [r, g, b] = [c, x, 0]
  else if (h < 2) [r, g, b] = [x, c, 0]
  else if (h < 3) [r, g, b] = [0, c, x]
  else if (h < 4) [r, g, b] = [0, x, c]
  else if (h < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = 1 - s
  return [r + m, g + m, b + m]
}

export interface LightColorLike {
  mode: 'cct' | 'hsi'
  kelvin: number
  tint: number
  hue: number
  sat: number
}

/** The light's colour (display sRGB-ish, brightest channel 1). */
export function lightRgb(c: LightColorLike | null | undefined): RGB {
  if (!c) return kelvinToRgb(3200)
  return c.mode === 'hsi' ? hsiToRgb(c.hue, c.sat) : applyTint(kelvinToRgb(c.kelvin), c.tint)
}
