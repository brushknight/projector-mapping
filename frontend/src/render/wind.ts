/**
 * (§16) The wind that moves the live trees and palms, computed once per frame on the CPU so every pixel moves the same
 * smooth way. Pure: a function of the ambient clock and the layer's params.
 *
 *   sway     the crown's lean, about −1…1: three slow incommensurate swells
 *   gust     0…1: gusts that build over a couple of seconds and release slowly
 *   flutter  how much each leaf turns on its own, 0…~1.3
 */
import { fbm1 } from './math/hash'

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export interface WindState {
  sway: number
  gust: number
  flutter: number
}

export function windState(clock: number, wind: number, gust: number, seed = 0): WindState {
  const w = Math.max(0, Math.min(1, wind))
  const g = Math.max(0, Math.min(1, gust))
  // gusts: slow fractal noise, thresholded so most of the time is calm; smoothstep gives the build and the release
  const env = smooth(0.48, 0.78, fbm1(clock * 0.11 + seed * 3.1, Math.floor(seed * 97), 3)) * g
  const f = 0.6 + w * 0.7
  const swell = 0.55 * Math.sin(clock * 0.37 * f + 1.3 + seed) + 0.3 * Math.sin(clock * 0.61 * f + 0.4 + seed * 2) + 0.15 * Math.sin(clock * 1.13 * f + 2.1)
  const sway = swell * (0.25 + w) + env * (1.1 + 0.4 * Math.sin(clock * 0.83 + seed))
  return { sway, gust: env, flutter: 0.12 + 0.55 * w + 0.6 * env }
}
