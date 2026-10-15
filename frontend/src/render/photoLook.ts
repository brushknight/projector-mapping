/**
 * The photo controls of photo and video layers (protocol §16, "Video sound and brightness"): brightness 0..1 where
 * 1 (100 %) is the original picture, and warmth −1..1 as per-channel gains normalised so no channel ever goes above
 * its original value. The layer shader (shaders/layer.ts, photo branch) and the YouTube CSS (youtube.ts youtubeLook)
 * use exactly this math; keep them in sync.
 */

export type RGB3 = [number, number, number]

/** The warmth gains before normalising: warm lifts red and lowers blue, cool the other way. */
export function warmthGains(warmth: number): RGB3 {
  const w = Math.max(-1, Math.min(1, Number.isFinite(warmth) ? warmth : 0))
  return [1 + 0.22 * w, 1 + 0.04 * w, 1 - 0.22 * w]
}

/** The per-channel gain of the photo controls: brightness × warmth gains ÷ the largest gain (never above 1 at 100 %). */
export function photoGain(brightness: number, warmth: number): RGB3 {
  const b = Math.max(0, Math.min(1, Number.isFinite(brightness) ? brightness : 1))
  const g = warmthGains(warmth)
  const top = Math.max(...g)
  return [(b * g[0]) / top, (b * g[1]) / top, (b * g[2]) / top]
}

/** A colour (0..1 per channel) through the photo controls. */
export function photoLook(c: RGB3, brightness: number, warmth: number): RGB3 {
  const k = photoGain(brightness, warmth)
  return [c[0] * k[0], c[1] * k[1], c[2] * k[2]]
}
