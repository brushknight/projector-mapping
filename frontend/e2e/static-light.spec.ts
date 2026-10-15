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
  const ok = await page.evaluate(async () => (await fetch('/catalog/thumbs/plate-grid-window.png')).ok)
  expect(ok).toBe(true)
  // (catalog 6) every attachment is a plate, in windows, nature, sky, patterns and beams
  await page.getByTestId('att-cat-windows').click()
  await expect(page.getByTestId('gobo-plate-hearts')).toHaveCount(0)
  // (§16) a tap tries it in the hero first; the wall keeps what it had until "put it on"
  const before = (await stat(request)).attachments.map((a) => a.gobo)
  await page.getByTestId('gobo-plate-blinds').click()
  await expect(page.getByTestId('static-try-bar')).toContainText('trying blinds')
  expect((await stat(request)).attachments.map((a) => a.gobo)).toEqual(before)
  await page.getByTestId('static-try-use').click()
  await expect(page.getByTestId('static-try-bar')).toHaveCount(0)
  await expect.poll(async () => (await stat(request)).attachments.map((a) => a.gobo)).toEqual(['plate-blinds'])
  await page.getByTestId('att-cat-nature').click()
  await page.getByTestId('gobo-plate-tree-with-leaves').hover()
  await page.getByTestId('gobo-add-plate-tree-with-leaves').click()
  await expect(page.getByTestId('static-stack')).toContainText('tree with leaves')
  await expect.poll(async () => (await stat(request)).attachments.map((a) => a.gobo)).toEqual(['plate-blinds', 'plate-tree-with-leaves'])
  await expect(page.getByTestId('on-air-label')).toContainText('blinds + tree with leaves')
})

test('plates: tiles show the light, pick one, fill the frame', async ({ page, request }) => {
  await page.goto('/editor/show')
  await page.getByTestId('mode-tab-static').click()
  await page.getByTestId('att-cat-beams').click()
  await expect(page.getByTestId('gobo-plate-blinds')).toHaveCount(0)
  const sun = page.getByTestId('gobo-plate-sunburst')
  await expect(sun).toBeVisible()
  const bg = () => sun.locator('span').first().evaluate((el) => (el as HTMLElement).style.background)
  // (§16 masks) tiles show the light each plate projects; there is no metal view any more
  expect(await bg()).toContain('thumbs/plate-sunburst.png')
  await expect(page.getByRole('group', { name: 'plate tiles show' })).toHaveCount(0)
  // (§16 masks) its pre-rendered masks are served as catalog files
  expect(await page.evaluate(async () => (await fetch('/catalog/assets/masks/plate-sunburst-1024.png')).ok)).toBe(true)
  await sun.click()
  await page.getByTestId('static-try-use').click()
  await expect.poll(async () => (await stat(request)).attachments.map((a) => a.gobo)).toEqual(['plate-sunburst'])
  // the round field by default; fill frame covers 16:9
  const card = page.getByTestId('attachment-card')
  await card.getByRole('button', { name: 'fill frame' }).click()
  await expect.poll(async () => (await stat(request)).attachments[0].params.field as unknown).toBe('fill')
})

test('a window preset: change its geometry, then reset it to the preset', async ({ page, request }) => {
  await page.goto('/editor/show')
  await page.getByTestId('mode-tab-static').click()
  await page.getByTestId('att-cat-windows').click()
  await page.getByTestId('gobo-plate-palace-window').click()
  await page.getByTestId('static-try-use').click()
  await expect.poll(async () => (await stat(request)).attachments.map((a) => a.gobo)).toEqual(['plate-palace-window'])
  // a new window carries no geometry: it takes the preset
  expect((await stat(request)).attachments[0].params.rows).toBeUndefined()
  const geo = page.getByTestId('window-geometry')
  await expect(geo).toBeVisible()
  await expect(page.getByTestId('window-reset')).toBeDisabled()
  await page.getByTestId('window-group-arch').click()
  await geo.getByRole('switch', { name: 'arch' }).click()
  await expect.poll(async () => (await stat(request)).attachments[0].params.arch as unknown).toBe(false)
  // the arch's own params wait for the arch
  await expect(geo.getByText('arch spokes')).toHaveCount(0)
  await page.getByTestId('window-reset').click()
  await expect.poll(async () => (await stat(request)).attachments[0].params.arch as unknown).toBeUndefined()
})

