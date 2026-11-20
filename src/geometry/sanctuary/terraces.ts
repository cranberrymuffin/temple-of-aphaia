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
import type { EdgeFace, Point2, TerrainDesc } from '../../data/sanctuary'
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
  /** Edge-face material per ccw edge. */
  faces: EdgeFace[]
}

/** Mesh group (material id) of each terrace edge-face kind; Step 4 paints them. */
export const EDGE_FACE_GROUP: Record<EdgeFace, string> = { rubble: 'sanctuary-wall', ashlar: 'ashlar-wall', older: 'older-wall', rock: 'rock-face' }

/** Conventions for the terrace edge faces (logged with the site). */
export const EDGE_CONVENTIONS = {
  /** Retaining faces taller than this (m) lean back: the foot steps out by batterRatio per metre above it. */
  batterFrom: 1.5,
  batterRatio: 0.12,
  /** Natural rock faces: always battered (foot out by rockBatter..rockBatter + rockJitter per metre of height),
   * faceted every rockFacet metres along the edge with a deterministic per-point jitter. */
  rockBatter: 0.25,
  rockJitter: 0.35,
  rockFacet: 1.2,
} as const

/** Deterministic pseudo-random value in [0, 1) for a point (continuous across pieces sharing it). */
function hash01(p: Point2): number {
  const h = Math.sin(Math.round(p[0] * 1000) * 12.9898 + Math.round(p[1] * 1000) * 78.233) * 43758.5453
  return h - Math.floor(h)
}

