// Site-wide gap finder: wherever a feature cuts the terrain, the cut must be covered from above (no hole),
// and along the cut's edge the feature's faces must reach down to the terrain surface (no slit under a
// step end, plinth or wall end through which the sky shows).
import type { Point2 } from '../../../src/data/sanctuary'
import type { Tri } from './triangles'

const CELL = 2

/** xz bucket grid over triangles for vertical and horizontal ray queries. */
export class TriIndex {
  private buckets = new Map<string, Tri[]>()
  constructor(tris: Tri[]) {
    for (const t of tris) {
      const xs = [t.a[0], t.b[0], t.c[0]]
      const zs = [t.a[2], t.b[2], t.c[2]]
      const i0 = Math.floor(Math.min(...xs) / CELL)
      const i1 = Math.floor(Math.max(...xs) / CELL)
      const j0 = Math.floor(Math.min(...zs) / CELL)
      const j1 = Math.floor(Math.max(...zs) / CELL)
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) continue // huge far-terrain / sea triangles: not near features
      for (let i = i0; i <= i1; i++)
        for (let j = j0; j <= j1; j++) {
          const k = `${i},${j}`
          const b = this.buckets.get(k)
          if (b) b.push(t)
          else this.buckets.set(k, [t])
        }
    }
  }

  near(x: number, z: number): Tri[] {
    return this.buckets.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []
  }

  /** Heights where the vertical line through (x, z) meets non-vertical triangles. */
  verticalHits(x: number, z: number, keep: (t: Tri) => boolean = () => true): number[] {
    const ys: number[] = []
    for (const t of this.near(x, z)) {
      if (!keep(t) || Math.abs(t.n[1]) < 1e-6) continue
      const b = bary2(t, x, z)
      if (b) ys.push(t.a[1] * b[0] + t.b[1] * b[1] + t.c[1] * b[2])
    }
    return ys
  }

  /** Does the horizontal segment from p (at height y) along d (unit, xz) for length len hit any kept triangle? */
  horizontalHit(p: Point2, y: number, d: Point2, len: number, keep: (t: Tri) => boolean): boolean {
    const seen = new Set<Tri>()
    for (let s = 0; s <= len + CELL; s += CELL / 2) {
      const q: Point2 = [p[0] + d[0] * Math.min(s, len), p[1] + d[1] * Math.min(s, len)]
      for (const t of this.near(q[0], q[1])) {
        if (seen.has(t) || !keep(t)) continue
        seen.add(t)
        const h = rayTri([p[0], y, p[1]], [d[0], 0, d[1]], t)
        if (h !== null && h >= 0 && h <= len) return true
      }
    }
    return false
  }
}

function bary2(t: Tri, x: number, z: number): [number, number, number] | null {
  const [ax, az, bx, bz, cx, cz] = [t.a[0], t.a[2], t.b[0], t.b[2], t.c[0], t.c[2]]
  const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
  if (Math.abs(det) < 1e-12) return null
  const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det
  const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det
  const l3 = 1 - l1 - l2
  const e = -1e-7
  return l1 >= e && l2 >= e && l3 >= e ? [l1, l2, l3] : null
}

/** Möller-Trumbore, two-sided: distance along d, or null. */
function rayTri(o: number[], d: number[], t: Tri): number | null {
  const e1 = [t.b[0] - t.a[0], t.b[1] - t.a[1], t.b[2] - t.a[2]]
  const e2 = [t.c[0] - t.a[0], t.c[1] - t.a[1], t.c[2] - t.a[2]]
  const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]]
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2]
  if (Math.abs(det) < 1e-12) return null
  const inv = 1 / det
  const s = [o[0] - t.a[0], o[1] - t.a[1], o[2] - t.a[2]]
  const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * inv
  if (u < -1e-7 || u > 1 + 1e-7) return null
  const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]]
  const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv
  if (v < -1e-7 || u + v > 1 + 1e-7) return null
  return (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv
}

