// Sparse, conjectural terrain (the scan covers only the temple): flat terrace polygons at levels relative
// to the stylobate top, retaining walls (wall features, cut out of the terrain) and a hilltop falloff
// beyond the terraces. Pure (no `three`).
//
// Height function: inside a terrace -> its level; outside -> max over terraces of
//   level - slope * d - slope * d^2 / (2 * radius)      (d = distance to that terrace; slope doubles at radius)
// Mesh: each terrace is triangulated exactly at its level; the falloff is a tier-resolution grid cut by the
// terraces and the feature footprints. A grid triangle that straddles a terrace edge interpolates below the
// (concave) true surface, so every terrace edge that does not border an equal or higher terrace gets an
// outward skirt deep enough to close that gap; where a lower terrace borders it, the skirt is the riser.
import type { Point2, TerrainDesc } from '../../data/sanctuary'
import { distanceToPolygon, pointInPolygon, signedArea, triangulate } from '../../data/polygon'
import type { Collector, Vec3 } from '../mesh'
import type { GeneratorOutput, Heightfield, Level, Tier } from '../types'
import type { GroundFn } from './common'
import { subtractConvex, terrain } from './terrain'

export const SPARSE_CELL: Record<Tier, number> = { low: 4, med: 2, high: 1 }
/** Resolution of the heightfield handed to walk mode for the falloff (m). */
export const WALK_CELL = 0.5
const SKIRT_MARGIN = 0.05

interface T {
  id: string
  poly: Point2[]
  y: number
}

function terraces(desc: TerrainDesc, stylobateTop: number): T[] {
  return Object.entries(desc.terraces).map(([id, t]) => ({ id, poly: t.polygon, y: stylobateTop + t.level.value }))
}

export function falloffDrop(desc: TerrainDesc, d: number): number {
  const s = desc.falloff.slope.value
  return s * d + (s * d * d) / (2 * desc.falloff.radius.value)
}

/** Exact terrain height in the temple frame. */
export function terrainHeightFn(desc: TerrainDesc, stylobateTop: number): GroundFn {
  const ts = terraces(desc, stylobateTop)
  return (x, z) => {
    for (const t of ts) if (pointInPolygon(t.poly, [x, z])) return t.y
    let h = -Infinity
    for (const t of ts) h = Math.max(h, t.y - falloffDrop(desc, distanceToPolygon(t.poly, [x, z])))
    return h
  }
}

export function terrainBounds(desc: TerrainDesc) {
  const pts = Object.values(desc.terraces).flatMap((t) => t.polygon)
  const r = desc.falloff.radius.value
  return {
    minX: Math.min(...pts.map((p) => p[0])) - r,
    maxX: Math.max(...pts.map((p) => p[0])) + r,
    minZ: Math.min(...pts.map((p) => p[1])) - r,
    maxZ: Math.max(...pts.map((p) => p[1])) + r,
  }
}

/** Samples a height function onto a grid covering `bounds` (for meshing or for walk mode). */
export function sampleToHeightfield(fn: GroundFn, b: ReturnType<typeof terrainBounds>, cell: number): Heightfield {
  const nx = Math.ceil((b.maxX - b.minX) / cell) + 1
  const nz = Math.ceil((b.maxZ - b.minZ) / cell) + 1
  const heights = new Float32Array(nx * nz)
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) heights[iz * nx + ix] = fn(b.minX + ix * cell, b.minZ + iz * cell)
  return { nx, nz, cell, originX: b.minX, originZ: b.minZ, heights }
}

/** Parameter intervals of segment p0 -> p1 outside every convex cut (boundary counts as inside). */
export function outsideCuts(p0: Point2, p1: Point2, cuts: Point2[][]): [number, number][] {
  let keep: [number, number][] = [[0, 1]]
  const d: Point2 = [p1[0] - p0[0], p1[1] - p0[1]]
  for (const cut of cuts) {
    // Cyrus-Beck: the interval of the segment inside the convex polygon.
    const poly = signedArea(cut) < 0 ? [...cut].reverse() : cut
    let t0 = 0
    let t1 = 1
    for (let i = 0; i < poly.length && t0 <= t1; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % poly.length]
      const nx = -(b[1] - a[1]) // inward normal for a counter-clockwise (x, z) polygon
      const nz = b[0] - a[0]
      const num = (p0[0] - a[0]) * nx + (p0[1] - a[1]) * nz
      const den = d[0] * nx + d[1] * nz
      const eps = 1e-9 * Math.hypot(nx, nz)
      if (Math.abs(den) < 1e-15) {
        if (num < -eps) t1 = -1
        continue
      }
      const t = -(num + eps * Math.sign(den)) / den
      if (den > 0) t0 = Math.max(t0, t)
      else t1 = Math.min(t1, t)
    }
    if (t1 - t0 <= 1e-12) continue
    keep = keep.flatMap(([u0, u1]): [number, number][] => {
      const out: [number, number][] = []
      if (t0 > u0) out.push([u0, Math.min(u1, t0)])
      if (t1 < u1) out.push([Math.max(u0, t1), u1])
      return out.filter(([x, y]) => y - x > 1e-9)
    })
  }
  return keep
}