function terraces(desc: TerrainDesc, stylobateTop: number): T[] {
  return Object.entries(desc.terraces)
    .filter(([, t]) => !t.hiddenReason)
    .map(([id, t]) => {
      const n = t.polygon.length
      const rev = signedArea(t.polygon) < 0
      const faceOf = (i: number): EdgeFace => t.edgeFaces?.[i] ?? t.edgeFace ?? 'rubble'
      return {
        id,
        poly: t.polygon,
        ccw: rev ? [...t.polygon].reverse() : t.polygon,
        y: stylobateTop + t.level.value,
        over: t.falloff ? { edgeDrop: t.falloff.edgeDrop.value, slope: t.falloff.slope.value } : undefined,
        // Reversed: ccw edge k runs from point n-1-k to n-2-k, i.e. original edge n-2-k.
        faces: Array.from({ length: n }, (_, k) => faceOf(rev ? (2 * n - 2 - k) % n : k)),
      }
    })
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

/**
 * Conjectural correction of a surface model (the DEM is a DSM with modern spoil heaps and trees) next to the
 * terraces: within `hold` of a terrace edge (and under it) the natural ground is kept at least `drop` below that
 * terrace, feathered (smoothstep) back to the original by `radius`. `stats.maxLowered` records the largest change seen.
 */
export function clampNearTerraces(g: GroundFn, desc: TerrainDesc, stylobateTop: number, radius: number, drop: number, hold = 0) {
  const ts = terraces(desc, stylobateTop).map((t) => ({
    ...t,
    drop: desc.terraces[t.id].clampDrop?.value ?? drop,
    fill: desc.terraces[t.id].fillDrop?.value,
    bb: [Math.min(...t.poly.map((p) => p[0])) - radius, Math.max(...t.poly.map((p) => p[0])) + radius, Math.min(...t.poly.map((p) => p[1])) - radius, Math.max(...t.poly.map((p) => p[1])) + radius],
  }))
  const stats = { maxLowered: 0, maxRaised: 0, radius, drop, hold }
  const ground: GroundFn = (x, z) => {
    const h = g(x, z)
    let low = h
    let high = h
    for (const t of ts) {
      const cap = t.y - t.drop
      const fill = t.fill === undefined ? -Infinity : t.y - t.fill
      if ((h <= cap && h >= fill) || x < t.bb[0] || x > t.bb[1] || z < t.bb[2] || z > t.bb[3]) continue
      // Under the terrace too (d = 0): the mesh triangles across its edge interpolate those nodes.
      const d = pointInPolygon(t.poly, [x, z]) ? 0 : nearest(t, [x, z]).d
      if (d >= radius) continue
      const s = Math.max(0, d - hold) / (radius - hold)
      const w = s * s * (3 - 2 * s)
      if (h > cap) low = Math.min(low, w * h + (1 - w) * cap)
      if (h < fill) high = Math.max(high, w * h + (1 - w) * fill)
    }
    // A fill (softening a drop next to a lower terrace) wins where it applies: it only reaches ground already
    // below that terrace, which the higher neighbours' lowering would otherwise deepen into a ditch.
    const out = high > h ? high : low
    stats.maxLowered = Math.max(stats.maxLowered, h - out)
    stats.maxRaised = Math.max(stats.maxRaised, out - h)
    return out
  }
  return { ground, stats }
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
  const pts = Object.values(desc.terraces)
    .filter((t) => !t.hiddenReason)
    .flatMap((t) => t.polygon)
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

export interface SparseTerrainOptions {
  /** Natural ground outside the terraces (e.g. the DEM); default: the parametric directional falloff. */
  ground?: GroundFn
  /** Rectilinear grid nodes for the natural ground; default: a uniform tier grid over the terraces + radius. */
  grid?: { xs: Float64Array; zs: Float64Array }
}

export interface TerrainMismatch {
  terrace: string
  /** Largest amount the natural ground rises above the terrace at its edge (m). */
  maxAbove: number
  /** Edge length where it does (m). */
  length: number
}

/** Piecewise-linear height of the meshed grid (same triangulation as terrain(): (00,01,11) and (00,11,10)). */
function meshHeight(hf: MeshGrid) {
  const find = (a: Float64Array, v: number) => {
    let lo = 0
    let hi = a.length - 2
    if (v <= a[0]) return 0
    if (v >= a[a.length - 1]) return a.length - 2
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (a[mid] <= v) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  const H = (i: number, j: number) => hf.heights[j * hf.nx + i]
  return (x: number, z: number) => {
    const i = find(hf.xs, x)
    const j = find(hf.zs, z)
    const u = (x - hf.xs[i]) / (hf.xs[i + 1] - hf.xs[i])
    const v = (z - hf.zs[j]) / (hf.zs[j + 1] - hf.zs[j])
    const h00 = H(i, j)
    const h01 = H(i, j + 1)
    const h11 = H(i + 1, j + 1)
    const h10 = H(i + 1, j)
    return v >= u ? h00 + (h01 - h00) * v + (h11 - h01) * u : h00 + (h10 - h00) * u + (h11 - h10) * v
  }
}

type MeshGrid = Heightfield & { xs: Float64Array; zs: Float64Array }

/** The natural-ground grid the terrain is meshed on (the DEM grid, or a uniform tier grid for the falloff). */
function naturalGrid(desc: TerrainDesc, stylobateTop: number, tier: Tier, opts: SparseTerrainOptions): MeshGrid {
  const g = opts.ground ?? naturalGroundFn(desc, stylobateTop)
  let grid = opts.grid
  if (!grid) {
    const b = terrainBounds(desc)
    const cell = SPARSE_CELL[tier]
    const axis = (lo: number, hi: number) => {
      const n = Math.ceil((hi - lo) / cell)
      return new Float64Array(Array.from({ length: n + 1 }, (_, k) => lo + k * cell))
    }
    grid = { xs: axis(b.minX, b.maxX), zs: axis(b.minZ, b.maxZ) }
  }
  const nx = grid.xs.length
  const nz = grid.zs.length
  const heights = new Float32Array(nx * nz)
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) heights[j * nx + i] = g(grid.xs[i], grid.zs[j])
  return { nx, nz, cell: 0, originX: grid.xs[0], originZ: grid.zs[0], heights, xs: grid.xs, zs: grid.zs }
}

/**
 * The surface exactly as meshed: terrace level inside a terrace, else the piecewise-linear natural-ground
 * mesh (not the smooth function it samples), so feature skirts and bases meet the terrain that is drawn.
 */
export function meshedGround(desc: TerrainDesc, stylobateTop: number, tier: Tier, opts: SparseTerrainOptions = {}): GroundFn {
  const ts = terraces(desc, stylobateTop)
  const mh = meshHeight(naturalGrid(desc, stylobateTop, tier, opts))
  return (x, z) => {
    for (const t of ts) if (pointInPolygon(t.poly, [x, z])) return t.y
    return mh(x, z)
  }
}

/** Terrain mesh (group 'terrain'): exact terrace tops, the natural ground grid around them, edge faces. */
export function sparseTerrain(
  desc: TerrainDesc,
  stylobateTop: number,
  tier: Tier,
  col: Collector,
  cuts: Point2[][] = [],
  opts: SparseTerrainOptions = {},
): Omit<GeneratorOutput, 'groups'> & { mismatches: TerrainMismatch[] } {
  const g = opts.ground ?? naturalGroundFn(desc, stylobateTop)
  const ts = terraces(desc, stylobateTop)
  const tris = ts.map((t) => triangulate(t.poly))
  const fnSurface = (x: number, z: number) => {
    for (const t of ts) if (pointInPolygon(t.poly, [x, z])) return t.y
    return g(x, z)
  }

  // Natural ground grid (rectilinear), minus terraces and features.
  const hf = naturalGrid(desc, stylobateTop, tier, opts)
  const grid = { xs: hf.xs, zs: hf.zs }
  const nx = hf.nx
  const nz = hf.nz
  terrain(hf, 'high', col, [...cuts, ...tris.flat()])
  const mh = meshHeight(hf)
  const b = col.get('terrain')

  // Terrace tops, flat and exact, minus features.
  ts.forEach((t, i) => {
    for (const tri of tris[i]) {
      let pieces: Point2[][] = [tri]
      for (const c of cuts) pieces = pieces.flatMap((pc) => subtractConvex(pc, c))
      for (const pc of pieces) b.polygonFacing(pc.map((p): Vec3 => [p[0], t.y, p[1]]), [0, 1, 0])
    }
  })

  // Edge faces follow the meshed ground exactly: split every edge at grid lines, cell diagonals and where the
  // ground crosses the terrace level; then down faces (ground lower) or up faces (ground higher).
  const mismatches = new Map<string, TerrainMismatch>()
  const crossings = (a: Point2, c: Point2): number[] => {
    const us = new Set<number>([0, 1])
    const add = (u: number) => {
      if (u > 1e-9 && u < 1 - 1e-9) us.add(u)
    }
    for (const [arr, k] of [
      [grid.xs, 0],
      [grid.zs, 1],
    ] as const) {
      const d = c[k] - a[k]
      if (Math.abs(d) < 1e-12) continue
      const lo = Math.min(a[k], c[k])
      const hi = Math.max(a[k], c[k])
      for (const v of arr) if (v > lo && v < hi) add((v - a[k]) / d)
    }
    // Diagonals inside each cell piece.
    const sorted = [...us].sort((p, q) => p - q)
    for (let k = 0; k + 1 < sorted.length; k++) {
      const um = (sorted[k] + sorted[k + 1]) / 2
      const pm: Point2 = [a[0] + (c[0] - a[0]) * um, a[1] + (c[1] - a[1]) * um]
      const ci = Math.max(0, Math.min(nx - 2, grid.xs.findIndex((v, idx) => idx < nx - 1 && pm[0] >= v && pm[0] <= grid.xs[idx + 1])))
      const cj = Math.max(0, Math.min(nz - 2, grid.zs.findIndex((v, idx) => idx < nz - 1 && pm[1] >= v && pm[1] <= grid.zs[idx + 1])))
      const dx = grid.xs[ci + 1] - grid.xs[ci]
      const dz = grid.zs[cj + 1] - grid.zs[cj]
      // f(u) = (x - x0)/dx - (z - z0)/dz, linear in u.
      const f = (u: number) => (a[0] + (c[0] - a[0]) * u - grid.xs[ci]) / dx - (a[1] + (c[1] - a[1]) * u - grid.zs[cj]) / dz
      const f0 = f(sorted[k])
      const f1 = f(sorted[k + 1])
      if (f0 * f1 < 0) add(sorted[k] + ((sorted[k + 1] - sorted[k]) * f0) / (f0 - f1))
    }
    return [...us].sort((p, q) => p - q)
  }
  for (const t of ts) {
    const poly = t.ccw
    // Battered feet at each edge's start and end vertex, to close the wedge at convex corners.
    const startFoot: (Vec3 | undefined)[] = []
    const endFoot: (Vec3 | undefined)[] = []
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const c = poly[(i + 1) % poly.length]
      const len = Math.hypot(c[0] - a[0], c[1] - a[1])
      const out: Point2 = [(c[1] - a[1]) / len, -(c[0] - a[0]) / len]
      const face = col.get(EDGE_FACE_GROUP[t.faces[i]])
      const rock = t.faces[i] === 'rock'
      // Split where another terrace's vertex lies on this edge, so each piece borders a single neighbour.
      const params = new Set<number>(crossings(a, c))
      if (rock) for (let k = 1; k * EDGE_CONVENTIONS.rockFacet < len; k++) params.add((k * EDGE_CONVENTIONS.rockFacet) / len)
      for (const o of ts)
        if (o !== t)
          for (const q of o.poly) {
            const u = ((q[0] - a[0]) * (c[0] - a[0]) + (q[1] - a[1]) * (c[1] - a[1])) / (len * len)
            const off = Math.abs((q[0] - a[0]) * out[0] + (q[1] - a[1]) * out[1])
            if (u > 1e-9 && u < 1 - 1e-9 && off < 1e-6) params.add(u)
          }
      const at = (u: number): Point2 => [a[0] + (c[0] - a[0]) * u, a[1] + (c[1] - a[1]) * u]
      const probe = (p: Point2): Point2 => [p[0] + out[0] * 1e-3, p[1] + out[1] * 1e-3]
      // Level crossings of the ground along the edge (linear within each piece).
      const base = [...params].sort((p, q) => p - q)
      for (let k = 0; k + 1 < base.length; k++) {
        const h0 = mh(...at(base[k])) - t.y
        const h1 = mh(...at(base[k + 1])) - t.y
        if (h0 * h1 < 0) params.add(base[k] + ((base[k + 1] - base[k]) * h0) / (h0 - h1))
      }
      const us = [...params].sort((p, q) => p - q)
      for (let k = 0; k + 1 < us.length; k++) {
        const pa = at(us[k])
        const pb = at(us[k + 1])
        const mid = at((us[k] + us[k + 1]) / 2)
        const other = ts.find((o) => o !== t && pointInPolygon(o.poly, probe(mid)))
        if (other && other.y >= t.y - 1e-6) continue // equal: seamless; higher: that terrace builds the riser
        const ga = other ? other.y : mh(...pa)
        const gb = other ? other.y : mh(...pb)
        const up = !other && (ga + gb) / 2 > t.y
        if (up) {
          const m = mismatches.get(t.id) ?? { terrace: t.id, maxAbove: 0, length: 0 }
          m.maxAbove = Math.max(m.maxAbove, ga - t.y, gb - t.y)
          m.length += Math.hypot(pb[0] - pa[0], pb[1] - pa[1])
          mismatches.set(t.id, m)
        }
        for (const [u0, u1] of outsideCuts(pa, pb, cuts)) {
          const p0: Point2 = [pa[0] + (pb[0] - pa[0]) * u0, pa[1] + (pb[1] - pa[1]) * u0]
          const p1: Point2 = [pa[0] + (pb[0] - pa[0]) * u1, pa[1] + (pb[1] - pa[1]) * u1]
          if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 1e-4) continue // sub-millimetre slivers between cuts
          const g0 = other ? other.y : mh(...p0)
          const g1 = other ? other.y : mh(...p1)
          // Faces run between the terrace level and the meshed ground, overlapping it by a hair (no crack): masonry
          // or rock (never bare terrain). A tall retaining face toward natural ground is battered: its foot steps out.
          const eps = SKIRT_MARGIN
          const dirOut: Vec3 = up ? [-out[0], 0, -out[1]] : [out[0], 0, out[1]]
          if (up || (other && !rock)) {
            const quad: Vec3[] = up
              ? [[p0[0], t.y, p0[1]], [p1[0], t.y, p1[1]], [p1[0], g1 + eps, p1[1]], [p0[0], g0 + eps, p0[1]]]
              : [[p0[0], g0 - eps, p0[1]], [p1[0], g1 - eps, p1[1]], [p1[0], t.y, p1[1]], [p0[0], t.y, p0[1]]]
            face.polygonFacing(quad, dirOut)
          } else {
            const C = EDGE_CONVENTIONS
            const foot = (p: Point2, g: number): Vec3 => {
              const h = Math.max(0, t.y - g)
              const k = rock ? (C.rockBatter + C.rockJitter * hash01(p)) * h : C.batterRatio * Math.max(0, h - C.batterFrom)
              const q: Point2 = [p[0] + out[0] * k, p[1] + out[1] * k]
              // Toward a lower terrace the foot rests on its flat top; toward natural ground on the meshed ground.
              return [q[0], (k > 0 && !other ? Math.min(g, mh(...q)) : g) - eps, q[1]]
            }
            const f0 = foot(p0, g0)
            const f1 = foot(p1, g1)
            if (Math.hypot(p0[0] - a[0], p0[1] - a[1]) < 1e-9) startFoot[i] = f0
            if (Math.hypot(p1[0] - c[0], p1[1] - c[1]) < 1e-9) endFoot[i] = f1
            const t0: Vec3 = [p0[0], t.y, p0[1]]
            const t1: Vec3 = [p1[0], t.y, p1[1]]
            // Two triangles: the four corners need not be coplanar once the feet step out by different amounts.
            const bat: Vec3 = [out[0], 0.2, out[1]]
            face.polygonFacing([f0, f1, t1], bat)
            face.polygonFacing([f0, t1, t0], bat)
          }
        }
      }
    }
    for (let k = 0; k < poly.length; k++) {
      const fa = endFoot[(k - 1 + poly.length) % poly.length]
      const fb = startFoot[k]
      if (!fa || !fb || Math.hypot(fa[0] - fb[0], fa[2] - fb[2]) < 1e-6) continue
      const v = poly[k]
      const pv = poly[(k - 1 + poly.length) % poly.length]
      const nv = poly[(k + 1) % poly.length]
      if ((v[0] - pv[0]) * (nv[1] - v[1]) - (v[1] - pv[1]) * (nv[0] - v[0]) <= 0) continue // reflex corner: the faces overlap
      const dir: Vec3 = [(fa[0] + fb[0]) / 2 - v[0], 0.2, (fa[2] + fb[2]) / 2 - v[1]]
      col.get(EDGE_FACE_GROUP[t.faces[k]]).polygonFacing([fa, fb, [v[0], t.y, v[1]]], dir)
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
  const walk = sampleToHeightfield(fnSurface, wb, WALK_CELL)
  levels.push({ name: 'terrain', y: Math.min(...walk.heights), ...wb, heightfield: walk })
  return { instances: [], colliders: [], levels, mismatches: [...mismatches.values()].filter((m) => m.maxAbove > 0.01) }
}
