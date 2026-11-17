// Shared helpers for the sanctuary generators. Pure (no `three`).
// Features sit on the terrain: their visible base is lifted to the highest ground under the footprint,
// and every outer face continues down a hidden skirt below the lowest ground, so sloping terrain never
// leaves a gap. Terrain cut by the footprints (terrain.ts) never overlaps a feature face.
import type { Point2 } from '../../data/sanctuary'
import type { Collider, Tier } from '../types'

export type GroundFn = (x: number, z: number) => number

export interface SanctuaryContext {
  ground: GroundFn
  tier: Tier
  /** Absolute y of the stylobate top: levels in the data are relative to it. */
  stylobateTop: number
}

/** Proportional conventions (no measurements). Logged by the caller with the feature report. */
export const SANCTUARY_CONVENTIONS = {
  /** Hidden skirt below the lowest ground under a footprint (m); never visible. */
  skirt: 0.3,
  /** Building floor / socle rise above the highest ground, as a fraction of the wall thickness. */
  floorRiseRatio: 0.25,
  /** Channel coping above the highest ground along an edge, and coping width, as fractions of the channel width. */
  channelLipRatio: 0.08,
  channelCopingRatio: 0.25,
  /** Roof slab vertical thickness (m), hidden detail scale. */
  roofThickness: 0.18,
  /** Ground sampling step for footprint ranges (m). */
  sampleStep: 0.25,
} as const

export const deg = (d: number) => (d * Math.PI) / 180

/** Min/max ground over a convex polygon (sampled on a grid plus its vertices). */
export function groundRange(ground: GroundFn, poly: Point2[], step: number = SANCTUARY_CONVENTIONS.sampleStep) {
  let min = Infinity
  let max = -Infinity
  const take = (x: number, z: number) => {
    const h = ground(x, z)
    if (Number.isFinite(h)) {
      min = Math.min(min, h)
      max = Math.max(max, h)
    }
  }
  for (const p of poly) take(p[0], p[1])
  const xs = poly.map((p) => p[0])
  const zs = poly.map((p) => p[1])
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += step)
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += step) if (insideConvex(poly, [x, z])) take(x, z)
  if (!Number.isFinite(min)) throw new Error('no ground under footprint')
  return { min, max }
}

/** Point in a convex polygon of either winding (boundary counts as inside). */
export function insideConvex(poly: Point2[], p: Point2): boolean {
  let sign = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
    if (Math.abs(c) < 1e-12) continue
    const s = Math.sign(c)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/** Local (x along length, z along width) to world for a feature centred at c with rotation rotDeg. */
export function localToWorld(c: Point2, rotDeg: number) {
  const a = deg(rotDeg)
  const cs = Math.cos(a)
  const sn = Math.sin(a)
  return (x: number, z: number): Point2 => [c[0] + cs * x + sn * z, c[1] - sn * x + cs * z]
}

export function obb(name: string, c: Point2, halfX: number, halfZ: number, rotDeg: number, y0: number, y1: number): Collider {
  return { kind: 'obb', name, cx: c[0], cz: c[1], halfX, halfZ, rotY: deg(rotDeg), y0, y1 }
}

/**
 * Offset a polyline by +-w/2 with mitred joints. Returns left and right point lists (left = +90 deg from
 * the direction of travel, seen from above with x east and z south).
 */
export function offsetPolyline(pts: Point2[], w: number, closed = false): { left: Point2[]; right: Point2[] } {
  const n = pts.length
  const dir = (i: number): Point2 => {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
  }
  const left: Point2[] = []
  const right: Point2[] = []
  for (let i = 0; i < n; i++) {
    const hasPrev = closed || i > 0
    const hasNext = closed || i < n - 1
    const dPrev = hasPrev ? dir((i - 1 + n) % n) : dir(i)
    const dNext = hasNext ? dir(i) : dPrev
    // Normals pointing left of travel: (dz, -dx) rotates x-east toward north (-z), i.e. left seen from above.
    const n0: Point2 = [dPrev[1], -dPrev[0]]
    const n1: Point2 = [dNext[1], -dNext[0]]
    let mx = n0[0] + n1[0]
    let mz = n0[1] + n1[1]
    const ml = Math.hypot(mx, mz)
    mx /= ml
    mz /= ml
    const scale = w / 2 / Math.max(0.25, mx * n1[0] + mz * n1[1])
    const p = pts[i]
    left.push([p[0] + mx * scale, p[1] + mz * scale])
    right.push([p[0] - mx * scale, p[1] - mz * scale])
  }
  return { left, right }
}
