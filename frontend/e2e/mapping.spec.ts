import { expect, test } from '@playwright/test'
import { API, litSamples, mockLog, resetMock } from './lib'

test.beforeEach(async ({ request }) => resetMock(request))

test('an empty scene coaches face creation and + face arms the quad tool', async ({ page, request }) => {
  const sc = (await (await request.post(`${API}/api/v1/scenes`, { data: { name: 'empty', setupId: 'set_desk' } })).json()) as { id: string }
  await page.goto(`/editor/map?scene=${sc.id}`)
  await expect(page.getByTestId('coach')).toBeVisible()
  await expect(page.getByTestId('coach')).toContainText('click the 4 corners')
  await page.getByTestId('add-face').click()
  await expect(page.getByRole('button', { name: 'quad (Q)' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('coach')).toContainText('quad: click the 4 corners')

  // four clicks make a quad, select it and show its corners
  const box = (await page.getByTestId('stage-overlay').boundingBox())!
  const at = (fx: number, fy: number) => page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
  await at(0.3, 0.3)
  await expect(page.getByTestId('coach')).toBeHidden()
  await at(0.6, 0.3)
  await at(0.6, 0.6)
  await at(0.3, 0.6)
  await expect.poll(async () => (await mockLog(request, 'patch')).some((m) => JSON.stringify(m.d).includes('"kind":"quad"'))).toBe(true)
  await expect(page.getByTestId('surface-inspector')).toContainText('quad 1')
  for (const n of [1, 2, 3, 4]) await expect(page.getByLabel(`P${n} x`)).toBeVisible()
})

test('the stage previews objects mode and offers to put objects on air', async ({ page }) => {
  await page.goto('/editor/map')
  await expect(page.getByTestId('wall-chip')).toContainText('wall shows static')
  await page.getByTestId('objects-on-air').click()
  await expect(page.getByTestId('wall-chip')).toContainText('objects on air')
})

test('the flat view shows a surface unwarped and a drawn rect appends a stroke', async ({ page, request }) => {
  await page.goto('/editor/map')
  await page.getByTestId('tree-surface-srf_left').click()
  await page.getByTestId('inspector-flat').click()
  await expect(page.getByTestId('flat-view')).toContainText('zimacube / left')
  const canvas = page.getByTestId('flat-canvas')
  await expect(canvas).toBeVisible()
  // the fixture's drawing (a rect border, a squiggle and "hello") renders flat
  await expect.poll(async () => (await litSamples(page, '[data-testid="flat-canvas"]', 7)).lit).toBeGreaterThan(5)

  await page.getByRole('button', { name: 'rect', exact: true }).click()
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

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('flat-view')).toBeHidden()
})

test('unfold lists the faces of an object flat', async ({ page }) => {
  await page.goto('/editor/map')
  await page.getByTestId('tree-object-obj_cube').click()
  await page.getByTestId('open-unfold').click()
  await expect(page.getByTestId('unfold')).toBeVisible()
  for (const id of ['srf_top', 'srf_left', 'srf_right', 'srf_fan']) await expect(page.getByTestId(`unfold-${id}`)).toBeVisible()
  await expect(page.getByTestId('unfold-srf_edges')).toHaveCount(0)
  await page.getByTestId('unfold-srf_left').click()
  await expect(page.getByTestId('flat-canvas')).toBeVisible()
})
