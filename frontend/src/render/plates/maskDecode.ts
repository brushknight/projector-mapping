/**
 * (§16 plate masks) Decodes the pre-rendered plate mask PNGs: 8-bit greyscale, not interlaced (what
 * `npm run masks` writes). Pure (DecompressionStream for the zlib stream, then the PNG row filters), so it runs in the
 * mask worker, on the main thread as a fallback, and in unit tests.
 */
export interface MaskData {
  /** width and height in px (masks are square) */
  size: number
  /** one byte per pixel, row 0 at the top: 255 where light passes */
  data: Uint8Array
}

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

async function inflate(chunks: Uint8Array[]): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate')
  const writer = ds.writable.getWriter()
  for (const c of chunks) void writer.write(c as Uint8Array<ArrayBuffer>)
  void writer.close()
  const buf = await new Response(ds.readable).arrayBuffer()
  return new Uint8Array(buf)
}

/** Decodes a greyscale 8-bit PNG into one byte per pixel. Throws on anything else. */
export async function decodeGrayPng(bytes: Uint8Array): Promise<MaskData> {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIG[i]) throw new Error('not a PNG')
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let p = 8
  let w = 0, h = 0
  const idat: Uint8Array[] = []
  while (p + 8 <= bytes.length) {
    const len = dv.getUint32(p)
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7])
    const body = bytes.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') {
      w = dv.getUint32(p + 8)
      h = dv.getUint32(p + 12)
      if (body[8] !== 8 || body[9] !== 0 || body[12] !== 0) throw new Error('mask PNG must be 8-bit greyscale, not interlaced')
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    p += 12 + len
  }
  if (!w || !h || w !== h) throw new Error('mask PNG must be square')
  const raw = await inflate(idat)
  if (raw.length < (w + 1) * h) throw new Error('mask PNG is short')
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (w + 1)]
    const src = y * (w + 1) + 1
    const o = y * w
    const up = o - w
    switch (f) {
      case 0:
        out.set(raw.subarray(src, src + w), o)
        break
      case 1:
        out[o] = raw[src]
        for (let x = 1; x < w; x++) out[o + x] = (raw[src + x] + out[o + x - 1]) & 0xff
        break
      case 2:
        if (y === 0) out.set(raw.subarray(src, src + w), o)
        else for (let x = 0; x < w; x++) out[o + x] = (raw[src + x] + out[up + x]) & 0xff
        break
      case 3:
        for (let x = 0; x < w; x++) {
          const a = x ? out[o + x - 1] : 0
          const b = y ? out[up + x] : 0
          out[o + x] = (raw[src + x] + ((a + b) >> 1)) & 0xff
        }
        break
      case 4:
        for (let x = 0; x < w; x++) {
          const a = x ? out[o + x - 1] : 0
          const b = y ? out[up + x] : 0
          const c = x && y ? out[up + x - 1] : 0
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
          out[o + x] = (raw[src + x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
        }
        break
      default:
        throw new Error(`bad PNG filter ${f}`)
    }
  }
  return { size: w, data: out }
}
