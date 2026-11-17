// Minimal decoder for 16-bit greyscale PNGs (the DEM heightfields). Pure: uses only DecompressionStream,
// which exists in browsers, Workers and Node >= 18. Supports colour type 0, bit depth 16, no interlace.

export interface Png16 {
  width: number
  height: number
  /** Row-major samples, row 0 first. */
  data: Uint16Array
}

const be32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0

async function inflate(zlib: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([zlib as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function decodePng16(bytes: Uint8Array): Promise<Png16> {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10]
  if (!sig.every((v, i) => bytes[i] === v)) throw new Error('not a PNG')
  let o = 8
  let width = 0
  let height = 0
  const idat: Uint8Array[] = []
  while (o < bytes.length) {
    const len = be32(bytes, o)
    const type = String.fromCharCode(...bytes.subarray(o + 4, o + 8))
    const body = bytes.subarray(o + 8, o + 8 + len)
    if (type === 'IHDR') {
      width = be32(body, 0)
      height = be32(body, 4)
      const depth = body[8]
      const colour = body[9]
      const interlace = body[12]
      if (depth !== 16 || colour !== 0 || interlace !== 0) throw new Error(`unsupported PNG (depth ${depth}, colour ${colour}, interlace ${interlace})`)
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    o += 12 + len
  }
  const total = idat.reduce((a, c) => a + c.length, 0)
  const z = new Uint8Array(total)
  let p = 0
  for (const c of idat) {
    z.set(c, p)
    p += c.length
  }
  const raw = await inflate(z)
  const bpp = 2
  const stride = width * bpp
  const out = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const cur = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0
      const b = prev ? prev[i] : 0
      const c = prev && i >= bpp ? prev[i - bpp] : 0
      let v = src[i]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const pp = a + b - c
        const pa = Math.abs(pp - a)
        const pb = Math.abs(pp - b)
        const pc = Math.abs(pp - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      } else if (f !== 0) throw new Error(`bad PNG filter ${f}`)
      cur[i] = v & 255
    }
  }
  const data = new Uint16Array(width * height)
  for (let i = 0; i < data.length; i++) data[i] = (out[2 * i] << 8) | out[2 * i + 1]
  return { width, height, data }
}
