import { describe, expect, it } from 'vitest'
import sceneFx from '../../../contract/fixtures/scene.json'
import { defaultIntro, type Scene } from '../entities/scene/types'
import { introFade, isIntroStep } from './engine'

const scene = (over: Partial<NonNullable<Scene['intro']>> = {}): Scene => ({ ...(sceneFx as unknown as Scene), mode: 'objects', intro: { ...defaultIntro('live'), ...over } })

describe('step 0 (§20)', () => {
  it('draws the opening look only while the step is intro, in objects mode', () => {
    expect(isIntroStep({ scene: scene(), step: 'intro' })).toBe(true)
    expect(isIntroStep({ scene: scene(), step: 'timeline' })).toBe(false)
    expect(isIntroStep({ scene: scene({ on: false }), step: 'intro' })).toBe(false)
    expect(isIntroStep({ scene: { ...scene(), mode: 'static' }, step: 'intro' })).toBe(false)
  })

  it('crossfades into the mapping without converge, and skips the converge at 0', () => {
    const sc = scene({ converge: false, transition: 'fade', transitionMs: 600 })
    expect(introFade({ scene: sc, step: 'intro', t: 0 }).look).toBeNull()
    const a = introFade({ scene: sc, step: 'timeline', t: 0 })
    expect(a.look).toBe('live')
    expect(a.alpha).toBe(0)
    expect(introFade({ scene: sc, step: 'timeline', t: 0.3 }).alpha).toBeCloseTo(0.5)
    const done = introFade({ scene: sc, step: 'timeline', t: 0.6 })
    expect(done.look).toBeNull()
    expect(done.skipStartConverge).toBe(true)
    // a cut has no fade; with converge the converge clip does the move
    expect(introFade({ scene: scene({ converge: false, transition: 'cut' }), step: 'timeline', t: 0 }).look).toBeNull()
    expect(introFade({ scene: scene(), step: 'timeline', t: 0 })).toEqual({ look: null, alpha: 1, skipStartConverge: false })
  })
})
