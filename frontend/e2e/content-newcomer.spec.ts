import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { API, mockLog, resetMock } from './lib'

const PICTURE = fileURLToPath(new URL('./fixtures/green-64x48.png', import.meta.url))
const TOUR_KEY = 'projmap.tour.content.v1'

test.beforeEach(async ({ request }) => {
  await resetMock(request)
  // a newcomer's right face: nothing on it yet
  const { version } = await (await request.get(`${API}/api/v1/scenes/scn_desk`)).json()
  const r = await request.post(`${API}/api/v1/scenes/scn_desk/patch`, { data: { base: version, ops: [{ op: 'remove', path: '/objects/0/surfaces/2/layers' }] } })
  expect(r.ok()).toBe(true)
})

type Pt = { x: number; y: number }

/** The right face's corners in scene px, from the server. */
async function rightFace(request: Parameters<typeof resetMock>[0]): Promise<Pt[]> {
  const sc = (await (await request.get(`${API}/api/v1/scenes/scn_desk`)).json()) as { points: Array<Pt & { id: string }>; objects: Array<{ surfaces: Array<{ id: string; pointIds: string[] }> }> }
  const face = sc.objects.flatMap((o) => o.surfaces).find((x) => x.id === 'srf_right')!
  return face.pointIds.map((id) => sc.points.find((p) => p.id === id)!)
}

/** How many sampled pixels inside the face's polygon on the stage picture are clearly green, and how many were sampled. */
async function greenInFace(page: Page, face: Pt[]): Promise<{ green: number; n: number }> {
  return page.evaluate(
    ({ face }) => {
      const src = document.querySelector('[data-testid="pip-canvas"]') as HTMLCanvasElement
      const c = document.createElement('canvas')
      c.width = src.width
      c.height = src.height
      const ctx = c.getContext('2d')!
      ctx.drawImage(src, 0, 0)
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      // the stage picture is the whole 1920×1080 output, scaled
      const k = c.width / 1920
      const poly = face.map((p) => ({ x: p.x * k, y: p.y * k }))
      const inside = (x: number, y: number) => {
        let ins = false
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const a = poly[i], b = poly[j]
          if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) ins = !ins
        }
        return ins
      }
      let green = 0, n = 0
      for (let y = 0; y < c.height; y++)
        for (let x = 0; x < c.width; x++) {
          if (!inside(x + 0.5, y + 0.5)) continue
          n++
          const i = (y * c.width + x) * 4
          if (d[i + 1] > 120 && d[i + 1] - Math.max(d[i], d[i + 2]) > 60) green++
        }
      return { green, n }
    },
    { face },
  )
}

