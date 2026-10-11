import { expect, test } from '@playwright/test'
import { mockLog, mockState, resetMock } from './lib'

test.beforeEach(async ({ request }) => resetMock(request))

test('the editor loads the fixture scene from the server', async ({ page }) => {
  await page.goto('/editor')
  await expect(page.getByTestId('scene-picker')).toContainText('desk')
  await expect(page.getByTestId('tree-object-obj_cube')).toContainText('zimacube')
  await expect(page.getByTestId('tree-surface-srf_top')).toBeVisible()
  await expect(page.getByTestId('setup-chip')).toContainText('1920×1080')
  await expect(page.getByTestId('clip-clp_grid')).toContainText('grid build')
  await expect(page.locator('[data-point="p_r"]')).toBeVisible()
})

test('dragging a point sends params and the server commits a patch', async ({ page, request }) => {
  await page.goto('/editor')
  const handle = page.locator('[data-point="p_r"] rect').first()
  await expect(handle).toBeVisible()
  const before = (await mockState(request)).scenes.find((s) => s.id === 'scn_desk')!.version
  const box = (await handle.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + i * 5, y + i * 2)
  await page.mouse.up()

  // params for /points/1 (p_r) went out while dragging
  await expect.poll(async () => (await mockLog(request, 'param')).filter((m) => String((m.d as { path: string }).path).startsWith('/points/1/')).length).toBeGreaterThan(2)
  // 200 ms after the last param the server commits a versioned patch
  await expect.poll(async () => (await mockState(request)).scenes.find((s) => s.id === 'scn_desk')!.version).toBeGreaterThan(before)
  // the inspector shows the moved point
  await expect(page.getByLabel('P3 x')).not.toHaveValue('1230')
})

test('drawing a triangle sends a structural patch with a new surface', async ({ page, request }) => {
  await page.goto('/editor')
  await expect(page.getByTestId('stage-overlay')).toBeVisible()
  await page.keyboard.press('t')
  const box = (await page.getByTestId('stage-overlay').boundingBox())!
  const at = (fx: number, fy: number) => page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
  await at(0.1, 0.8)
  await at(0.2, 0.65)
  await at(0.3, 0.8)
  await expect
    .poll(async () => (await mockLog(request, 'patch')).some((m) => JSON.stringify(m.d).includes('"kind":"tri"')))
    .toBe(true)
  await expect(page.getByTestId('surface-inspector')).toContainText('tri 1')
})

test('backstage edits go to a draft, not the live scene', async ({ page, request }) => {
  await page.goto('/editor')
  await page.getByRole('button', { name: 'backstage' }).click()
  await expect(page.getByText(/draft · 0 changes/)).toBeVisible()
  const before = (await mockState(request)).scenes.find((s) => s.id === 'scn_desk')!.version
  await page.getByTestId('tree-surface-srf_top').click()
  await page.getByLabel('P1 x').fill('700')
  await page.getByLabel('P1 x').press('Enter')
  await expect(page.getByText(/draft · 1 change/)).toBeVisible()
  const log = [...(await mockLog(request, 'patch')), ...(await mockLog(request, 'param'))]
  expect((await mockState(request)).scenes.find((s) => s.id === 'scn_desk')!.version, JSON.stringify(log)).toBe(before)
  await page.getByRole('button', { name: 'apply to live' }).click()
  await expect.poll(async () => (await mockState(request)).scenes.find((s) => s.id === 'scn_desk')!.version).toBeGreaterThan(before)
})

test('the agent panel starts a session and shows its proposal', async ({ page }) => {
  await page.goto('/editor')
  await page.getByRole('button', { name: 'agent', exact: true }).click()
  await page.getByPlaceholder('ask codex…').fill('nudge the right face')
  await page.getByPlaceholder('ask codex…').press('Enter')
  await expect(page.getByTestId('agent-panel')).toContainText('nudge the right face')
  await expect(page.getByTestId('agent-panel')).toContainText('scene_get')
  await expect(page.getByTestId('proposal')).toBeVisible({ timeout: 15_000 })
})

test('the style guide renders every shared component', async ({ page }) => {
  await page.goto('/components')
  for (const n of ['Pill', 'Segmented', 'Tools', 'FillSlider', 'Switch', 'TreeNode', 'LibTile', 'QrCode', 'StepBar', 'Icon']) await expect(page.locator(`[id="${n}"]`)).toBeVisible()
})
