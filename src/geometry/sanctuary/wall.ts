// Wall runs (terrace / peribolos walls) and open drainage channels, both extruded from polylines with
// mitred joints. Walls stand on a hidden skirt; channels are troughs with a coping lip on both sides.
import type { ChannelFeature, Masonry, Point2, WallFeature } from '../../data/sanctuary'
import type { Collector, Vec3 } from '../mesh'
import type { Collider, GeneratorOutput } from '../types'
import { SANCTUARY_CONVENTIONS as K, groundRange, offsetPolyline, type GroundFn, type SanctuaryContext } from './common'

const P = (p: Point2, y: number): Vec3 => [p[0], y, p[1]]

/** Ground range under each segment's mitred quad (the outline the wall is extruded from, corners included). */
function wallRanges(ground: GroundFn, polyline: Point2[], w: number, closed: boolean) {
  const { left, right } = offsetPolyline(polyline, w, closed)
  const Lc = closed ? [...left, left[0]] : left
  const Rc = closed ? [...right, right[0]] : right
  return Lc.slice(1).map((_, i) => groundRange(ground, [Lc[i], Lc[i + 1], Rc[i + 1], Rc[i]]))
}

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

/** Mesh group (material id) of each masonry kind; Step 4 paints them. */
export const MASONRY_GROUP: Record<Masonry, string> = { rubble: 'sanctuary-wall', ashlar: 'ashlar-wall', older: 'older-wall' }

interface Profile {
  socle: number
  mudbrick: number
  coping: number
  overhang: number
}
const NONE: Profile = { socle: 0, mudbrick: 0, coping: 0, overhang: 0 }

/**
 * Wall run along a polyline (mitred joints), standing on a hidden skirt below the lowest ground. Each segment
 * may carry a superstructure on its top: a socle in the wall's masonry, mudbrick, and a coping that projects
 * beyond both faces. Where neighbouring segments differ, the joint gets end faces for the difference only.
 */
