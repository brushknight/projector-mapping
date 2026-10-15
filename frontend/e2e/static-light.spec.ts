import { expect as base, test, type APIRequestContext } from '@playwright/test'
import { API, resetMock } from './lib'

// §15: the static light, its attachments, the frame slide and motion, edited live from the Show space
const expect = base.configure({ timeout: 30_000 })
test.setTimeout(120_000)
test.beforeEach(async ({ request }) => resetMock(request))

type Att = { id: string; gobo: string; params: Record<string, number>; motion: null | { preset: string; on: boolean; startedAt: number; to: { x: number } } }
async function stat(request: APIRequestContext) {
  const sc = await (await request.get(`${API}/api/v1/scenes/scn_desk`)).json()
  return sc.backdrop.static as { light: { focus: number; slide: { x: number }; motion: unknown }; attachments: Att[] }
}

test('attachments: browse by category, pick one, add one on top', async ({ page, request }) => {
  await page.goto('/editor/show')
  await page.getByTestId('mode-tab-static').click()
  await expect(page.getByTestId('attachment-grid')).toBeVisible()
  // real thumbnails from the server
  const ok = await page.evaluate(async () => (await fetch('/catalog/thumbs/window-4.png')).ok)
  expect(ok).toBe(true)
  await page.getByTestId('att-cat-blinds').click()
  await expect(page.getByTestId('gobo-tree')).toHaveCount(0)
  await page.getByTestId('gobo-blinds').click()
  await expect.poll(async () => (await stat(request)).attachments.map((a) => a.gobo)).toEqual(['blinds'])
  await page.getByTestId('att-cat-nature').click()
  await page.getByTestId('gobo-tree').hover()
  await page.getByTestId('gobo-add-tree').click()
  await expect.poll(async () => (await stat(request)).attachments.map((a) => a.gobo)).toEqual(['blinds', 'tree'])
  await expect(page.getByTestId('on-air-label')).toContainText('venetian blinds + leaves')
})

test('plates: the metal plate or its light, pick one, fill the frame', async ({ page, request }) => {
  await page.goto('/editor/show')
  await page.getByTestId('mode-tab-static').click()
  await page.getByTestId('att-cat-plates').click()
  await expect(page.getByTestId('gobo-window-4')).toHaveCount(0)
  const sun = page.getByTestId('gobo-plate-sunburst')
  await expect(sun).toBeVisible()
  const bg = () => sun.locator('span').first().evaluate((el) => (el as HTMLElement).style.background)
  // tiles show the plate itself until you ask for its light
  expect(await bg()).toContain('plate-sunburst-metal.png')
  expect(await page.evaluate(async () => (await fetch('/catalog/assets/thumbs/plate-sunburst-metal.png')).ok)).toBe(true)
  await page.getByRole('group', { name: 'plate tiles show' }).getByRole('button', { name: 'its light' }).click()
  await expect.poll(bg).toContain('thumbs/plate-sunburst.png')
  await sun.click()
  await expect.poll(async () => (await stat(request)).attachments.map((a) => a.gobo)).toEqual(['plate-sunburst'])
  // the round field by default; fill frame covers 16:9
  const card = page.getByTestId('attachment-card')
  await card.getByRole('button', { name: 'fill frame' }).click()
  await expect.poll(async () => (await stat(request)).attachments[0].params.field as unknown).toBe('fill')
})

test('framing shutters: drag a blade into the beam', async ({ page, request }) => {
  await page.goto('/editor/show')
  await page.getByTestId('mode-tab-static').click()
  await page.getByTestId('att-cat-spots').click()
  await page.getByTestId('gobo-shutter').click()
  await expect(page.getByTestId('shutter-blades')).toBeVisible()
  await page.getByTestId('shutter-blades').scrollIntoViewIfNeeded()
  const svg = await page.getByTestId('shutter-blades').boundingBox()
  // press on the top blade near the top of the picture, then drag it down towards the centre
  await page.mouse.move(svg!.x + svg!.width / 2, svg!.y + 10)
  await page.mouse.down()
  await page.mouse.move(svg!.x + svg!.width / 2, svg!.y + svg!.height * 0.42, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await stat(request)).attachments[0].params.top ?? 0).toBeGreaterThan(0.4)
})

test('motion: a preset chip, the path editor, play and pause', async ({ page, request }) => {
  await page.goto('/editor/show')
  await page.getByTestId('mode-tab-static').click()
  await page.getByTestId('motion-card').scrollIntoViewIfNeeded()
  await page.getByTestId('motion-preset-sun-rl').click()
  await expect.poll(async () => (await stat(request)).attachments[0].motion?.preset).toBe('sun-rl')
  const m = (await stat(request)).attachments[0].motion!
  expect(m.on).toBe(true)
  expect(m.startedAt).toBeGreaterThan(0)
  // drag the end point: the path becomes custom
  await page.getByTestId('path-editor').scrollIntoViewIfNeeded()
  const to = await page.getByTestId('path-to').boundingBox()
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2)
  await page.mouse.down()
  await page.mouse.move(to!.x + 30, to!.y + to!.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => (await stat(request)).attachments[0].motion?.preset).toBe('')
  await page.getByTestId('motion-play').click()
  await expect.poll(async () => (await stat(request)).attachments[0].motion?.on).toBe(false)
})

test('frame slide: drag the preview sideways, reset centres it', async ({ page, request }) => {
  await page.goto('/editor/show')
  await page.getByTestId('mode-tab-static').click()
  const hero = await page.getByTestId('hero-slide').boundingBox()
  await page.mouse.move(hero!.x + hero!.width * 0.5, hero!.y + hero!.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(hero!.x + hero!.width * 0.75, hero!.y + hero!.height * 0.52, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => (await stat(request)).light.slide.x).toBeGreaterThan(0.15)
  await page.getByTestId('slide-reset').click()
  await expect.poll(async () => (await stat(request)).light.slide.x).toBe(0)
})
