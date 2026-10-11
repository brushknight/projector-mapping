/** Protocol §1 Setup: a projector rig. */
export type Orientation = 'landscape' | 'portrait-cw' | 'portrait-ccw'
export type TestPattern = 'off' | 'grid' | 'white' | 'crosshair' | 'corners'

export interface SetupOutput {
  width: number
  height: number
  orientation: Orientation
  flipH: boolean
  flipV: boolean
}

export interface Setup {
  id: string
  name: string
  output: SetupOutput
  master: number
  blackoutFadeMs: number
  testPattern: TestPattern
  /** server unix ns when the pattern turns off (null while off); protocol §1 Setup */
  testPatternUntil?: number | null
  referenceAsset: string | null
  calibrationId: string | null
}

export const ORIENTATIONS: Orientation[] = ['landscape', 'portrait-cw', 'portrait-ccw']
export const TEST_PATTERNS: TestPattern[] = ['off', 'grid', 'white', 'crosshair', 'corners']

/** The test pattern that is really on at server time `serverNowMs`: expired patterns count as off. */
export function activeTestPattern(setup: Pick<Setup, 'testPattern' | 'testPatternUntil'> | null | undefined, serverNowMs: number): TestPattern {
  if (!setup || setup.testPattern === 'off') return 'off'
  const until = setup.testPatternUntil
  if (until && until / 1e6 <= serverNowMs) return 'off'
  return setup.testPattern
}

/** Whole seconds left before the test pattern turns off, or null when it is off or has no deadline. */
export function testPatternSecondsLeft(setup: Pick<Setup, 'testPattern' | 'testPatternUntil'> | null | undefined, serverNowMs: number): number | null {
  if (!setup || setup.testPattern === 'off' || !setup.testPatternUntil) return null
  return Math.max(0, Math.ceil((setup.testPatternUntil / 1e6 - serverNowMs) / 1000))
}

/** The authored scene size: portrait setups author at height × width. */
export function sceneSize(o: Pick<SetupOutput, 'width' | 'height' | 'orientation'>): { width: number; height: number } {
  return o.orientation === 'landscape' ? { width: o.width, height: o.height } : { width: o.height, height: o.width }
}