/** Terrain mesh (group 'terrain') from the sparse description, cut by feature footprints. */
export function sparseTerrain(desc: TerrainDesc, stylobateTop: number, tier: Tier, col: Collector, cuts: Point2[][] = []): Omit<GeneratorOutput, 'groups'> {
  const fn = terrainHeightFn(desc, stylobateTop)
  const ts = terraces(desc, stylobateTop)
  const bounds = terrainBounds(desc)
  const cell = SPARSE_CELL[tier]
  const tris = ts.map((t) => triangulate(t.poly))

  // Falloff grid, minus terraces and features.
  const grid = sampleToHeightfield(fn, bounds, cell)
  terrain(grid, 'high', col, [...cuts, ...tris.flat()])
  const b = col.get('terrain')

  // Terrace tops, flat and exact, minus features.
  ts.forEach((t, i) => {
    for (const tri of tris[i]) {
      let pieces: Point2[][] = [tri]
      for (const c of cuts) pieces = pieces.flatMap((pc) => subtractConvex(pc, c))
      for (const pc of pieces) b.polygonFacing(pc.map((p): Vec3 => [p[0], t.y, p[1]]), [0, 1, 0])
    }
  })

  // Skirts / risers on terrace edges.
  const diag = cell * Math.SQRT2
  const gap = falloffDrop(desc, diag) + SKIRT_MARGIN
  for (const t of ts) {
    const poly = signedArea(t.poly) < 0 ? [...t.poly].reverse() : t.poly // interior on the left
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const c = poly[(i + 1) % poly.length]
      const len = Math.hypot(c[0] - a[0], c[1] - a[1])
      const out: Point2 = [(c[1] - a[1]) / len, -(c[0] - a[0]) / len]
      const n = Math.max(1, Math.ceil(len / cell))
      // Split at the cell subdivision and wherever another terrace's vertex lies on this edge, so each piece
      // borders a single neighbour; then drop the parts inside feature footprints (they bring their own skirts).
      const params = new Set<number>(Array.from({ length: n + 1 }, (_, k) => k / n))
      for (const o of ts)
        if (o !== t)
          for (const q of o.poly) {
            const u = ((q[0] - a[0]) * (c[0] - a[0]) + (q[1] - a[1]) * (c[1] - a[1])) / (len * len)
            const off = Math.abs((q[0] - a[0]) * out[0] + (q[1] - a[1]) * out[1])
            if (u > 1e-9 && u < 1 - 1e-9 && off < 1e-6) params.add(u)
          }
      const us = [...params].sort((x, y) => x - y)
      const at = (u: number): Point2 => [a[0] + (c[0] - a[0]) * u, a[1] + (c[1] - a[1]) * u]
      for (let k = 0; k + 1 < us.length; k++) {
        const mid = at((us[k] + us[k + 1]) / 2)
        const probe: Point2 = [mid[0] + out[0] * 1e-3, mid[1] + out[1] * 1e-3]
        const other = ts.find((o) => o !== t && pointInPolygon(o.poly, probe))
        if (other && other.y >= t.y - 1e-6) continue
        const bottom = other ? other.y - SKIRT_MARGIN : t.y - gap
        for (const [u0, u1] of outsideCuts(at(us[k]), at(us[k + 1]), cuts)) {
          const p0 = at(us[k] + (us[k + 1] - us[k]) * u0)
          const p1 = at(us[k] + (us[k + 1] - us[k]) * u1)
          b.polygonFacing(
            [
              [p0[0], bottom, p0[1]],
              [p1[0], bottom, p1[1]],
              [p1[0], t.y, p1[1]],
              [p0[0], t.y, p0[1]],
            ],
            [out[0], 0, out[1]],
          )
        }
      }
    }
  }

  const levels: Level[] = ts.map((t) => ({
    name: `terrace-${t.id}`,
    y: t.y,
    minX: Math.min(...t.poly.map((p) => p[0])),
    maxX: Math.max(...t.poly.map((p) => p[0])),
    minZ: Math.min(...t.poly.map((p) => p[1])),
    maxZ: Math.max(...t.poly.map((p) => p[1])),
    polygon: t.poly,
  }))
  const walk = sampleToHeightfield(fn, bounds, WALK_CELL)
  levels.push({ name: 'terrain', y: Math.min(...walk.heights), ...bounds, heightfield: walk })
  return { instances: [], colliders: [], levels }
}
