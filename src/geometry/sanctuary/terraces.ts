// Sparse, conjectural terrain (the scan covers only the temple): flat terrace polygons at levels relative
// to the stylobate top, retaining walls (wall features, cut out of the terrain) and a directional hill
// falloff beyond the terraces. Pure (no `three`).
//
// Natural ground g(x, z) = max over terraces of  level - edgeDrop(dir) - slope(dir) * d - slope(dir) * d^2 / (2 R)
// (d = distance to that terrace's boundary, dir = outward direction from it; edgeDrop/slope blend the
// n/e/s/w values by dir, or use the terrace's own override). The surface is the terrace level inside a
// terrace and g outside. Mesh: terraces triangulated exactly at their levels; g on a tier-resolution grid,
// cut by the terraces and feature footprints; vertical faces on terrace edges close the step to g: down
// (retaining face, rock face or riser to a lower terrace) or up (cut face where the hill is higher).
import type { Point2, TerrainDesc } from '../../data/sanctuary'
import { pointInPolygon, signedArea, triangulate } from '../../data/polygon'
import type { Collector, Vec3 } from '../mesh'
import type { GeneratorOutput, Heightfield, Level, Tier } from '../types'
import type { GroundFn } from './common'
import { subtractConvex, terrain } from './terrain'

export const SPARSE_CELL: Record<Tier, number> = { low: 4, med: 2, high: 1 }
/** Resolution of the heightfield handed to walk mode (m), and its margin beyond the terraces. */
export const WALK_CELL = 0.5
export const WALK_MARGIN = 15
const SKIRT_MARGIN = 0.05

interface T {
  id: string
  poly: Point2[]
  /** Counter-clockwise in (x, z) axes: interior on the left of each edge. */
  ccw: Point2[]
  y: number
  over?: { edgeDrop: number; slope: number }
}

function terraces(desc: TerrainDesc, stylobateTop: number): T[] {
  return Object.entries(desc.terraces).map(([id, t]) => ({
    id,
    poly: t.polygon,
    ccw: signedArea(t.polygon) < 0 ? [...t.polygon].reverse() : t.polygon,
    y: stylobateTop + t.level.value,
    over: t.falloff ? { edgeDrop: t.falloff.edgeDrop.value, slope: t.falloff.slope.value } : undefined,
  }))
}

/** Distance from q to the polygon boundary and the outward unit direction there. */
function nearest(t: T, q: Point2): { d: number; dir: Point2 } {
  let best = Infinity
  let dir: Point2 = [0, 1]
  const p = t.ccw
  for (let i = 0; i < p.length; i++) {
    const a = p[i]
    const b = p[(i + 1) % p.length]
    const ex = b[0] - a[0]
    const ez = b[1] - a[1]
    const l2 = ex * ex + ez * ez
    const s = l2 > 0 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * ex + (q[1] - a[1]) * ez) / l2)) : 0
    const cx = a[0] + s * ex
    const cz = a[1] + s * ez
    const d = Math.hypot(q[0] - cx, q[1] - cz)
    if (d < best - 1e-12) {
      best = d
      const l = Math.sqrt(l2)
      // Edge outward normal (interior on the left): (ez, -ex).
      dir = d > 1e-6 ? [(q[0] - cx) / d, (q[1] - cz) / d] : [ez / l, -ex / l]
    }
  }
  return { d: best, dir }
}

/** Edge drop and slope for an outward direction (blended n/e/s/w, or the terrace override). */
export function falloffAt(desc: TerrainDesc, dir: Point2, over?: { edgeDrop: number; slope: number }) {
  if (over) return over
  const w = { e: Math.max(dir[0], 0) ** 2, w: Math.max(-dir[0], 0) ** 2, s: Math.max(dir[1], 0) ** 2, n: Math.max(-dir[1], 0) ** 2 }
  const sum = w.e + w.w + w.s + w.n || 1
  const F = desc.falloff
  const mix = (k: 'edgeDrop' | 'slope') => (w.e * F[k].e.value + w.w * F[k].w.value + w.s * F[k].s.value + w.n * F[k].n.value) / sum
  return { edgeDrop: mix('edgeDrop'), slope: mix('slope') }
}

export function falloffDrop(desc: TerrainDesc, d: number, dir: Point2 = [0, 1], over?: { edgeDrop: number; slope: number }): number {
  const { edgeDrop, slope } = falloffAt(desc, dir, over)
  return edgeDrop + slope * d + (slope * d * d) / (2 * desc.falloff.radius.value)
}

/** Natural (pre-terrace) ground: what lies outside the terraces, continued under them for the mesh grid. */
export function naturalGroundFn(desc: TerrainDesc, stylobateTop: number): GroundFn {
  const ts = terraces(desc, stylobateTop)
  return (x, z) => {
    let h = -Infinity
    for (const t of ts) {
      const { d, dir } = nearest(t, [x, z])
      // Inside a terrace the distance counts as 0 (the drop starts at its edge).
      const dd = pointInPolygon(t.poly, [x, z]) ? 0 : d
      h = Math.max(h, t.y - falloffDrop(desc, dd, dir, t.over))
    }
    return h
  }
}

