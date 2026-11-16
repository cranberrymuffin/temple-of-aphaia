// Fluted Doric shaft with entasis. Local frame: base centre on the stylobate at the origin, y up.
// The bottom cap is omitted (it rests on the stylobate) and so is the top cap (under the echinus).
import type { ColumnSpec } from '../data/resolveDimensions'
import type { MeshBuilder, Vec3 } from './mesh'
import { norm } from './mesh'
import type { Tier } from './types'

export const SEGMENTS_PER_FLUTE: Record<Tier, number> = { low: 2, med: 3, high: 6 }
export const SHAFT_RINGS: Record<Tier, number> = { low: 6, med: 10, high: 16 }

/** Arris radius at height fraction u (0 = base, 1 = top of shaft). */
export function arrisRadius(c: ColumnSpec, u: number): number {
  const a = c.entasisPeak
  const bump = u < a ? 1 - ((a - u) / a) ** 2 : 1 - ((u - a) / (1 - a)) ** 2
  return c.lowerRadius + (c.upperRadius - c.lowerRadius) * u + c.entasis * bump
}

function arrisSlope(c: ColumnSpec, u: number): number {
  const du = 1e-4
  const u0 = Math.max(0, u - du)
  const u1 = Math.min(1, u + du)
  return (arrisRadius(c, u1) - arrisRadius(c, u0)) / ((u1 - u0) * c.shaftHeight)
}

/**
 * Points (x, z) and outward normals of one flute's circular-arc profile between two arrises,
 * at arris radius R. j = 0 and j = segs are the arrises.
 */
export function fluteProfile(R: number, flutes: number, k: number, segs: number, depthRatio: number) {
  const d = (2 * Math.PI) / flutes
  const tm = (k + 0.5) * d
  const mx = Math.cos(tm)
  const mz = Math.sin(tm)
  const tx = -mz
  const tz = mx
  const half = R * Math.sin(d / 2)
  const s = depthRatio * 2 * half
  const rho = (half * half + s * s) / (2 * s)
  const phi0 = Math.asin(half / rho)
  const oR = R * Math.cos(d / 2) - s + rho
  const ox = mx * oR
  const oz = mz * oR
  const pts: [number, number][] = []
  const nrm: [number, number][] = []
  for (let j = 0; j <= segs; j++) {
    const phi = -phi0 + (2 * phi0 * j) / segs
    const px = ox + rho * (-Math.cos(phi) * mx + Math.sin(phi) * tx)
    const pz = oz + rho * (-Math.cos(phi) * mz + Math.sin(phi) * tz)
    pts.push([px, pz])
    nrm.push([(ox - px) / rho, (oz - pz) / rho])
  }
  // Snap the ends exactly onto the arrises so neighbouring flutes share them.
  const a0 = k * d
  const a1 = (k + 1) * d
  pts[0] = [R * Math.cos(a0), R * Math.sin(a0)]
  pts[segs] = [R * Math.cos(a1), R * Math.sin(a1)]
  return { pts, nrm }
}

/** Emits the fluted shaft into `b`. */
export function addShaft(b: MeshBuilder, c: ColumnSpec, tier: Tier) {
  const segs = SEGMENTS_PER_FLUTE[tier]
  const rings = SHAFT_RINGS[tier]
  for (let k = 0; k < c.flutes; k++) {
    const base = b.vertexCount
    for (let i = 0; i <= rings; i++) {
      const u = i / rings
      const y = u * c.shaftHeight
      const R = arrisRadius(c, u)
      const slope = arrisSlope(c, u)
      const { pts, nrm } = fluteProfile(R, c.flutes, k, segs, c.fluteDepthRatio)
      for (let j = 0; j <= segs; j++) {
        const [px, pz] = pts[j]
        const [nx, nz] = nrm[j]
        // Tilt the normal up by the taper: n_y = -dR/dh * (n . radial).
        const rl = Math.hypot(px, pz)
        const radial = (nx * px + nz * pz) / rl
        const n: Vec3 = norm([nx, -slope * radial, nz])
        const arc = Math.atan2(pz, px) * c.lowerRadius
        b.vertex([px, y, pz], n, [arc, y])
      }
    }
    const row = segs + 1
    for (let i = 0; i < rings; i++)
      for (let j = 0; j < segs; j++) {
        const a = base + i * row + j
        const up = a + row
        b.tri(a, up, a + 1)
        b.tri(up, up + 1, a + 1)
      }
  }
}

/**
 * Downward-facing cover between the fluted shaft top (radius R) and a smooth circle of radius R placed
 * on top of it (the echinus), so the flute recesses are closed when seen from below.
 */
export function addFluteCover(b: MeshBuilder, c: ColumnSpec, tier: Tier, y: number) {
  const segs = SEGMENTS_PER_FLUTE[tier]
  const R = arrisRadius(c, 1)
  const d = (2 * Math.PI) / c.flutes
  for (let k = 0; k < c.flutes; k++) {
    const { pts } = fluteProfile(R, c.flutes, k, segs, c.fluteDepthRatio)
    for (let j = 0; j < segs; j++) {
      const q0 = k * d + (j * d) / segs
      const q1 = k * d + ((j + 1) * d) / segs
      const P0: Vec3 = [pts[j][0], y, pts[j][1]]
      const P1: Vec3 = [pts[j + 1][0], y, pts[j + 1][1]]
      const Q0: Vec3 = [R * Math.cos(q0), y, R * Math.sin(q0)]
      const Q1: Vec3 = [R * Math.cos(q1), y, R * Math.sin(q1)]
      // Facing down (-y): order P0, P1, Q1, Q0 winds clockwise seen from above.
      const tris: Vec3[][] = [
        [P0, P1, Q1],
        [P0, Q1, Q0],
      ]
      for (const t of tris) {
        const ax = t[1][0] - t[0][0]
        const az = t[1][2] - t[0][2]
        const bx = t[2][0] - t[0][0]
        const bz = t[2][2] - t[0][2]
        const crossY = az * bx - ax * bz
        if (Math.abs(crossY) < 1e-10) continue
        b.polygon(crossY < 0 ? t : [t[0], t[2], t[1]])
      }
    }
  }
}

/** Angular samples matching the flute tessellation (arrises plus uniform in-flute steps). */
export function ringAngles(c: ColumnSpec, tier: Tier): number[] {
  const n = c.flutes * SEGMENTS_PER_FLUTE[tier]
  return Array.from({ length: n + 1 }, (_, i) => (2 * Math.PI * i) / n)
}
