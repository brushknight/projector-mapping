/**
 * Rasterizes one plate's mask with the vector path (not part of the app; `npm run masks` drives it):
 * /dev/mask-harness.html?plate=<id>&size=4096. Sets window.__mask (base64 of the red channel, size × size bytes, row 0
 * at the top) and window.__done.
 */
import { plateCanvas, plateDef } from '../src/render/plates'

const q = new URLSearchParams(location.search)
const size = Number(q.get('size') ?? 4096)
const def = plateDef(q.get('plate') ?? '')
const w = window as unknown as Record<string, unknown>
if (def) {
  const cv = plateCanvas(def, size) as OffscreenCanvas
  const data = (cv.getContext('2d') as OffscreenCanvasRenderingContext2D).getImageData(0, 0, size, size).data
  const red = new Uint8Array(size * size)
  for (let i = 0; i < red.length; i++) red[i] = data[i * 4]
  let s = ''
  for (let i = 0; i < red.length; i += 0x8000) s += String.fromCharCode(...red.subarray(i, i + 0x8000))
  w.__mask = btoa(s)
}
w.__done = true