test('a newcomer opens content, picks the right face and adds a picture that shows on the stage', async ({ page, request }) => {
  // the editor lands on Show; Content is reached on purpose from the top bar
  await page.goto('/editor')
  await expect(page.getByRole('button', { name: 'show', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'content', exact: true }).click()
  await expect(page.getByTestId('editor')).toHaveAttribute('data-space', 'content')
  await expect(page.getByTestId('content-title')).toHaveText('zimacube · all faces')

  // the one-time tour: 4 steps, pointing at the title, the mini map, the actions and the stage picture
  const card = page.getByTestId('tour-card')
  await expect(card).toBeVisible()
  for (const [i, title] of ['This is content', 'Where you are', 'Add something', 'See it on the object'].entries()) {
    await expect(card).toHaveAttribute('data-step', String(i))
    await expect(card).toContainText(title)
    await page.getByTestId('tour-next').click()
  }
  await expect(page.getByTestId('tour')).toHaveCount(0)
  expect(await page.evaluate((k) => localStorage.getItem(k), TOUR_KEY)).toBe('seen')

  // pick the right face on the "where am I" map
  await expect(page.getByTestId('minimap')).toBeVisible()
  await page.getByTestId('minimap-face-srf_right').dispatchEvent('click')
  await expect(page.getByTestId('face-title')).toHaveText('zimacube · right face')
  await expect(page.getByTestId('minimap-face-srf_right')).toHaveAttribute('data-current', 'true')
  const crumbs = page.getByRole('navigation', { name: 'where you are' })
  await expect(crumbs).toContainText('zimacube')
  await expect(crumbs).toContainText('right')

  // the empty face offers three big actions
  const empty = page.getByTestId('content-empty')
  await expect(empty).toBeVisible()
  await expect(empty.getByRole('button', { name: /add picture/ })).toBeVisible()
  await expect(empty.getByRole('button', { name: /draw/ })).toBeVisible()
  await expect(empty.getByRole('button', { name: /add effect/ })).toBeVisible()

  // the stage picture before: no green on the right face
  const face = await rightFace(request)
  await expect(page.getByTestId('pip-canvas')).toBeVisible()
  await page.waitForTimeout(800)
  const before = await greenInFace(page, face)
  expect(before.n).toBeGreaterThan(200)
  expect(before.green).toBeLessThan(before.n * 0.05)

  // add picture → the file picker → a media layer on the face
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('empty-add-picture').click()])
  await chooser.setFiles(PICTURE)
  await expect
    .poll(async () => (await mockLog(request, 'patch')).some((m) => JSON.stringify(m.d).includes('"kind":"media"') && JSON.stringify(m.d).includes('/objects/0/surfaces/2/layers')))
    .toBe(true)
  await expect(page.getByTestId('content-empty')).toHaveCount(0)
  const sc = await (await request.get(`${API}/api/v1/scenes/scn_desk`)).json()
  expect(sc.objects[0].surfaces[2].layers).toEqual([expect.objectContaining({ kind: 'media', media: 'image', src: expect.stringMatching(/^asset:/) })])

  // the stage picture now shows green inside the right face
  await expect.poll(async () => (await greenInFace(page, face)).green, { timeout: 15_000 }).toBeGreaterThan(before.n * 0.4)

  // the breadcrumb climbs back to all faces
  await crumbs.getByRole('button', { name: 'zimacube' }).click()
  await expect(page.getByTestId('content-title')).toHaveText('zimacube · all faces')
})

test('the tour stays dismissed and the ? button replays it', async ({ page }) => {
  await page.goto('/editor/content')
  await expect(page.getByTestId('tour-card')).toBeVisible()
  await page.getByTestId('tour-skip').click()
  await expect(page.getByTestId('tour')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('content-title')).toBeVisible()
  await page.waitForTimeout(500)
  await expect(page.getByTestId('tour')).toHaveCount(0)
  await page.getByTestId('content-help').click()
  await expect(page.getByTestId('tour-card')).toHaveAttribute('data-step', '0')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('tour')).toHaveCount(0)
})

test('draw on an empty face arms the pen; rarely used controls live under more', async ({ page }) => {
  await page.goto('/editor/content')
  await page.getByTestId('tour-skip').click()
  await page.getByTestId('minimap-face-srf_right').dispatchEvent('click')
  await page.getByTestId('empty-draw').click()
  await expect(page.getByTestId('face-tool-pen')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('draw-options')).toBeVisible()
  await expect(page.getByTestId('content-empty')).toHaveCount(0)
  // more holds the face size, face stepping and clear
  await page.getByTestId('content-more').click()
  await expect(page.getByRole('menuitem', { name: 'next face (])' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'back to all faces (esc)' }).click()
  await expect(page.getByTestId('content-title')).toHaveText('zimacube · all faces')
  // in the unfold, more holds the layout and the templates
  await page.getByTestId('template-menu').click()
  await expect(page.getByRole('menuitem', { name: 'arrange the faces by dragging' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'save the template as PNG' })).toBeVisible()
})

test('the top bar opens the viewer window', async ({ page }) => {
  await page.goto('/editor/content')
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByTestId('open-viewer').click()])
  expect(popup.url()).toMatch(/\/view(\?|$)/)
  await popup.close()
})
