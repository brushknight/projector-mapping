/** 3×3 homographies, row-major [h0..h8], mapping (x, y, 1) → (x', y', w'). */
export type Mat3 = [number, number, number, number, number, number, number, number, number]
export type Vec2 = [number, number]

/** Solves the 8×8 linear system for the homography that maps src[i] → dst[i] (4 points each). */
export function homography(src: readonly Vec2[], dst: readonly Vec2[]): Mat3 {
  const A: number[][] = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i]
    const [u, v] = dst[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  // Gaussian elimination with partial pivoting on the augmented 8×9 matrix
  for (let c = 0; c < 8; c++) {
    let piv = c
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r
    if (Math.abs(A[piv][c]) < 1e-12) throw new Error('degenerate quad')
    ;[A[c], A[piv]] = [A[piv], A[c]]
    for (let r = 0; r < 8; r++) {
      if (r === c) continue
      const f = A[r][c] / A[c][c]
      if (f === 0) continue
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k]
    }
  }
  const h = A.map((row, i) => row[8] / row[i])
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]
}

/** The homography from the unit square (0,0)(1,0)(1,1)(0,1) to a quad given clockwise from top-left. */
export function squareToQuad(quad: readonly Vec2[]): Mat3 {
  return homography([[0, 0], [1, 0], [1, 1], [0, 1]], quad)
}

export function applyH(h: Mat3, x: number, y: number): Vec2 {
  const w = h[6] * x + h[7] * y + h[8]
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]
}

export function invert3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-18) throw new Error('singular matrix')
  const s = 1 / det
  return [
    A * s, -(b * i - c * h) * s, (b * f - c * e) * s,
    B * s, (a * i - c * g) * s, -(a * f - c * d) * s,
    C * s, -(a * h - b * g) * s, (a * e - b * d) * s,
  ]
}

/** Column-major Float32Array for a GLSL mat3 uniform. */
export function toGlMat3(m: Mat3, out = new Float32Array(9)): Float32Array {
  out[0] = m[0]; out[1] = m[3]; out[2] = m[6]
  out[3] = m[1]; out[4] = m[4]; out[5] = m[7]
  out[6] = m[2]; out[7] = m[5]; out[8] = m[8]
  return out
}
