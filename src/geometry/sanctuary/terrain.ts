// Terrain from a heightfield (Float32 grid, NaN = no data): LOD mesh per tier, exact cut-outs for feature
// footprints (convex polygons), a bilinear height sampler for placement and walking, and a compact
// 16-bit binary encoding for committing the scan-derived grid. Pure (no `three`).
import type { Point2 } from '../../data/sanctuary'
import type { Collector, MeshBuilder, Vec3 } from '../mesh'
import { norm } from '../mesh'
import type { GeneratorOutput, Heightfield, Tier } from '../types'

export const TERRAIN_STRIDE: Record<Tier, number> = { low: 4, med: 2, high: 1 }

const at = (hf: Heightfield, ix: number, iz: number) => hf.heights[iz * hf.nx + ix]

/** Bilinear height at (x, z); NaN corners are skipped (NaN only if all four are missing or outside). */
export function sampleHeight(hf: Heightfield, x: number, z: number): number {
  const fx = (x - hf.originX) / hf.cell
  const fz = (z - hf.originZ) / hf.cell
  if (fx < 0 || fz < 0 || fx > hf.nx - 1 || fz > hf.nz - 1) return NaN
  const ix = Math.min(Math.floor(fx), hf.nx - 2)
  const iz = Math.min(Math.floor(fz), hf.nz - 2)
  const tx = fx - ix
  const tz = fz - iz
  const c: [number, number][] = [
    [at(hf, ix, iz), (1 - tx) * (1 - tz)],
    [at(hf, ix + 1, iz), tx * (1 - tz)],
    [at(hf, ix, iz + 1), (1 - tx) * tz],
    [at(hf, ix + 1, iz + 1), tx * tz],
  ]
  let s = 0
  let w = 0
  for (const [h, k] of c)
    if (Number.isFinite(h)) {
      s += h * k
      w += k
    }
  if (w > 1e-12) return s / w
  const valid = c.filter(([h]) => Number.isFinite(h))
  return valid.length ? valid.reduce((a, [h]) => a + h, 0) / valid.length : NaN
}

export function normalAt(hf: Heightfield, x: number, z: number): Vec3 {
  const d = hf.cell
  const hx0 = sampleHeight(hf, x - d, z)
  const hx1 = sampleHeight(hf, x + d, z)
  const hz0 = sampleHeight(hf, x, z - d)
  const hz1 = sampleHeight(hf, x, z + d)
  const h = sampleHeight(hf, x, z)
  const gx = (Number.isFinite(hx1) ? hx1 : h) - (Number.isFinite(hx0) ? hx0 : h)
  const gz = (Number.isFinite(hz1) ? hz1 : h) - (Number.isFinite(hz0) ? hz0 : h)
  const n = norm([-gx / (2 * d), 1, -gz / (2 * d)])
  return Number.isFinite(n[0]) && Number.isFinite(n[2]) ? n : [0, 1, 0]
}

// ---- convex clipping ---------------------------------------------------------------------------

function clipHalf(poly: Point2[], a: Point2, b: Point2, keepLeft: boolean): Point2[] {
  const side = (p: Point2) => {
    const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
    return keepLeft ? c : -c
  }
  const out: Point2[] = []
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    const sp = side(p)
    const sq = side(q)
    if (sp >= 0) out.push(p)
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq)
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])])
    }
  }
  return out
}

