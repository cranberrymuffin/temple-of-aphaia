// Pure walk collision (no `three`): a 0.3 m circle against the generator-emitted colliders (column circles,
// wall/anta/building boxes and oriented boxes, parapets, cheek walls), with slide response, sub-stepping
// (no tunnelling at any speed) and ground following over the levels with auto step-up.
import type { Collider, Level } from '../../geometry/types'
import { STEP_UP, surfaceAt } from './ground'

export const WALK_RADIUS = 0.3
/** Body height above the feet: a collider entirely above this (a door lintel) does not block. */
export const BODY_HEIGHT = 1.8
/** Longest sub-step, well under the thinnest blocker (a 0.3 m fence wall plus the 0.6 m body). */
export const MAX_SUBSTEP = 0.1

export interface WalkWorld {
  colliders: readonly Collider[]
  levels: readonly Level[]
}

export interface Feet {
  x: number
  y: number
  z: number
}

/** Does collider `c` reach into the body of a walker whose feet are at `feetY`? Low parts are stepped over. */
export function blocks(c: Collider, feetY: number): boolean {
  return c.y1 > feetY + STEP_UP && c.y0 < feetY + BODY_HEIGHT
}

/** Push (x, z) out of collider `c` to at least distance `r`; returns the corrected point or null if clear. */
export function pushOut(c: Collider, x: number, z: number, r: number): [number, number] | null {
  if (c.kind === 'circle') {
    const dx = x - c.x
    const dz = z - c.z
    const d = Math.hypot(dx, dz)
    const min = c.r + r
    if (d >= min) return null
    if (d < 1e-9) return [c.x + min, z]
    return [c.x + (dx / d) * min, c.z + (dz / d) * min]
  }
  // Boxes: work in the box frame (axis-aligned box = obb without rotation).
  const cx = c.kind === 'box' ? (c.minX + c.maxX) / 2 : c.cx
  const cz = c.kind === 'box' ? (c.minZ + c.maxZ) / 2 : c.cz
  const hx = c.kind === 'box' ? (c.maxX - c.minX) / 2 : c.halfX
  const hz = c.kind === 'box' ? (c.maxZ - c.minZ) / 2 : c.halfZ
  const rot = c.kind === 'obb' ? c.rotY : 0
  const co = Math.cos(rot)
  const si = Math.sin(rot)
  const wx = x - cx
  const wz = z - cz
  // World -> box frame is the inverse of Ry(rot): lx = c*wx - s*wz, lz = s*wx + c*wz.
  const lx = co * wx - si * wz
  const lz = si * wx + co * wz
  const qx = Math.max(-hx, Math.min(hx, lx))
  const qz = Math.max(-hz, Math.min(hz, lz))
  let nx: number
  let nz: number
  const dx = lx - qx
  const dz = lz - qz
  const d = Math.hypot(dx, dz)
  if (d >= r) return null
  if (d > 1e-9) {
    nx = qx + (dx / d) * r
    nz = qz + (dz / d) * r
  } else {
    // Centre inside the box: leave through the nearest face.
    const ex = hx - Math.abs(lx)
    const ez = hz - Math.abs(lz)
    if (ex < ez) {
      nx = Math.sign(lx || 1) * (hx + r)
      nz = lz
    } else {
      nx = lx
      nz = Math.sign(lz || 1) * (hz + r)
    }
  }
  // Box frame -> world: Ry(rot).
  return [cx + co * nx + si * nz, cz - si * nx + co * nz]
}

/** Separate (x, z) from every blocking collider (a few passes settle corners between two blockers). */
export function separate(world: WalkWorld, x: number, z: number, feetY: number, r = WALK_RADIUS): [number, number] {
  for (let pass = 0; pass < 4; pass++) {
    let moved = false
    for (const c of world.colliders) {
      if (!blocks(c, feetY)) continue
      const p = pushOut(c, x, z, r)
      if (p) {
        x = p[0]
        z = p[1]
        moved = true
      }
    }
    if (!moved) break
  }
  return [x, z]
}

/** Can a walker with feet at `feetY` stand at (x, z)? Returns the ground there, or NaN (no floor / a rise above the step-up). */
function standAt(world: WalkWorld, x: number, z: number, feetY: number): number {
  // The scene has no floors overhead, so the highest surface is the ground: a rise above the step-up is a wall.
  const g = surfaceAt(world.levels, x, z)
  return g > feetY + STEP_UP ? NaN : g
}

/**
 * Move a walker from `pos` (feet) by the horizontal `delta`. Sub-steps the move, slides along blockers,
 * refuses steps onto rises above STEP_UP or off the walkable area, and returns the new feet position with
 * y = the ground there (falling is the caller's concern: y never goes up by more than STEP_UP per sub-step).
 */
export function resolveMove(pos: Feet, delta: { x: number; z: number }, world: WalkWorld, r = WALK_RADIUS): Feet {
  const len = Math.hypot(delta.x, delta.z)
  const n = Math.max(1, Math.ceil(len / MAX_SUBSTEP))
  let { x, y, z } = pos
  const sx = delta.x / n
  const sz = delta.z / n
  for (let i = 0; i < n; i++) {
    // Try the full sub-step, then each axis alone (slide along a ledge or the edge of the walkable area).
    let done = false
    for (const [mx, mz] of [
      [sx, sz],
      [sx, 0],
      [0, sz],
    ]) {
      if (mx === 0 && mz === 0) continue
      const [cx, cz] = separate(world, x + mx, z + mz, y, r)
      const g = standAt(world, cx, cz, y)
      if (!Number.isFinite(g)) continue
      x = cx
      z = cz
      y = g
      done = true
      break
    }
    if (!done) break
  }
  return { x, y, z }
}
