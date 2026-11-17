// Open cistern basin (rectangular or circular): coping rim on the ground, inner walls down to the floor,
// so the water system reads from above. The terrain is cut by the rim's outer outline.
import type { CisternFeature, Point2 } from '../../data/sanctuary'
import { pearOutline, signedAreaPts } from './shapes'
import type { Collector, Vec3 } from '../mesh'
import type { Collider, GeneratorOutput, Tier } from '../types'
import { SANCTUARY_CONVENTIONS as K, groundRange, localToWorld, obb, type SanctuaryContext } from './common'

export const CIRCLE_SEGMENTS: Record<Tier, number> = { low: 16, med: 24, high: 40 }

/** Inner (opening) and outer (rim) loops, counter-clockwise seen from above. */
export function cisternLoops(f: CisternFeature, tier: Tier): { inner: Point2[]; outer: Point2[] } {
  const rw = f.rimWidth.value
  const toW = localToWorld(f.center, f.rotation)
  if (f.shape === 'pear') {
    // Same vertex count on both loops so the coping quads pair up.
    const n = CIRCLE_SEGMENTS[tier]
    const inner = resample(pearOutline(f.center, f.length!.value, f.diameter!.value, f.smallDiameter!.value, f.rotation, n), n)
    const outer = resample(pearOutline(f.center, f.length!.value, f.diameter!.value, f.smallDiameter!.value, f.rotation, n, rw), n)
    return { inner: ccw(inner), outer: ccw(outer) }
  }
  if (f.shape === 'circle') {
    const r = f.diameter!.value / 2
    const n = CIRCLE_SEGMENTS[tier]
    // Outer loop as a circumscribed polygon so the rim keeps its width at the facets.
    const ring = (rr: number) => Array.from({ length: n }, (_, i) => toW(rr * Math.cos((-2 * Math.PI * i) / n), rr * Math.sin((-2 * Math.PI * i) / n)))
    return { inner: ring(r), outer: ring((r + rw) / Math.cos(Math.PI / n)) }
  }
  const hx = f.length!.value / 2
  const hz = f.width!.value / 2
  const rect = (x: number, z: number) => [toW(-x, z), toW(x, z), toW(x, -z), toW(-x, -z)]
  return { inner: rect(hx, hz), outer: rect(hx + rw, hz + rw) }
}

export function cistern(id: string, f: CisternFeature, ctx: SanctuaryContext, col: Collector): Omit<GeneratorOutput, 'groups'> {
  const { inner, outer } = cisternLoops(f, ctx.tier)
  const range = groundRange(ctx.ground, outer)
  const ground = f.baseLevel !== undefined ? ctx.stylobateTop + f.baseLevel : range.max
  const rimTop = ground + Math.max(0, f.rimHeight.value)
  const floorY = ground - f.depth.value
  const bottom = Math.min(ground, range.min) - K.skirt
  const b = col.get('cistern')
  const n = inner.length
  const P = (p: Point2, y: number): Vec3 => [p[0], y, p[1]]
  const cx = inner.reduce((a, p) => a + p[0], 0) / n
  const cz = inner.reduce((a, p) => a + p[1], 0) / n
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const midI: Point2 = [(inner[i][0] + inner[j][0]) / 2, (inner[i][1] + inner[j][1]) / 2]
    const midO: Point2 = [(outer[i][0] + outer[j][0]) / 2, (outer[i][1] + outer[j][1]) / 2]
    // Coping top.
    b.polygonFacing([P(inner[i], rimTop), P(inner[j], rimTop), P(outer[j], rimTop), P(outer[i], rimTop)], [0, 1, 0])
    // Rim outer face down to the hidden skirt.
    b.polygonFacing([P(outer[i], bottom), P(outer[j], bottom), P(outer[j], rimTop), P(outer[i], rimTop)], [midO[0] - cx, 0, midO[1] - cz])
    // Basin wall, facing the basin.
    b.polygonFacing([P(inner[i], floorY), P(inner[j], floorY), P(inner[j], rimTop), P(inner[i], rimTop)], [cx - midI[0], 0, cz - midI[1]])
  }
  b.polygonFacing(inner.map((p) => P(p, floorY)), [0, 1, 0])
  const collider: Collider =
    f.shape === 'circle'
      ? { kind: 'circle', name: `${id}-cistern`, x: f.center[0], z: f.center[1], r: f.diameter!.value / 2 + f.rimWidth.value, y0: floorY, y1: rimTop }
      : f.shape === 'pear'
        ? { kind: 'circle', name: `${id}-cistern`, x: f.center[0], z: f.center[1], r: f.length!.value / 2 + f.rimWidth.value, y0: floorY, y1: rimTop }
        : obb(`${id}-cistern`, f.center, f.length!.value / 2 + f.rimWidth.value, f.width!.value / 2 + f.rimWidth.value, f.rotation, floorY, rimTop)
  return { instances: [], colliders: [collider], levels: [] }
}

/** Counter-clockwise when seen from above (negative signed area in (x, z) axes), matching the other loops. */
function ccw(p: Point2[]): Point2[] {
  return signedAreaPts(p) > 0 ? [...p].reverse() : p
}

/** Resample a closed convex polygon to n points by angle around its centroid (keeps inner/outer loops paired). */
function resample(p: Point2[], n: number): Point2[] {
  const cx = p.reduce((a, q) => a + q[0], 0) / p.length
  const cz = p.reduce((a, q) => a + q[1], 0) / p.length
  const out: Point2[] = []
  for (let i = 0; i < n; i++) {
    const a = (-2 * Math.PI * i) / n
    const d: Point2 = [Math.cos(a), Math.sin(a)]
    // Ray from the centroid: farthest intersection with the polygon edges.
    let best = 0
    for (let k = 0; k < p.length; k++) {
      const s = p[k]
      const e = p[(k + 1) % p.length]
      const ex = e[0] - s[0]
      const ez = e[1] - s[1]
      const den = d[0] * ez - d[1] * ex
      if (Math.abs(den) < 1e-12) continue
      const tt = ((s[0] - cx) * ez - (s[1] - cz) * ex) / den
      const u = ((s[0] - cx) * d[1] - (s[1] - cz) * d[0]) / den
      if (tt > 0 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.max(best, tt)
    }
    out.push([cx + d[0] * best, cz + d[1] * best])
  }
  return out
}
