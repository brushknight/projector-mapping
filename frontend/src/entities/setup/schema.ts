import { bool, lit, nullable, num, obj, str } from '../../shared/lib/guard'

export const setupOutputShape = obj({
  width: num, height: num, orientation: lit('landscape', 'portrait-cw', 'portrait-ccw'), flipH: bool, flipV: bool,
})
export const setupShape = obj({
  id: str, name: str, output: setupOutputShape, master: num, blackoutFadeMs: num,
  testPattern: lit('off', 'grid', 'white', 'crosshair', 'corners'),
  testPatternUntil: nullable(num),
  referenceAsset: nullable(str), calibrationId: nullable(str),
})
