// Pure walkable-surface queries over the generator-emitted levels (no `three`): flat boxes (optionally
// rotated), terrace polygons, the east ramp (slopeX) and the terrain heightfield (0.5 m walk grid).
import { pointInPolygon } from '../../data/polygon'
import { sampleHeight } from '../../geometry/sanctuary/terrain'
import type { Heightfield, Level } from '../../geometry/types'

/** Highest rise a walker steps up without a wall (the krepis steps are 0.26 m, the propylon steps 0.30 m). */
export const STEP_UP = 0.55

/** Height of `level` at (x, z), or NaN when the point is outside it. */
export function levelHeight(l: Level, x: number, z: number): number {
  if (l.heightfield) return sampleHeight(l.heightfield, x, z)
  let lx = x
  let lz = z
  if (l.rotY) {
    // Box rotated about its centre: bring the point into the box frame (inverse of Ry(rotY)).
    const cx = (l.minX + l.maxX) / 2
    const cz = (l.minZ + l.maxZ) / 2
    const c = Math.cos(l.rotY)
    const s = Math.sin(l.rotY)
    const dx = x - cx
    const dz = z - cz
    lx = cx + c * dx - s * dz
    lz = cz + s * dx + c * dz
  }
  if (lx < l.minX || lx > l.maxX || lz < l.minZ || lz > l.maxZ) return NaN
  if (l.polygon && !pointInPolygon(l.polygon, [x, z])) return NaN
  return l.slopeX === undefined ? l.y : l.y + l.slopeX * (lx - l.minX)
}

/**
 * Ground under a walker at (x, z) whose feet are at `feetY`: the highest surface that is no more than
 * `stepUp` above the feet (so a floor overhead never captures the walker). NaN when nothing is walkable.
 */
export function groundAt(levels: readonly Level[], x: number, z: number, feetY = Infinity, stepUp = STEP_UP): number {
  let best = -Infinity
  const limit = feetY + stepUp
  for (const l of levels) {
    const h = levelHeight(l, x, z)
    if (h > best && h <= limit) best = h
  }
  return best === -Infinity ? NaN : best
}

/** Highest surface at (x, z) regardless of the feet (for the orbit camera's ground clamp). */
export function surfaceAt(levels: readonly Level[], x: number, z: number): number {
  return groundAt(levels, x, z, Infinity, 0)
}

/** The terrain heightfield level, if any. */
export function terrainField(levels: readonly Level[]): Heightfield | undefined {
  return levels.find((l) => l.heightfield)?.heightfield
}

/**
 * Orbit ground clamp: the highest surface at (x, z), with the terrain grid clamped to its edge beyond the
 * modelled site (the hill falls away to the sea outside it, so the edge height is conservative).
 */
export function orbitGround(levels: readonly Level[], x: number, z: number): number {
  const h = surfaceAt(levels, x, z)
  if (Number.isFinite(h)) return h
  const hf = terrainField(levels)
  if (!hf) return 0
  const maxX = hf.originX + (hf.nx - 1) * hf.cell
  const maxZ = hf.originZ + (hf.nz - 1) * hf.cell
  const e = sampleHeight(hf, Math.min(maxX, Math.max(hf.originX, x)), Math.min(maxZ, Math.max(hf.originZ, z)))
  return Number.isFinite(e) ? e : 0
}
