/** Protocol §7 calibration patterns. */
export const grayCode = (c: number): number => (c ^ (c >>> 1)) >>> 0

/** Number of bits needed for size W: N = ceil(log2(W)). */
export const grayBits = (w: number): number => Math.max(1, Math.ceil(Math.log2(w)))

/** True when column/row c is white for the given bit and inverse flag. */
export function grayPixel(c: number, bit: number, inverse: boolean): boolean {
  const on = ((grayCode(c) >>> bit) & 1) === 1
  return on !== inverse
}