/** Exact terrain height in the temple frame: terrace level inside a terrace, natural ground outside. */
export function terrainHeightFn(desc: TerrainDesc, stylobateTop: number): GroundFn {
  const ts = terraces(desc, stylobateTop)
  const g = naturalGroundFn(desc, stylobateTop)
  return (x, z) => {
    for (const t of ts) if (pointInPolygon(t.poly, [x, z])) return t.y
    return g(x, z)
  }
}

export function terrainBounds(desc: TerrainDesc, margin = desc.falloff.radius.value) {
  const pts = Object.values(desc.terraces).flatMap((t) => t.polygon)
  return {
    minX: Math.min(...pts.map((p) => p[0])) - margin,
    maxX: Math.max(...pts.map((p) => p[0])) + margin,
    minZ: Math.min(...pts.map((p) => p[1])) - margin,
    maxZ: Math.max(...pts.map((p) => p[1])) + margin,
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
  const g = naturalGroundFn(desc, stylobateTop)
  const ts = terraces(desc, stylobateTop)
  const bounds = terrainBounds(desc)
  const cell = SPARSE_CELL[tier]
  const tris = ts.map((t) => triangulate(t.poly))

  // Natural ground grid, minus terraces and features.
  terrain(sampleToHeightfield(g, bounds, cell), 'high', col, [...cuts, ...tris.flat()])
  const b = col.get('terrain')

  // Terrace tops, flat and exact, minus features.
  ts.forEach((t, i) => {
    for (const tri of tris[i]) {
      let pieces: Point2[][] = [tri]
      for (const c of cuts) pieces = pieces.flatMap((pc) => subtractConvex(pc, c))
      for (const pc of pieces) b.polygonFacing(pc.map((p): Vec3 => [p[0], t.y, p[1]]), [0, 1, 0])
    }
  })

  // Vertical faces on terrace edges. The grid interpolates g linearly between nodes, so faces reach past g
  // by a bound on that error (steepest slope over a cell diagonal) to leave no crack.
  const F = desc.falloff
  const maxSlope = Math.max(...(['n', 'e', 's', 'w'] as const).map((k) => F.slope[k].value), ...ts.map((t) => t.over?.slope ?? 0))
  const gap = maxSlope * cell * Math.SQRT2 * (1 + (cell * Math.SQRT2) / F.radius.value) + SKIRT_MARGIN
  for (const t of ts) {
    const poly = t.ccw
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const c = poly[(i + 1) % poly.length]
      const len = Math.hypot(c[0] - a[0], c[1] - a[1])
      const out: Point2 = [(c[1] - a[1]) / len, -(c[0] - a[0]) / len]
      const n = Math.max(1, Math.ceil(len / cell))
      // Split at the cell subdivision and wherever another terrace's vertex lies on this edge, so each piece
      // borders a single neighbour; then drop the parts inside feature footprints (they bring their own faces).
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
      const probe = (p: Point2): Point2 => [p[0] + out[0] * 1e-3, p[1] + out[1] * 1e-3]
      for (let k = 0; k + 1 < us.length; k++) {
        const pa = at(us[k])
        const pb = at(us[k + 1])
        const mid = at((us[k] + us[k + 1]) / 2)
        const other = ts.find((o) => o !== t && pointInPolygon(o.poly, probe(mid)))
        let y0: number
        let y1: number
        let facing: Point2
        if (other) {
          if (other.y >= t.y - 1e-6) continue // equal: seamless; higher: that terrace builds the riser
          ;[y0, y1, facing] = [other.y - SKIRT_MARGIN, t.y, out]
        } else {
          const ga = g(...probe(pa))
          const gb = g(...probe(pb))
          if (Math.max(ga, gb) > t.y + 1e-6) [y0, y1, facing] = [t.y, Math.max(ga, gb) + gap, [-out[0], -out[1]]]
          else [y0, y1, facing] = [Math.min(ga, gb) - gap, t.y, out]
        }
        for (const [u0, u1] of outsideCuts(pa, pb, cuts)) {
          const p0: Point2 = [pa[0] + (pb[0] - pa[0]) * u0, pa[1] + (pb[1] - pa[1]) * u0]
          const p1: Point2 = [pa[0] + (pb[0] - pa[0]) * u1, pa[1] + (pb[1] - pa[1]) * u1]
          b.polygonFacing(
            [
              [p0[0], y0, p0[1]],
              [p1[0], y0, p1[1]],
              [p1[0], y1, p1[1]],
              [p0[0], y1, p0[1]],
            ],
            [facing[0], 0, facing[1]],
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
  const wb = terrainBounds(desc, WALK_MARGIN)
  const walk = sampleToHeightfield(fn, wb, WALK_CELL)
  levels.push({ name: 'terrain', y: Math.min(...walk.heights), ...wb, heightfield: walk })
  return { instances: [], colliders: [], levels }
}
