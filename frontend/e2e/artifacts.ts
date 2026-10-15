/**
 * Pixel checks for the light's output (shared by the e2e specs): runs in the page against a canvas.
 */

/**
 * Isolated dark pixels inside lit areas: a pixel far darker than the lit level whose ring of 8 neighbours `gap` px
 * away is all lit. A thin metal line is not isolated (its neighbours along the line are dark); a speck is.
 */
export function countSpecks(data: Uint8ClampedArray, w: number, h: number, gap = 2): { specks: number; at: Array<[number, number]>; lit: number } {
  const L = new Float32Array(w * h)
  let max = 0
  for (let i = 0; i < w * h; i++) {
    L[i] = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]
    if (L[i] > max) max = L[i]
  }
  const litLevel = max * 0.85, dark = max * 0.45
  let specks = 0, lit = 0
  const at: Array<[number, number]> = []
  for (let y = gap; y < h - gap; y++) {
    for (let x = gap; x < w - gap; x++) {
      const v = L[y * w + x]
      if (v >= litLevel) lit++
      if (v > dark) continue
      let ring = true
      for (let dy = -gap; dy <= gap && ring; dy += gap) for (let dx = -gap; dx <= gap; dx += gap) {
        if (!dx && !dy) continue
        if (L[(y + dy) * w + x + dx] < litLevel) { ring = false; break }
      }
      if (ring) {
        specks++
        if (at.length < 20) at.push([x, y])
      }
    }
  }
  return { specks, at, lit }
}
