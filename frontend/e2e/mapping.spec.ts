import { expect, test } from '@playwright/test'
import { API, litSamples, mockLog, resetMock } from './lib'

test.beforeEach(async ({ request }) => resetMock(request))

test('an empty scene shows the 4-step rail and + face arms the quad tool', async ({ page, request }) => {
  const sc = (await (await request.post(`${API}/api/v1/scenes`, { data: { name: 'empty', setupId: 'set_desk' } })).json()) as { id: string }
  await page.goto(`/editor/map?scene=${sc.id}`)
  await expect(page.getByTestId('rail')).toBeVisible()
  await expect(page.getByTestId('rail-faces')).toHaveAttribute('data-done', 'false')
  await page.getByTestId('add-face').click()
  await expect(page.getByRole('button', { name: 'quad (Q)' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('coach')).toContainText('quad: click the 4 corners')

  // four clicks make a quad, select it, show its corners and light step 2
  const box = (await page.getByTestId('stage-overlay').boundingBox())!
  const at = (fx: number, fy: number) => page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
  await at(0.3, 0.3)
  await at(0.6, 0.3)
  await at(0.6, 0.6)
  await at(0.3, 0.6)
  await expect.poll(async () => (await mockLog(request, 'patch')).some((m) => JSON.stringify(m.d).includes('"kind":"quad"'))).toBe(true)
  await expect(page.getByTestId('surface-inspector')).toContainText('quad 1')
  for (const n of [1, 2, 3, 4]) await expect(page.getByLabel(`P${n} x`)).toBeVisible()
  await expect(page.getByTestId('rail-faces')).toHaveAttribute('data-done', 'true')
})

test('the stage previews objects mode and offers to put objects on air', async ({ page }) => {
  await page.goto('/editor/map')
  await expect(page.getByTestId('wall-chip')).toContainText('wall shows static')
  await page.getByTestId('objects-on-air').click()
  await expect(page.getByTestId('wall-chip')).toContainText('objects on air')
})

test('tab switches between map and content and keeps the selection', async ({ page }) => {
  await page.goto('/editor/map')
  await page.getByTestId('tree-surface-srf_right').click()
  await expect(page.getByTestId('editor')).toHaveAttribute('data-space', 'map')
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('editor')).toHaveAttribute('data-space', 'content')
  await expect(page.getByTestId('content-view')).toBeVisible()
  await expect(page).toHaveURL(/\/editor\/content/)
  // the editor stayed mounted: the face is still selected
  await expect(page.getByTestId('surface-inspector')).toContainText('zimacube / right')
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('editor')).toHaveAttribute('data-space', 'map')
  await expect(page.getByTestId('stage-overlay')).toBeVisible()
})

test('the content space unfolds the cube: top above left, right beside left, sharing edges', async ({ page }) => {
  await page.goto('/editor/content')
  await expect(page.getByTestId('atlas-size')).toContainText('618×609')
  // the shapes' own geometry (Playwright's boundingBox adds the stroke)
  const r = (id: string) => page.getByTestId(`atlas-face-${id}`).evaluate((el) => {
    const b = el.getBoundingClientRect()
    return { x: b.x, y: b.y, width: b.width, height: b.height }
  })
  const top = await r('srf_top')
  const left = await r('srf_left')
  const right = await r('srf_right')
  const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(2)
  // top sits on left's top edge, at the same x and width
  near(top.y + top.height, left.y)
  near(top.x, left.x)
  near(top.width, left.width)
  // right sits against left's right edge, at the same y and height
  near(left.x + left.width, right.x)
  near(left.y, right.y)
  near(left.height, right.height)
  // details sit inside their parent face
  const bay = await r('srf_bay0')
  expect(bay.x).toBeGreaterThan(right.x)
  expect(bay.x + bay.width).toBeLessThan(right.x + right.width + 1)
  // the unfold renders the faces' content live, and the stage shows in a corner
  await expect.poll(async () => (await litSamples(page, '[data-testid="atlas-canvas"]', 7)).lit).toBeGreaterThan(50)
  await expect(page.getByTestId('pip')).toBeVisible()
  await expect.poll(async () => (await litSamples(page, '[data-testid="pip-canvas"]', 7)).lit).toBeGreaterThan(5)
})

test('edit face opens the face alone; drawing a rect appends a stroke; esc goes back to the unfold', async ({ page, request }) => {
  await page.goto('/editor/map')
  await page.getByTestId('tree-surface-srf_left').click()
  await page.getByTestId('inspector-edit-face').click()
  await expect(page.getByTestId('editor')).toHaveAttribute('data-space', 'content')
  await expect(page.getByTestId('face-title')).toContainText('zimacube / left')
  // the fixture's drawing (a rect border, a squiggle and "hello") renders flat
  await expect.poll(async () => (await litSamples(page, '[data-testid="face-canvas"]', 7)).lit).toBeGreaterThan(5)

  await page.keyboard.press('3') // rect
  const ink = (await page.getByTestId('flat-ink').boundingBox())!
  await page.mouse.move(ink.x + ink.width * 0.3, ink.y + ink.height * 0.3)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) await page.mouse.move(ink.x + ink.width * (0.3 + i * 0.05), ink.y + ink.height * (0.3 + i * 0.05))
  await page.mouse.up()
  await expect
    .poll(async () =>
      (await mockLog(request, 'patch')).some((m) => {
        const ops = m.d as Array<{ op: string; path: string; value?: { tool?: string } }>
        return Array.isArray(ops) && ops.some((o) => o.op === 'add' && /\/effects\/0\/params\/strokes\/-$/.test(o.path) && o.value?.tool === 'rect')
      }),
    )
    .toBe(true)

  // ] goes to the next face, esc back to the unfold
  await page.keyboard.press(']')
  await expect(page.getByTestId('face-title')).toContainText('zimacube / right')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('atlas')).toBeVisible()
})
