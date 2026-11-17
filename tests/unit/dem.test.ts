// Copernicus DEM terrain: PNG16 decoding, frame and datum (cross-checked against worker-2's georef.json),
// sea handling and the rectilinear LOD grid.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import hilltopMeta from '../../measurements/hilltop.json'
import landscapeMeta from '../../measurements/landscape.json'
import georef from '../../measurements/georef.json'
import sanctuary from '../../src/data/sanctuary.json'
import plan from '../../measurements/sanctuary-plan.json'
import { decodePng16 } from '../../src/geometry/sanctuary/png16'
import { DEM_GRID, SEABED_DEPTH, demGrid, demGround, loadDem, nestedAxis, type DemMeta } from '../../src/geometry/sanctuary/dem'
import { sampleHeight } from '../../src/geometry/sanctuary/terrain'
import { TIERS } from '../../src/geometry/types'

const root = resolve(__dirname, '../..')
const png = (f: string) => new Uint8Array(readFileSync(resolve(root, 'measurements', f)))

/** Encode a 16-bit greyscale PNG with a given filter on every row (test fixture). */
function encodePng16(w: number, h: number, data: Uint16Array, filter: number): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff
    for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length)
    const dv = new DataView(out.buffer)
    dv.setUint32(0, body.length)
    out.set([...type].map((ch) => ch.charCodeAt(0)), 4)
    out.set(body, 8)
    dv.setUint32(8 + body.length, crc(out.subarray(4, 8 + body.length)))
    return out
  }
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, w)
  dv.setUint32(4, h)
  ihdr.set([16, 0, 0, 0, 0], 8)
  const stride = w * 2
  const raw = new Uint8Array(h * (stride + 1))
  const bytes = new Uint8Array(h * stride)
  data.forEach((v, i) => {
    bytes[2 * i] = v >> 8
    bytes[2 * i + 1] = v & 255
  })
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = filter
    for (let i = 0; i < stride; i++) {
      const x = bytes[y * stride + i]
      const a = i >= 2 ? bytes[y * stride + i - 2] : 0
      const b = y > 0 ? bytes[(y - 1) * stride + i] : 0
      const c = y > 0 && i >= 2 ? bytes[(y - 1) * stride + i - 2] : 0
      let p = 0
      if (filter === 1) p = a
      else if (filter === 2) p = b
      else if (filter === 3) p = (a + b) >> 1
      else if (filter === 4) {
        const q = a + b - c
        const pa = Math.abs(q - a)
        const pb = Math.abs(q - b)
        const pc = Math.abs(q - c)
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      raw[y * (stride + 1) + 1 + i] = (x - p) & 255
    }
  }
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array(0))]
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

describe('PNG16 decoder', () => {
  it.each([0, 1, 2, 3, 4])('round-trips filter %i', async (filter) => {
    const w = 7
    const h = 5
    const data = new Uint16Array(w * h).map((_, i) => (i * 4099 + 17) % 65536)
    const img = await decodePng16(encodePng16(w, h, data, filter))
    expect([img.width, img.height]).toEqual([w, h])
    expect([...img.data]).toEqual([...data])
  })

  it('rejects non-16-bit images', async () => {
    const bad = encodePng16(2, 2, new Uint16Array(4), 0)
    bad[24] = 8 // bit depth byte in IHDR
    await expect(decodePng16(bad)).rejects.toThrow()
  })
})

describe('real Copernicus DEM in the temple frame', async () => {
  const dem = await loadDem(hilltopMeta as unknown as DemMeta, png('hilltop.png'), landscapeMeta as unknown as DemMeta, png('landscape.png'))

  it('decodes to the documented range, sea level and attribution', () => {
    const hmin = Math.min(...dem.hilltop.heights)
    const hmax = Math.max(...dem.hilltop.heights)
    expect(hmin).toBeCloseTo(hilltopMeta.zMin, 2)
    expect(hmax).toBeCloseTo(hilltopMeta.zMax, 2)
    expect(dem.seaLevelY).toBe(landscapeMeta.seaLevelY)
    expect(dem.attribution).toBe(georef.attribution)
  })

  it('agrees with georef.json: DEM minus the terrace level along the plan walls', () => {
    // Independent check of decoding, orientation and cell-centre convention against worker-2's numbers.
    const level = georef.terraceVsDem.terraceY
    const walls = Object.fromEntries(plan.walls.map((w) => [w.id, w.centreline as [number, number][]]))
    for (const [id, stats] of Object.entries(georef.terraceVsDem.byWall)) {
      const line = walls[id]
      const samples: number[] = []
      for (let k = 0; k + 1 < line.length; k++)
        for (let t = 0; t <= 1; t += 0.02) {
          const x = line[k][0] + (line[k + 1][0] - line[k][0]) * t
          const z = line[k][1] + (line[k + 1][1] - line[k][1]) * t
          samples.push(sampleHeight(dem.hilltop, x, z) - level)
        }
      const mean = samples.reduce((a, v) => a + v, 0) / samples.length
      // worker-2 sampled the full DEM bicubically; here the 2 m grid is sampled bilinearly, hence 0.5 m.
      expect(Math.abs(mean - stats.mean), id).toBeLessThan(0.5)
    }
  })

  it('the ancient terrace level is within the stated tolerance of the DEM at the temple', () => {
    const g = demGround(dem)
    expect(Math.abs(g(0, 0) - sanctuary.terrain.terraces['temple-terrace'].level.value)).toBeLessThan(georef.uncertainty.stylobateElevationM + 1)
  })

  it('sea cells sit on a seabed below the sea plane (never coplanar with it)', () => {
    const g = demGround(dem)
    let seaCells = 0
    for (let x = -2900; x <= 2900; x += 100)
      for (let z = -2900; z <= 2900; z += 100) {
        const y = g(x, z)
        if (y < dem.seaLevelY) {
          seaCells++
          expect(y).toBeCloseTo(dem.seaLevelY - SEABED_DEPTH, 6)
        } else expect(y).toBeGreaterThan(dem.seaLevelY + 0.5)
      }
    expect(seaCells / (59 * 59)).toBeGreaterThan(0.2) // about a third of the window is sea
  })

  it.each(TIERS)('LOD grid (%s): fine over the hilltop window, coarse to the landscape edge, monotonic', (tier) => {
    const { xs } = demGrid(dem, tier)
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1])
    const steps = [...xs].slice(1).map((v, i) => v - xs[i])
    expect(Math.min(...steps)).toBeLessThanOrEqual(DEM_GRID[tier].inner + 1e-9)
    expect(Math.max(...steps)).toBeLessThanOrEqual(DEM_GRID[tier].outer + 1e-9)
    expect(xs[0]).toBeLessThan(-2900)
  })
})

describe('nested axis', () => {
  it('covers both ranges with the requested spacings', () => {
    const a = nestedAxis(10, 100, 2, 30)
    expect(a[0]).toBeCloseTo(-100, 9)
    expect(a[a.length - 1]).toBeCloseTo(100, 9)
    expect([...a]).toContain(-10)
    expect([...a]).toContain(10)
  })
})