export function wallRun(id: string, f: WallFeature, ctx: SanctuaryContext, col: Collector): Omit<GeneratorOutput, 'groups'> {
  const closed = !!f.closed
  const t = f.thickness.value
  const H = f.height.value
  const pts = closed ? [...f.polyline, f.polyline[0]] : f.polyline
  const nSeg = pts.length - 1
  const { left, right } = offsetPolyline(f.polyline, t, closed)
  const L = closed ? [...left, left[0]] : left
  const R = closed ? [...right, right[0]] : right
  const ranges = wallRanges(ctx.ground, f.polyline, t, closed)
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

  const prof: Profile[] = Array.from({ length: nSeg }, () => NONE)
  for (const p of f.parapets ?? [])
    for (const i of p.segments) {
      if (i >= nSeg || prof[i] !== NONE) throw new Error(`${id}: parapet segment ${i} missing or given twice`)
      prof[i] = { socle: p.socle.value, mudbrick: p.mudbrick.value, coping: p.coping.value, overhang: p.coping.value > 0 ? p.overhang.value : 0 }
    }
  const masonry = (i: number) => {
    const m = f.masonry ?? 'rubble'
    return col.get(MASONRY_GROUP[Array.isArray(m) ? (m[i] ?? m[m.length - 1]) : m])
  }
  const mud = col.get('mudbrick')
  const cop = col.get('wall-coping')
  const wideCache = new Map<number, { WL: Point2[]; WR: Point2[] }>()
  const wide = (o: number) => {
    let w = wideCache.get(o)
    if (!w) {
      const { left: wl, right: wr } = offsetPolyline(f.polyline, t + 2 * o, closed)
      w = { WL: closed ? [...wl, wl[0]] : wl, WR: closed ? [...wr, wr[0]] : wr }
      wideCache.set(o, w)
    }
    return w
  }
  // Heights over vertex k for a profile: socle top, narrow top (mudbrick top), full top (coping top).
  const ys = (k: number, p: Profile) => {
    const y1 = top[k] + p.socle
    const y2 = y1 + p.mudbrick
    return { y0: top[k], y1, y2, y3: y2 + p.coping }
  }

  /** Narrow (wall-width) face across the wall at vertex k between heights lo..hi, split by material. */
  const narrowEnd = (k: number, seg: number, p: Profile, lo: number, hi: number, dir: Vec3) => {
    const h = ys(k, p)
    for (const [a, b, m] of [
      [h.y0, h.y1, masonry(seg)],
      [h.y1, h.y2, mud],
    ] as const) {
      const y0 = Math.max(a, lo)
      const y1 = Math.min(b, hi)
      if (y1 - y0 > 1e-9) m.polygonFacing([P(L[k], y0), P(R[k], y0), P(R[k], y1), P(L[k], y1)], dir)
    }
  }
  const copingEnd = (k: number, p: Profile, lo: number, dir: Vec3) => {
    const h = ys(k, p)
    const y0 = Math.max(h.y2, lo)
    if (p.coping <= 0 || h.y3 - y0 <= 1e-9) return
    const { WL, WR } = wide(p.overhang)
    cop.polygonFacing([P(WL[k], y0), P(WR[k], y0), P(WR[k], h.y3), P(WL[k], h.y3)], dir)
  }

  const colliders: Collider[] = []
  for (let i = 0; i < nSeg; i++) {
    const j = i + 1
    const p = prof[i]
    const hi = ys(i, p)
    const hj = ys(j, p)
    const nL = leftOf(pts[i], pts[j])
    const nR: Vec3 = [-nL[0], 0, -nL[2]]
    const body = masonry(i)
    body.polygonFacing([P(L[i], bottom), P(L[j], bottom), P(L[j], hj.y1), P(L[i], hi.y1)], nL)
    body.polygonFacing([P(R[i], bottom), P(R[j], bottom), P(R[j], hj.y1), P(R[i], hi.y1)], nR)
    if (p.mudbrick > 0) {
      mud.polygonFacing([P(L[i], hi.y1), P(L[j], hj.y1), P(L[j], hj.y2), P(L[i], hi.y2)], nL)
      mud.polygonFacing([P(R[i], hi.y1), P(R[j], hj.y1), P(R[j], hj.y2), P(R[i], hi.y2)], nR)
    }
    if (p.coping > 0) {
      const { WL, WR } = wide(p.overhang)
      cop.polygonFacing([P(WL[i], hi.y2), P(WL[j], hj.y2), P(WL[j], hj.y3), P(WL[i], hi.y3)], nL)
      cop.polygonFacing([P(WR[i], hi.y2), P(WR[j], hj.y2), P(WR[j], hj.y3), P(WR[i], hi.y3)], nR)
      cop.polygonFacing([P(WL[i], hi.y3), P(WL[j], hj.y3), P(WR[j], hj.y3), P(WR[i], hi.y3)], [0, 1, 0])
      if (p.overhang > 0) {
        cop.polygonFacing([P(WL[i], hi.y2), P(WL[j], hj.y2), P(L[j], hj.y2), P(L[i], hi.y2)], [0, -1, 0])
        cop.polygonFacing([P(R[i], hi.y2), P(R[j], hj.y2), P(WR[j], hj.y2), P(WR[i], hi.y2)], [0, -1, 0])
      }
    } else (p.mudbrick > 0 ? mud : body).polygonFacing([P(L[i], hi.y2), P(L[j], hj.y2), P(R[j], hj.y2), P(R[i], hi.y2)], [0, 1, 0])
    colliders.push(segmentCollider(`${id}-${i}`, pts[i], pts[j], t, bottom, Math.max(hi.y3, hj.y3)))
  }

  // Joints between segments with different superstructures: end faces for the difference only.
  const joints = closed ? Array.from({ length: nSeg }, (_, k) => k) : Array.from({ length: Math.max(0, nSeg - 1) }, (_, k) => k + 1)
  for (const k of joints) {
    const a = (k - 1 + nSeg) % nSeg // segment ending at vertex k
    const b = k % nSeg // segment starting there
    const kk = closed && k === 0 ? nSeg : k // vertex index on segment a's side (same point)
    const A = prof[a]
    const B = prof[b]
    if (A === B) continue
    const dA: Vec3 = [pts[kk][0] - pts[kk - 1][0], 0, pts[kk][1] - pts[kk - 1][1]]
    const dB: Vec3 = [pts[k][0] - pts[k + 1][0], 0, pts[k][1] - pts[k + 1][1]]
    const hA = ys(kk, A)
    const hB = ys(k, B)
    // A's whole top covers the narrow section up to y3; its coping covers B's coping only if at least as wide.
    narrowEnd(k, b, B, hA.y3, hB.y2, dB)
    narrowEnd(kk, a, A, hB.y3, hA.y2, dA)
    copingEnd(k, B, A.overhang >= B.overhang ? hA.y3 : hA.y2, dB)
    copingEnd(kk, A, B.overhang >= A.overhang ? hB.y3 : hB.y2, dA)
  }
  if (!closed) {
    const n = nSeg
    const back: Vec3 = [pts[0][0] - pts[1][0], 0, pts[0][1] - pts[1][1]]
    const fwd: Vec3 = [pts[n][0] - pts[n - 1][0], 0, pts[n][1] - pts[n - 1][1]]
    for (const [k, seg, dir] of [
      [0, 0, back],
      [n, n - 1, fwd],
    ] as const) {
      masonry(seg).polygonFacing([P(L[k], bottom), P(R[k], bottom), P(R[k], top[k]), P(L[k], top[k])], dir)
      narrowEnd(k, seg, prof[seg], top[k], Infinity, dir)
      copingEnd(k, prof[seg], -Infinity, dir)
    }
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
  // Cut into the rock: the coping is flush with the (highest) ground instead of raised.
  const lip = f.sunk ? 0 : K.channelLipRatio * w
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