const area2 = (p: Point2[]) => {
  let s = 0
  for (let i = 0; i < p.length; i++) s += p[i][0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * p[i][1]
  return s / 2
}

/** Convex pieces of convex polygon `piece` lying outside convex polygon `hole`. */
export function subtractConvex(piece: Point2[], hole: Point2[]): Point2[][] {
  const h = area2(hole) < 0 ? [...hole].reverse() : hole // counter-clockwise in (x, z): inside is on the left
  const out: Point2[][] = []
  let rest = piece
  for (let i = 0; i < h.length && rest.length >= 3; i++) {
    const a = h[i]
    const b = h[(i + 1) % h.length]
    const outside = clipHalf(rest, a, b, false)
    if (outside.length >= 3 && Math.abs(area2(outside)) > 1e-10) out.push(outside)
    rest = clipHalf(rest, a, b, true)
  }
  return out
}

const bboxOf = (p: Point2[]) => ({
  minX: Math.min(...p.map((v) => v[0])),
  maxX: Math.max(...p.map((v) => v[0])),
  minZ: Math.min(...p.map((v) => v[1])),
  maxZ: Math.max(...p.map((v) => v[1])),
})

/** Terrain mesh into the collector's 'terrain' group, minus the exclusion footprints. */
export function terrain(hf: Heightfield, tier: Tier, col: Collector, exclude: Point2[][] = []): Omit<GeneratorOutput, 'groups'> {
  const stride = TERRAIN_STRIDE[tier]
  const idx = (n: number) => {
    const r: number[] = []
    for (let i = 0; i < n - 1; i += stride) r.push(i)
    r.push(n - 1)
    return r
  }
  const xs = idx(hf.nx)
  const zs = idx(hf.nz)
  const b = col.get('terrain')
  const v0 = b.vertexCount
  const i0 = b.idx.length
  const holes = exclude.map((p) => ({ p, bb: bboxOf(p) }))
  const vmap = new Map<number, number>()
  const P = (ix: number, iz: number): Vec3 => [hf.originX + ix * hf.cell, at(hf, ix, iz), hf.originZ + iz * hf.cell]
  const vert = (ix: number, iz: number) => {
    const key = iz * hf.nx + ix
    let v = vmap.get(key)
    if (v === undefined) {
      const p = P(ix, iz)
      v = b.vertex(p, normalAt(hf, p[0], p[2]), [p[0], p[2]])
      vmap.set(key, v)
    }
    return v
  }
  let minY = Infinity
  for (let a = 0; a < zs.length - 1; a++)
    for (let c = 0; c < xs.length - 1; c++) {
      const g = [
        [xs[c], zs[a]],
        [xs[c], zs[a + 1]],
        [xs[c + 1], zs[a + 1]],
        [xs[c + 1], zs[a]],
      ] as const
      if (g.some(([i, k]) => !Number.isFinite(at(hf, i, k)))) continue
      // Two up-facing triangles: (00, 01, 11) and (00, 11, 10).
      for (const tri of [
        [g[0], g[1], g[2]],
        [g[0], g[2], g[3]],
      ]) {
        const pts = tri.map(([i, k]) => P(i, k))
        for (const p of pts) minY = Math.min(minY, p[1])
        const flat: Point2[] = pts.map((p) => [p[0], p[2]])
        const tb = bboxOf(flat)
        const hits = holes.filter((h) => h.bb.minX < tb.maxX && h.bb.maxX > tb.minX && h.bb.minZ < tb.maxZ && h.bb.maxZ > tb.minZ)
        if (!hits.length) {
          b.tri(vert(tri[0][0], tri[0][1]), vert(tri[1][0], tri[1][1]), vert(tri[2][0], tri[2][1]))
          continue
        }
        let pieces: Point2[][] = [flat]
        for (const h of hits) pieces = pieces.flatMap((pc) => subtractConvex(pc, h.p))
        // Heights on the original triangle's plane.
        const [p0, p1, p2] = pts
        const det = (p1[0] - p0[0]) * (p2[2] - p0[2]) - (p2[0] - p0[0]) * (p1[2] - p0[2])
        const hAt = (x: number, z: number) => {
          const u = ((x - p0[0]) * (p2[2] - p0[2]) - (p2[0] - p0[0]) * (z - p0[2])) / det
          const v = ((p1[0] - p0[0]) * (z - p0[2]) - (x - p0[0]) * (p1[2] - p0[2])) / det
          return p0[1] + u * (p1[1] - p0[1]) + v * (p2[1] - p0[1])
        }
        for (const pc of pieces) {
          const base = b.vertexCount
          const v3 = pc.map(([x, z]): Vec3 => [x, hAt(x, z), z])
          for (const p of v3) b.vertex(p, normalAt(hf, p[0], p[2]), [p[0], p[2]])
          // Fan the convex piece; drop clipping slivers and keep every triangle up-facing.
          for (let i = 1; i + 1 < pc.length; i++) {
            const [a, c, d] = [v3[0], v3[i], v3[i + 1]]
            const cy = (c[2] - a[2]) * (d[0] - a[0]) - (c[0] - a[0]) * (d[2] - a[2])
            if (Math.abs(cy) < 1e-8) continue
            if (cy > 0) b.tri(base, base + i, base + i + 1)
            else b.tri(base, base + i + 1, base + i)
          }
        }
      }
    }
  faceNormals(b, v0, i0)
  const x0 = hf.originX
  const z0 = hf.originZ
  return {
    instances: [],
    colliders: [],
    levels: [{ name: 'terrain', y: minY, minX: x0, maxX: x0 + (hf.nx - 1) * hf.cell, minZ: z0, maxZ: z0 + (hf.nz - 1) * hf.cell, heightfield: hf }],
  }
}

/**
 * Vertex normals from the mesh itself (area-weighted face normals) for vertices added since v0: finite
 * differences of the field disagree with the triangles on steep folds and at cut edges.
 */
function faceNormals(b: MeshBuilder, v0: number, i0: number) {
  const acc = new Float64Array((b.vertexCount - v0) * 3)
  const P = b.pos
  for (let i = i0; i < b.idx.length; i += 3) {
    const [a, c, d] = [b.idx[i], b.idx[i + 1], b.idx[i + 2]]
    const e1 = [P[3 * c] - P[3 * a], P[3 * c + 1] - P[3 * a + 1], P[3 * c + 2] - P[3 * a + 2]]
    const e2 = [P[3 * d] - P[3 * a], P[3 * d + 1] - P[3 * a + 1], P[3 * d + 2] - P[3 * a + 2]]
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
    for (const k of [a, c, d]) if (k >= v0) for (let j = 0; j < 3; j++) acc[3 * (k - v0) + j] += n[j]
  }
  for (let k = 0; k < acc.length / 3; k++) {
    const l = Math.hypot(acc[3 * k], acc[3 * k + 1], acc[3 * k + 2])
    if (l > 0) for (let j = 0; j < 3; j++) b.nor[3 * (v0 + k) + j] = acc[3 * k + j] / l
  }
  // On folds sharper than 90 degrees an averaged normal can face away from a triangle: give those triangles
  // their own flat-shaded vertices.
  const end = b.idx.length
  for (let i = i0; i < end; i += 3) {
    const tri = [b.idx[i], b.idx[i + 1], b.idx[i + 2]]
    const e1 = [0, 1, 2].map((j) => P[3 * tri[1] + j] - P[3 * tri[0] + j])
    const e2 = [0, 1, 2].map((j) => P[3 * tri[2] + j] - P[3 * tri[0] + j])
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
    if (tri.every((k) => n[0] * b.nor[3 * k] + n[1] * b.nor[3 * k + 1] + n[2] * b.nor[3 * k + 2] > 0)) continue
    const l = Math.hypot(n[0], n[1], n[2])
    tri.forEach((k, j) => {
      b.idx[i + j] = b.vertex([P[3 * k], P[3 * k + 1], P[3 * k + 2]], [n[0] / l, n[1] / l, n[2] / l], [b.uv[2 * k], b.uv[2 * k + 1]])
    })
  }
}

// ---- compact binary: 'APHT' v1, 40-byte header, then uint16 heights (65535 = no data) -------------

const MAGIC = 0x54485041 // 'APHT' little-endian

export function encodeHeightfield(hf: Heightfield): ArrayBuffer {
  const finite = [...hf.heights].filter(Number.isFinite)
  const lo = finite.length ? Math.min(...finite) : 0
  const hi = finite.length ? Math.max(...finite) : 0
  const scale = hi > lo ? (hi - lo) / 65534 : 1
  const buf = new ArrayBuffer(40 + 2 * hf.nx * hf.nz)
  const dv = new DataView(buf)
  dv.setUint32(0, MAGIC, true)
  dv.setUint16(4, 1, true)
  dv.setUint32(8, hf.nx, true)
  dv.setUint32(12, hf.nz, true)
  dv.setFloat64(16, hf.cell, true)
  dv.setFloat32(24, hf.originX, true)
  dv.setFloat32(28, hf.originZ, true)
  dv.setFloat32(32, lo, true)
  dv.setFloat32(36, scale, true)
  const q = new Uint16Array(buf, 40)
  hf.heights.forEach((h, i) => (q[i] = Number.isFinite(h) ? Math.round((h - lo) / scale) : 65535))
  return buf
}

export function decodeHeightfield(buf: ArrayBuffer): Heightfield {
  const dv = new DataView(buf)
  if (dv.getUint32(0, true) !== MAGIC || dv.getUint16(4, true) !== 1) throw new Error('not an APHT v1 heightfield')
  const nx = dv.getUint32(8, true)
  const nz = dv.getUint32(12, true)
  const lo = dv.getFloat32(32, true)
  const scale = dv.getFloat32(36, true)
  const q = new Uint16Array(buf, 40, nx * nz)
  const heights = new Float32Array(nx * nz)
  q.forEach((v, i) => (heights[i] = v === 65535 ? NaN : lo + v * scale))
  return { nx, nz, cell: dv.getFloat64(16, true), originX: dv.getFloat32(24, true), originZ: dv.getFloat32(28, true), heights }
}
