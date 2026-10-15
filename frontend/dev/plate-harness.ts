/**
 * Draws a metal gobo plate (not part of the app): /dev/plate-harness.html?plate=<id>&w=384&h=216&view=metal|mask
 * (&params=<json> for a parametric window's geometry).
 * `metal` is the plate itself, a grey disc with its cut-outs (the catalog's metal thumbnails); `mask` the openings
 * white on black, clipped to the round field. Sets window.__done when drawn.
 */
import { plateDef, plateSvg } from '../src/render/plates'

const q = new URLSearchParams(location.search)
const w = Number(q.get('w') ?? 384), h = Number(q.get('h') ?? 216)
const def = plateDef(q.get('plate') ?? '')
const canvas = document.getElementById('c') as HTMLCanvasElement
canvas.width = w
canvas.height = h
const ctx = canvas.getContext('2d')!
if (def) {
  const params = q.get('params') ? JSON.parse(q.get('params')!) : {}
  const svg = plateSvg(def, q.get('view') === 'mask' ? 'mask' : 'metal', 'rgb(245,244,240)', params)
  const img = new Image()
  img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  await img.decode()
  const d = Math.min(w, h) * Number(q.get('size') ?? 0.96)
  ctx.drawImage(img, (w - d) / 2, (h - d) / 2, d, d)
}
;(window as unknown as Record<string, unknown>).__done = true
