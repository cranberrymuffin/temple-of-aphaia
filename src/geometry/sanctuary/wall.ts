// Wall runs (terrace / peribolos walls) and open drainage channels, both extruded from polylines with
// mitred joints. Walls stand on a hidden skirt; channels are troughs with a coping lip on both sides.
import type { ChannelFeature, Point2, WallFeature } from '../../data/sanctuary'
import type { Collector, Vec3 } from '../mesh'
import type { Collider, GeneratorOutput } from '../types'
import { SANCTUARY_CONVENTIONS as K, groundRange, offsetPolyline, type GroundFn, type SanctuaryContext } from './common'

const P = (p: Point2, y: number): Vec3 => [p[0], y, p[1]]

/** Ground range under each segment's strip of width w. */
function segmentRanges(ground: GroundFn, pts: Point2[], w: number) {
  return pts.slice(1).map((b, i) => {
    const { left, right } = offsetPolyline([pts[i], b], w)
    return groundRange(ground, [left[0], left[1], right[1], right[0]])
  })
}

function segmentCollider(name: string, a: Point2, b: Point2, w: number, y0: number, y1: number): Collider {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  return { kind: 'obb', name, cx: (a[0] + b[0]) / 2, cz: (a[1] + b[1]) / 2, halfX: Math.hypot(dx, dz) / 2, halfZ: w / 2, rotY: Math.atan2(-dz, dx), y0, y1 }
}

/** Left normal (seen from above, x east / z south) of segment a -> b, as a direction hint. */
const leftOf = (a: Point2, b: Point2): Vec3 => [b[1] - a[1], 0, -(b[0] - a[0])]

export function wallRun(id: string, f: WallFeature, ctx: SanctuaryContext, col: Collector): Omit<GeneratorOutput, 'groups'> {
  const closed = !!f.closed
  const t = f.thickness.value
  const H = f.height.value
  const pts = closed ? [...f.polyline, f.polyline[0]] : f.polyline
  const { left, right } = offsetPolyline(f.polyline, t, closed)
  const L = closed ? [...left, left[0]] : left
  const R = closed ? [...right, right[0]] : right
  const ranges = segmentRanges(ctx.ground, pts, t)
  const minG = Math.min(...ranges.map((r) => r.min))
  const fixed = f.baseLevel !== undefined ? ctx.stylobateTop + f.baseLevel : undefined
  const bottom = (fixed !== undefined ? Math.min(fixed, minG) : minG) - K.skirt
  const level = f.top !== 'follow'
  const topAll = (fixed ?? Math.max(...ranges.map((r) => r.max))) + H
  // Follow: each vertex takes the highest ground of its adjacent segments.
  const top = pts.map((_, i) => {
    if (level) return topAll
    const adj = [ranges[i - 1], ranges[i]].filter(Boolean).map((r) => r.max)
    if (closed && (i === 0 || i === pts.length - 1)) adj.push(ranges[0].max, ranges[ranges.length - 1].max)
    return (fixed ?? Math.max(...adj)) + H
  })
  const b = col.get('sanctuary-wall')
  const colliders: Collider[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const j = i + 1
    const nL = leftOf(pts[i], pts[j])
    b.polygonFacing([P(L[i], bottom), P(L[j], bottom), P(L[j], top[j]), P(L[i], top[i])], nL)
    b.polygonFacing([P(R[i], bottom), P(R[j], bottom), P(R[j], top[j]), P(R[i], top[i])], [-nL[0], 0, -nL[2]])
    b.polygonFacing([P(L[i], top[i]), P(L[j], top[j]), P(R[j], top[j]), P(R[i], top[i])], [0, 1, 0])
    colliders.push(segmentCollider(`${id}-${i}`, pts[i], pts[j], t, bottom, Math.max(top[i], top[j])))
  }
  if (!closed) {
    const n = pts.length - 1
    const back: Vec3 = [pts[0][0] - pts[1][0], 0, pts[0][1] - pts[1][1]]
    const fwd: Vec3 = [pts[n][0] - pts[n - 1][0], 0, pts[n][1] - pts[n - 1][1]]
    b.polygonFacing([P(L[0], bottom), P(R[0], bottom), P(R[0], top[0]), P(L[0], top[0])], back)
    b.polygonFacing([P(L[n], bottom), P(R[n], bottom), P(R[n], top[n]), P(L[n], top[n])], fwd)
  }
  return { instances: [], colliders, levels: [] }
}