export interface GapReport {
  /** Points inside a terrain cut with nothing above or below them (a hole). */
  holes: string[]
  /** Edge points where a horizontal sight line 1 cm above the outside terrain passes under the feature. */
  slits: string[]
  edgeSamples: number
}

const isSurface = (t: Tri) => t.group === 'terrain' && t.n[1] > 0.3

/**
 * Checks the outlines (convex polygons, labelled) against the triangle soup. `tol` is the largest allowed
 * gap between the terrain surface outside an edge and the feature's lowest face there.
 */
export function findGaps(tris: Tri[], outlines: { id: string; poly: Point2[] }[], tol = 0.01, step = 0.25): GapReport {
  const idx = new TriIndex(tris.filter((t) => t.group !== 'sea'))
  const holes: string[] = []
  const slits: string[] = []
  let edgeSamples = 0
  const notSurface = (t: Tri) => !isSurface(t)
  for (const { id, poly } of outlines) {
    // Signed area: orientation for the outward normal.
    let a2 = 0
    for (let i = 0; i < poly.length; i++) a2 += poly[i][0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * poly[i][1]
    const sgn = a2 > 0 ? 1 : -1
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length
    const cz = poly.reduce((s, p) => s + p[1], 0) / poly.length
    for (let i = 0; i < poly.length; i++) {
      const p0 = poly[i]
      const p1 = poly[(i + 1) % poly.length]
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
      if (len < 1e-6) continue
      const d: Point2 = [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len]
      // Outward normal (x east, z south): for a positive (x, z) signed area the outside is to the left of d... pick by centroid.
      let out: Point2 = [d[1] * sgn, -d[0] * sgn]
      const mid: Point2 = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2]
      if ((mid[0] - cx) * out[0] + (mid[1] - cz) * out[1] < 0) out = [-out[0], -out[1]]
      const n = Math.max(1, Math.ceil(len / step))
      for (let k = 0; k <= n; k++) {
        // Stay 2 cm off the corners (corner points belong to two edges and to neighbouring features).
        const u = Math.min(len - 0.02, Math.max(0.02, (k / n) * len))
        const p: Point2 = [p0[0] + d[0] * u, p0[1] + d[1] * u]
        const at = `${id} @ ${p[0].toFixed(2)},${p[1].toFixed(2)}`
        // Hole: just inside the outline, something must cover the line of sight from above.
        const pin: Point2 = [p[0] - out[0] * 0.01, p[1] - out[1] * 0.01]
        if (idx.verticalHits(pin[0], pin[1]).length === 0) holes.push(at)
        // Slit: the terrain surface just outside, then a sight line 1 cm above it toward the feature.
        const po: Point2 = [p[0] + out[0] * 0.003, p[1] + out[1] * 0.003]
        const ground = idx.verticalHits(po[0], po[1], isSurface)
        if (!ground.length) continue // outside is another feature, a terrace top cut or a wall: not terrain
        const gy = Math.max(...ground)
        edgeSamples++
        if (idx.horizontalHit(po, gy + tol, [-out[0], -out[1]], 0.5, notSurface)) continue
        // Nothing stands at that height: fine only if the feature's top there is flush with the terrain
        // (a retaining wall top, a pavement, a rim), or lower with a face closing the step down.
        const tops = idx.verticalHits(pin[0], pin[1], notSurface)
        if (tops.some((y) => Math.abs(y - gy) <= tol)) continue
        const below = tops.filter((y) => y < gy)
        const top = below.length ? Math.max(...below) : -Infinity
        if (Number.isFinite(top) && idx.horizontalHit(po, (top + gy) / 2, [-out[0], -out[1]], 0.5, () => true)) continue
        slits.push(`${at} (ground ${gy.toFixed(3)}, surfaces above the cut ${tops.map((y) => y.toFixed(3)).join('/')})`)
      }
    }
  }
  return { holes, slits, edgeSamples }
}
