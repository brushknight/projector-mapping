import { useCallback, useState } from 'react'
import { rememberTour, Tour, tourSeen, type TourStep } from '../../../../shared/components'
import { CONTENT_TOUR_KEY } from './model'

export const CONTENT_TOUR: TourStep[] = [
  {
    target: '[data-tour="content-title"]',
    title: 'This is content',
    text: 'Content is what the faces of an object show: pictures, drawings and effects. Map places the faces on the object; Show runs the wall. The title says what you edit.',
  },
  {
    target: '[data-tour="content-minimap"]',
    title: 'Where you are',
    text: 'This map shows the object as it sits on the stage. The bright face is the one you edit. Click any face to go there; the path at the top takes you back to all faces.',
  },
  {
    target: '[data-tour="content-actions"]',
    title: 'Add something',
    text: 'Add a picture, draw, or add an effect. An empty face offers all three in the middle. Rarely needed controls wait under more.',
  },
  {
    target: '[data-tour="content-pip"]',
    title: 'See it on the object',
    text: 'The stage picture shows your content warped onto the object, live. The ? button plays this tour again.',
  },
]

// seen in this page too, so a browser that cannot store it does not show the tour on every visit
let seenHere = false
const seen = () => seenHere || tourSeen(CONTENT_TOUR_KEY)

/** The content tour: opens once on the first visit (remembered in localStorage when allowed), `replay` shows it again. */
export function useContentTour(autoStart: boolean) {
  const [step, setStep] = useState<number | null>(() => (autoStart && !seen() ? 0 : null))
  const close = useCallback(() => {
    seenHere = true
    rememberTour(CONTENT_TOUR_KEY)
    setStep(null)
  }, [])
  const replay = useCallback(() => setStep(0), [])
  const start = useCallback(() => setStep((s) => (s === null && !seen() ? 0 : s)), [])
  const el = step === null ? null : <Tour steps={CONTENT_TOUR} step={step} onStep={setStep} onClose={close} label="content tour" />
  return { el, replay, start, open: step !== null }
}
