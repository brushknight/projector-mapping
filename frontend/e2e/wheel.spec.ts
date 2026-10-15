import { expect, test, type Locator, type Page } from '@playwright/test'

// The mouse wheel only scrolls the page: after a drag, no slider, number box or scrubber changes on a wheel scroll,
// even with the pointer still on it (shared/lib/pointer.ts).

const glow = (page: Page) => page.locator('[id="FillSlider"]').getByRole('slider', { name: 'glow' })
const valueOf = async (l: Locator) => Number(await l.getAttribute('aria-valuenow'))
/** the slider's top on screen: it moves up when the page scrolls */
const topOf = async (l: Locator) => (await l.boundingBox())!.y

test('a slider ignores the wheel after a drag, and the page scrolls', async ({ page }) => {
  await page.goto('/components')
  const sl = glow(page)
  await sl.scrollIntoViewIfNeeded()
  const box = (await sl.boundingBox())!
  // drag it to about a quarter
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2, { steps: 5 })
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  const v = await valueOf(sl)
  expect(v).toBeGreaterThan(0.15)
  expect(v).toBeLessThan(0.35)
  // the press left no focus on it
  expect(await sl.evaluate((el) => el === document.activeElement)).toBe(false)

  // wheel over it, both ways and sideways: the value stays, the page scrolls
  const y0 = await topOf(sl)
  await page.mouse.wheel(0, 240)
  await page.mouse.wheel(0, -120)
  await page.mouse.wheel(160, 0)
  await page.waitForTimeout(250)
  expect(await valueOf(sl)).toBe(v)
  expect(await topOf(sl)).not.toBe(y0)
  // and with the pointer still where the slider now is
  const b2 = (await sl.boundingBox())!
  await page.mouse.move(b2.x + b2.width * 0.9, b2.y + b2.height / 2)
  await page.mouse.wheel(0, 200)
  await page.waitForTimeout(250)
  expect(await valueOf(sl)).toBe(v)
})

test('a move without a button never drags, even after a missed release', async ({ page }) => {
  await page.goto('/components')
  const sl = glow(page)
  await sl.scrollIntoViewIfNeeded()
  const box = (await sl.boundingBox())!
  const v = await valueOf(sl)
  // a press whose release never reaches the slider, then the moves Chrome sends while the wheel scrolls the page
  await sl.dispatchEvent('pointerdown', { pointerId: 7, button: 0, buttons: 1, clientX: box.x + 10, clientY: box.y + 5, isPrimary: true, pointerType: 'mouse' })
  for (const f of [0.5, 0.7, 0.95]) {
    await sl.dispatchEvent('pointermove', { pointerId: 7, buttons: 0, clientX: box.x + box.width * f, clientY: box.y + 5, isPrimary: true, pointerType: 'mouse' })
  }
  expect(await valueOf(sl)).toBe(v)
})

test('Tab focus keeps the arrows working', async ({ page }) => {
  await page.goto('/components')
  const sl = glow(page)
  await sl.focus()
  const v = await valueOf(sl)
  await page.keyboard.press('ArrowRight')
  expect(await valueOf(sl)).toBeGreaterThan(v)
})

test('a number box ignores the wheel', async ({ page }) => {
  await page.goto('/components')
  const box = page.getByRole('textbox', { name: 'x', exact: true })
  await box.scrollIntoViewIfNeeded()
  const before = await box.inputValue()
  await box.click()
  await page.mouse.wheel(0, 200)
  await page.mouse.wheel(0, -200)
  await page.waitForTimeout(200)
  expect(await box.inputValue()).toBe(before)
})
