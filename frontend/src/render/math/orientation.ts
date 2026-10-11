import type { Orientation, Setup } from '../../entities/setup/types'

/** The authored scene size of a setup: portrait authors at height × width. */
export function sceneSizeOf(setup: Pick<Setup, 'output'>): { width: number; height: number } {
  const o = setup.output
  return o.orientation === 'landscape' ? { width: o.width, height: o.height } : { width: o.height, height: o.width }
}

/**
 * Maps a physical framebuffer position (u, v in 0..1, v down) to the scene position (0..1, y down).
 * Flips apply in physical space first, then the rotation: portrait-cw sx = v, sy = 1 − u; portrait-ccw sx = 1 − v,
 * sy = u. The GLSL final pass mirrors this exactly.
 */
export function physicalToScene(u: number, v: number, orientation: Orientation, flipH = false, flipV = false): [number, number] {
  if (flipH) u = 1 - u
  if (flipV) v = 1 - v
  switch (orientation) {
    case 'portrait-cw':
      return [v, 1 - u]
    case 'portrait-ccw':
      return [1 - v, u]
    default:
      return [u, v]
  }
}

/** The inverse of physicalToScene (scene → physical). */
export function sceneToPhysical(sx: number, sy: number, orientation: Orientation, flipH = false, flipV = false): [number, number] {
  let u: number, v: number
  switch (orientation) {
    case 'portrait-cw':
      ;[u, v] = [1 - sy, sx]
      break
    case 'portrait-ccw':
      ;[u, v] = [sy, 1 - sx]
      break
    default:
      ;[u, v] = [sx, sy]
  }
  if (flipH) u = 1 - u
  if (flipV) v = 1 - v
  return [u, v]
}

export const ORIENTATION_CODE: Record<Orientation, number> = { landscape: 0, 'portrait-cw': 1, 'portrait-ccw': 2 }
