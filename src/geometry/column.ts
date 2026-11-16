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

/** Profile stations along the shaft: height, and the scale applied to the fluted section (grooves < 1). */
export function shaftStations(c: ColumnSpec, tier: Tier): { y: number; scale: number }[] {
  const rings = SHAFT_RINGS[tier]
  const st: { y: number; scale: number }[] = []
  const grooves = c.neckRings.map((g) => ({ y0: c.shaftHeight - g.top - g.height, y1: c.shaftHeight - g.top }))
  const inGroove = (y: number) => grooves.some((g) => y > g.y0 + 1e-9 && y < g.y1 - 1e-9)
  for (let i = 0; i <= rings; i++) {
    const y = (i / rings) * c.shaftHeight
    if (!inGroove(y) && !grooves.some((g) => Math.abs(y - g.y0) < 1e-9 || Math.abs(y - g.y1) < 1e-9)) st.push({ y, scale: 1 })
  }
  const k = 1 - c.neckRingDepth / arrisRadius(c, 1)
  for (const g of grooves) st.push({ y: g.y0, scale: 1 }, { y: g.y0, scale: k }, { y: g.y1, scale: k }, { y: g.y1, scale: 1 })
  // Stable order: by height; at a step the ring order (outer->inner or inner->outer) is kept from the push order.
  return st.map((x, i) => ({ ...x, i })).sort((a, b) => a.y - b.y || a.i - b.i).map(({ y, scale }) => ({ y, scale }))
}

/** Emits the fluted shaft (with incised neck rings) into `b`. */
export function addShaft(b: MeshBuilder, c: ColumnSpec, tier: Tier) {
  const segs = SEGMENTS_PER_FLUTE[tier]
  const stations = shaftStations(c, tier)
  // Split into runs of lateral surface separated by horizontal steps (same y, different scale).
  const bands: { from: number; to: number; step: boolean }[] = []
  let runStart = 0
  for (let i = 1; i < stations.length; i++) {
    if (Math.abs(stations[i].y - stations[i - 1].y) < 1e-9) {
      if (i - 1 > runStart) bands.push({ from: runStart, to: i - 1, step: false })
      bands.push({ from: i - 1, to: i, step: true })
      runStart = i
    }
  }
  if (stations.length - 1 > runStart) bands.push({ from: runStart, to: stations.length - 1, step: false })

  for (let k = 0; k < c.flutes; k++) {
    for (const band of bands) {
      const base = b.vertexCount
      for (let i = band.from; i <= band.to; i++) {
        const { y, scale } = stations[i]
        const u = y / c.shaftHeight
        const R = arrisRadius(c, u) * scale
        const slope = arrisSlope(c, u) * scale
        const { pts, nrm } = fluteProfile(R, c.flutes, k, segs, c.fluteDepthRatio)
        const stepUp = band.step && stations[band.from].scale > stations[band.to].scale
        for (let j = 0; j <= segs; j++) {
          const [px, pz] = pts[j]
          const [nx, nz] = nrm[j]
          let n: Vec3
          if (band.step) n = [0, stepUp ? 1 : -1, 0]
          else {
            // Tilt the normal up by the taper: n_y = -dR/dh * (n . radial).
            const rl = Math.hypot(px, pz)
            const radial = (nx * px + nz * pz) / rl
            n = norm([nx, -slope * radial, nz])
          }
          const arc = Math.atan2(pz, px) * c.lowerRadius
          b.vertex([px, y, pz], n, [arc, band.step ? Math.hypot(px, pz) : y])
        }
      }
      const row = segs + 1
      for (let i = 0; i < band.to - band.from; i++)
        for (let j = 0; j < segs; j++) {
          const a = base + i * row + j
          const up = a + row
          b.tri(a, up, a + 1)
          b.tri(up, up + 1, a + 1)
        }
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
