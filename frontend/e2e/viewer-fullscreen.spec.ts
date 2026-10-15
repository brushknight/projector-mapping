import { expect, test, type Page } from '@playwright/test'
import { API, resetMock } from './lib'

// §17: /view and /out go full screen on the first click, double-click and F toggle it, Esc leaves, and the cursor and
// the viewer's bar hide after 2 s at rest. Headless Chromium has no real full screen, so the Fullscreen API is mocked.
test.beforeEach(async ({ request, page }) => {
  await resetMock(request)
  await page.addInitScript(() => {
    let el: Element | null = null
    const w = window as unknown as { __fsCalls: string[]; __hint: string }
    w.__fsCalls = []
    w.__hint = ''
    // the hint lasts 3 s; a busy software-GL page may take longer than that to be checked, so remember it
    new MutationObserver(() => {
      const h = document.querySelector('[data-testid="fullscreen-hint"]')
      if (h && !w.__hint) w.__hint = h.textContent ?? ''
    }).observe(document, { childList: true, subtree: true })
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => el })
    const change = () => document.dispatchEvent(new Event('fullscreenchange'))
    Element.prototype.requestFullscreen = function () {
      w.__fsCalls.push('enter')
      el = this as Element
      setTimeout(change, 0)
      return Promise.resolve()
    }
    document.exitFullscreen = () => {
      w.__fsCalls.push('exit')
      el = null
      setTimeout(change, 0)
      return Promise.resolve()
    }
  })
})

const isFull = (page: Page) => page.evaluate(() => !!document.fullscreenElement)
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __fsCalls: string[] }).__fsCalls)

test('the viewer: hint, first click, double-click, F and Esc', async ({ page }) => {
  await page.goto('/view')
  await expect(page.getByTestId('viewer')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __hint: string }).__hint)).toMatch(/click for full screen/)
  // the first click anywhere goes full screen and the hint goes away
  await page.mouse.click(400, 300)
  await expect.poll(() => isFull(page)).toBe(true)
  await expect(page.getByTestId('fullscreen-hint')).toHaveCount(0)
  // F toggles, Esc leaves
  await page.keyboard.press('f')
  await expect.poll(() => isFull(page)).toBe(false)
  await page.keyboard.press('F')
  await expect.poll(() => isFull(page)).toBe(true)
  await page.keyboard.press('Escape')
  await expect.poll(() => isFull(page)).toBe(false)
  // a double-click toggles too (the first-click rule is spent)
  await page.mouse.dblclick(400, 300)
  await expect.poll(() => isFull(page)).toBe(true)
  await page.mouse.dblclick(400, 300)
  await expect.poll(() => isFull(page)).toBe(false)
  expect(await calls(page)).toEqual(['enter', 'exit', 'enter', 'exit', 'enter', 'exit'])
})

test('a double-click right away keeps the full screen the first click opened', async ({ page }) => {
  await page.goto('/view')
  await expect(page.getByTestId('viewer')).toBeVisible()
  await page.mouse.dblclick(400, 300)
  await expect.poll(() => isFull(page)).toBe(true)
  await page.waitForTimeout(300)
  expect(await isFull(page)).toBe(true)
})

test('the bar and the cursor hide after 2 s at rest, and the hint after 3 s', async ({ page }) => {
  await page.goto('/view')
  await expect(page.getByTestId('viewer-bar')).toHaveAttribute('data-visible', 'true')
  await expect(page.getByTestId('viewer-bar')).toHaveAttribute('data-visible', 'false', { timeout: 4000 })
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-idle', 'true')
  await expect(page.getByTestId('fullscreen-hint')).toHaveCount(0, { timeout: 4000 })
  await page.mouse.move(200, 200)
  await page.mouse.move(220, 210)
  await expect(page.getByTestId('viewer-bar')).toHaveAttribute('data-visible', 'true')
})

test('headless hides the hint on /view and /out; /out goes full screen with the sound click', async ({ page }) => {
  await page.goto('/view?headless=1')
  await expect(page.getByTestId('viewer')).toBeVisible()
  await page.waitForTimeout(300)
  await expect(page.getByTestId('fullscreen-hint')).toHaveCount(0)
  await page.goto('/out?headless=1')
  await expect(page.getByTestId('out')).toBeVisible()
  await page.keyboard.press('f')
  await expect.poll(() => isFull(page)).toBe(true)
  await page.keyboard.press('Escape')
  await expect.poll(() => isFull(page)).toBe(false)
  await page.goto('/out')
  await expect(page.getByTestId('out')).toBeVisible()
  // on the projector the hint is a small corner note, not an overlay
  await expect.poll(() => page.evaluate(() => (window as unknown as { __hint: string }).__hint)).toBe('click for full screen')
  await page.mouse.click(500, 400)
  await expect.poll(() => isFull(page)).toBe(true)
})

test('put on projector: pick a display in the Show preview', async ({ page, request }) => {
  await page.goto('/editor/show')
  await page.getByTestId('show-put-on-projector').click()
  await page.getByTestId('put-on-display-2').click()
  await expect(page.getByText(/Opened the output on EPSON PJ/)).toBeVisible()
  const st = await (await request.get(`${API}/__mock/state`)).json()
  expect(st.launches).toEqual([{ display: 2, route: 'out' }])
})