test('motion: a preset chip, the path editor, play and pause', async ({ page, request }) => {
  await page.goto('/editor/show')
  await page.getByTestId('mode-tab-static').click()
  await expect(async () => page.getByTestId('motion-card').evaluate((el) => el.scrollIntoView())).toPass()
  await page.getByTestId('motion-preset-sun-rl').click()
  await expect.poll(async () => (await stat(request)).attachments[0].motion?.preset).toBe('sun-rl')
  const m = (await stat(request)).attachments[0].motion!
  expect(m.on).toBe(true)
  expect(m.startedAt).toBeGreaterThan(0)
  // drag the end point: the path becomes custom
  await expect(async () => page.getByTestId('path-editor').evaluate((el) => el.scrollIntoView({ block: 'center' }))).toPass()
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

test('(§16) the stack: both focus rings, a background layer under the attachments, settings that persist', async ({ page, request }) => {
  await page.goto('/editor/show')
  await page.getByTestId('mode-tab-static').click()
  const stack = page.getByTestId('static-stack')
  await expect(stack).toContainText('attachments on top')
  await expect(stack).toContainText('background layers')
  await expect(page.getByTestId('light-static')).not.toContainText('dust and haze')
  // the attachment focus
  const slider = stack.getByRole('slider', { name: 'attachment focus' })
  await slider.focus()
  await page.keyboard.press('Home')
  await expect.poll(async () => (await stat(request)).light.focus).toBe(0)
  // a background: try an animated colour, then add it under the attachments
  await page.getByRole('button', { name: 'background ↓' }).click()
  await page.getByTestId('bg-tile-generator:hue-cycle').click()
  await expect(page.getByTestId('static-try-bar')).toContainText('trying hue cycle')
  await page.getByTestId('static-try-add').click()
  await expect.poll(async () => ((await (await request.get(`${API}/api/v1/scenes/scn_desk`)).json()).backdrop.static.layers as Array<{ ref: string }>).map((l) => l.ref)).toEqual(['hue-cycle'])
  await expect(stack).toContainText('hue cycle')
  // picking another attachment keeps the focus and the place of the old one
  const old = (await stat(request)).attachments[0] as Att & { rotation: number; scale: number }
  await page.getByRole('button', { name: 'attachments ↑' }).click()
  await page.getByTestId('att-cat-patterns').click()
  await page.getByTestId('gobo-plate-hearts').click()
  await page.getByTestId('static-try-use').click()
  await expect.poll(async () => (await stat(request)).attachments.map((a) => a.gobo)).toEqual(['plate-hearts'])
  const now = (await stat(request)).attachments[0] as Att & { rotation: number; scale: number }
  expect([now.id, now.rotation, now.scale]).toEqual([old.id, old.rotation, old.scale])
  expect((await stat(request)).light.focus).toBe(0)
})

// fixme: the frame hook never sees the new slide in headless Chromium; the unit test in shared/lib/ws.test.ts covers
// the local apply and the 60 Hz throttle until this is fixed
test.fixme('(§16) a slider drag reaches the preview renderer on the next frame', async ({ page }) => {
  await page.goto('/editor/show')
  await page.getByTestId('mode-tab-static').click()
  const slider = page.getByTestId('frame-slide').getByRole('slider')
  await expect(slider).toBeVisible()
  const box = (await slider.boundingBox())!
  // count the preview's frames; note the frame count at the input and at the first frame that drew the new slide
  await page.evaluate(() => {
    type C = HTMLCanvasElement & { __scene?: { backdrop: { static: { light: { slide: { x: number } } } } }; __frames?: number }
    const w = window as unknown as { __in?: { frame: number; t: number }; __out?: { frame: number; t: number } }
    const canvas = () => document.querySelector('[data-testid=live-preview-canvas]') as C | null
    const loop = () => {
      const c = canvas()
      if (c?.__scene && w.__in && !w.__out && Math.abs(c.__scene.backdrop.static.light.slide.x) > 0.05) w.__out = { frame: c.__frames ?? 0, t: performance.now() }
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  })
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  // the input: the frame count and time just before the move goes in
  await page.evaluate(() => {
    const c = document.querySelector('[data-testid=live-preview-canvas]') as HTMLCanvasElement & { __frames?: number }
    ;(window as unknown as { __in: { frame: number; t: number } }).__in = { frame: c.__frames ?? 0, t: performance.now() }
  })
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height / 2)
  await expect.poll(() => page.evaluate(() => (window as unknown as { __out?: unknown }).__out ?? null)).not.toBeNull()
  const r = await page.evaluate(() => {
    const w = window as unknown as { __in: { frame: number; t: number }; __out: { frame: number; t: number } }
    return { frames: w.__out.frame - w.__in.frame, ms: w.__out.t - w.__in.t }
  })
  await page.mouse.up()
  console.log(`slide input to preview frame: ${r.frames} frame(s), ${Math.round(r.ms)} ms`)
  // within a couple of preview frames of the input (the CDP round trip of the move itself counts too): no server
  // round trip, no waiting for an echo
  expect(r.frames).toBeLessThanOrEqual(3)
})
