/** Deterministic hashing and 1D value noise (no Math.random anywhere in the engine). */

/** FNV-1a of a string → 0..1 */
export function hashString01(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) / 4294967296
}

/** Integer hash → 0..1 */
export function hash1(n: number): number {
  let x = Math.floor(n) | 0
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d)
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

/** Smooth value noise in 1D, 0..1 */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  const a = hash1(i * 1013 + seed * 7919)
  const b = hash1((i + 1) * 1013 + seed * 7919)
  return a + (b - a) * u
}

/** Fractal 1D noise, 0..1 */
export function fbm1(x: number, seed = 0, octaves = 3): number {
  let sum = 0, amp = 0.5, norm = 0, f = 1
  for (let o = 0; o < octaves; o++) {
    sum += noise1(x * f, seed + o * 17) * amp
    norm += amp
    amp *= 0.5
    f *= 2.03
  }
  return sum / norm
}