export function channel(_id: string, f: ChannelFeature, ctx: SanctuaryContext, col: Collector): Omit<GeneratorOutput, 'groups'> {
  const w = f.width.value
  const c = K.channelCopingRatio * w
  const pts = f.polyline
  const inner = offsetPolyline(pts, w)
  const outer = offsetPolyline(pts, w + 2 * c)
  const ranges = segmentRanges(ctx.ground, pts, w + 2 * c)
  const lip = K.channelLipRatio * w
  const top = pts.map((_, i) => Math.max(...[ranges[i - 1], ranges[i]].filter(Boolean).map((r) => r.max)) + lip)
  const floor = pts.map((p) => (f.baseLevel !== undefined ? ctx.stylobateTop + f.baseLevel : ctx.ground(p[0], p[1])) - f.depth.value)
  // The skirt must reach below both the lowest ground and the trough floor.
  const bottom = Math.min(...ranges.map((r) => r.min), ...floor) - K.skirt
  const b = col.get('channel')
  const n = pts.length - 1
  for (let i = 0; i < n; i++) {
    const j = i + 1
    const nL = leftOf(pts[i], pts[j])
    const nR: Vec3 = [-nL[0], 0, -nL[2]]
    const [LI, RI, LO, RO] = [inner.left, inner.right, outer.left, outer.right]
    // Trough: floor and the two inner walls facing the channel axis.
    b.polygonFacing([P(LI[i], floor[i]), P(LI[j], floor[j]), P(RI[j], floor[j]), P(RI[i], floor[i])], [0, 1, 0])
    b.polygonFacing([P(LI[i], floor[i]), P(LI[j], floor[j]), P(LI[j], top[j]), P(LI[i], top[i])], nR)
    b.polygonFacing([P(RI[i], floor[i]), P(RI[j], floor[j]), P(RI[j], top[j]), P(RI[i], top[i])], nL)
    // Coping lips and their outer faces down to the hidden skirt.
    b.polygonFacing([P(LO[i], top[i]), P(LO[j], top[j]), P(LI[j], top[j]), P(LI[i], top[i])], [0, 1, 0])
    b.polygonFacing([P(RI[i], top[i]), P(RI[j], top[j]), P(RO[j], top[j]), P(RO[i], top[i])], [0, 1, 0])
    b.polygonFacing([P(LO[i], bottom), P(LO[j], bottom), P(LO[j], top[j]), P(LO[i], top[i])], nL)
    b.polygonFacing([P(RO[i], bottom), P(RO[j], bottom), P(RO[j], top[j]), P(RO[i], top[i])], nR)
  }
  // Ends: the trough is closed by an end wall facing into the channel; the copings get end faces.
  for (const [k, kk] of [
    [0, 1],
    [n, n - 1],
  ]) {
    const into: Vec3 = [pts[kk][0] - pts[k][0], 0, pts[kk][1] - pts[k][1]]
    const away: Vec3 = [-into[0], 0, -into[2]]
    const { left: LI, right: RI } = inner
    const { left: LO, right: RO } = outer
    b.polygonFacing([P(LI[k], floor[k]), P(RI[k], floor[k]), P(RI[k], top[k]), P(LI[k], top[k])], into)
    // Outside of the end, split so it never overlaps the end wall in the same plane.
    b.polygonFacing([P(LO[k], bottom), P(LI[k], bottom), P(LI[k], top[k]), P(LO[k], top[k])], away)
    b.polygonFacing([P(RI[k], bottom), P(RO[k], bottom), P(RO[k], top[k]), P(RI[k], top[k])], away)
    b.polygonFacing([P(LI[k], bottom), P(RI[k], bottom), P(RI[k], floor[k]), P(LI[k], floor[k])], away)
  }
  return { instances: [], colliders: [], levels: [] }
}
