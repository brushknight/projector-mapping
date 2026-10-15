import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import catalog from '../../../../contract/catalog.json'
import { decodeGrayPng } from './maskDecode'
import { MASK_INDEX } from './maskIndex'
import { hasMask, maskUrl, MASK_TIERS } from './masks'

/** A greyscale PNG with the given row filters (the decoder must undo each). */
function png(px: Uint8Array, size: number, filter: (y: number) => number): Uint8Array {
  const raw = Buffer.alloc((size + 1) * size)
  for (let y = 0; y < size; y++) {
    const f = filter(y)
    raw[y * (size + 1)] = f
    for (let x = 0; x < size; x++) {
      const v = px[y * size + x]
      const a = x ? px[y * size + x - 1] : 0
      const b = y ? px[(y - 1) * size + x] : 0
      const c = x && y ? px[(y - 1) * size + x - 1] : 0
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      raw[y * (size + 1) + 1 + x] = (v - pred) & 0xff
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    return Buffer.concat([len, Buffer.from(type), data, Buffer.alloc(4)])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}

describe('plate masks (§16 masks)', () => {
  it('decodes greyscale PNGs with every row filter', async () => {
    const size = 37
    const px = new Uint8Array(size * size).map((_, i) => (i * 97 + (i >> 3) * 13) & 0xff)
    const m = await decodeGrayPng(png(px, size, (y) => y % 5))
    expect(m.size).toBe(size)
    expect([...m.data]).toEqual([...px])
  })

  it('refuses what is not a square greyscale PNG', async () => {
    await expect(decodeGrayPng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toThrow()
  })

  it('has every catalog plate at every size, and the files decode', async () => {
    for (const g of catalog.gobos) for (const t of MASK_TIERS) expect(hasMask(g.id, t), `${g.id} at ${t}`).toBe(true)
    expect(Object.keys(MASK_INDEX).sort()).toEqual(catalog.gobos.map((g) => g.id).sort())
    expect(maskUrl('plate-sunburst', 1024)).toBe(`/catalog/assets/masks/plate-sunburst-1024.png?v=${MASK_INDEX['plate-sunburst'].v}`)
    expect(maskUrl('nope', 1024)).toBeNull()
    const file = resolve(__dirname, '../../../../backend/internal/catalog/assets/masks/plate-grid-window-1024.png')
    const m = await decodeGrayPng(new Uint8Array(readFileSync(file)))
    expect(m.size).toBe(1024)
    // the window's centre is a pane (light), the corner is metal
    expect(m.data[0]).toBe(0)
    const lit = m.data.reduce((n, v) => n + (v > 127 ? 1 : 0), 0) / m.data.length
    expect(lit).toBeGreaterThan(0.1)
    expect(lit).toBeLessThan(0.6)
  })
})
