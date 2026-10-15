/**
 * Drag hygiene for every pointer-driven control (sliders, scrubbers, path handles, the hero slide).
 *
 * Chrome sends a synthetic pointermove (buttons 0) to whatever sits under a still pointer when the page scrolls with
 * the wheel. A control that kept a drag open after a missed pointerup (released outside it, capture lost) would then
 * move with the wheel. So a move only drags while a button is down, and a drag ends on lost capture too.
 */
export const pressed = (e: { buttons: number }) => e.buttons !== 0

/**
 * Drops keyboard focus a pointer press gave a control, so a wheel or arrow key after the drag never adjusts it.
 * Focus from Tab stays (arrows still work then).
 */
export function releaseFocus(el: Element | null) {
  if (el instanceof HTMLElement && document.activeElement === el) el.blur()
}
