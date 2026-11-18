// Cult statue in the naos (Step 4b). Furtwängler et al. 1906, p. 43: an unstuccoed patch of 92 x 112 cm in
// the 9th and 10th rows of floor slabs of the central aisle marks the base of the cult image, set at the
// boundary of the second third of the cella length; the image was small and probably seated (the base is
// elongated), with fine light-blue paint on the stucco where it rose against the plinth. Here: a base on
// that footprint (long side along the axis) carrying a stand-in until a scan loads. Pure: no `three`.
import type { Resolved } from '../data/resolveDimensions'
import type { Collector } from './mesh'
import { poseParts, type GroupRange } from './figures'
import type { Collider, GeneratorOutput } from './types'

export const CULT_CONVENTIONS = {
  /** Base footprint (m): sourced, p. 43. Long side along the temple axis. */
  baseLength: 1.12,
  baseWidth: 0.92,
  /** Base height: not given in the source (CONVENTION). */
  baseHeight: 0.3,
  /** Position along the naos from its east (door) wall: the boundary of the second third (p. 43). */
  fractionFromDoor: 2 / 3,
  /** Stand-in height (m), CONVENTION. */
  standInHeight: 1.7,
}

export interface CultSlot {
  x: number
  z: number
  baseTopY: number
  halfX: number
  halfZ: number
  ranges: GroupRange[]
}

export function cultStatue(r: Resolved, col: Collector): Omit<GeneratorOutput, 'groups'> & { slot: CultSlot } {
  const K = CULT_CONVENTIONS
  const C = r.cella
  const eastInner = C.eastWallX[0]
  const westInner = C.westWallX[1]
  const x = eastInner - K.fractionFromDoor * (eastInner - westInner)
  const hx = K.baseLength / 2
  const hz = K.baseWidth / 2
  const top = C.floorY + K.baseHeight
  col.get('cult-base').box([x - hx, C.floorY, -hz], [x + hx, top, hz], ['-y'])

  const b = col.get('cult-statue')
  const start = b.idx.length
  const s = K.standInHeight
  for (const p of poseParts('standing', { archer: false, athena: true })) {
    b.beginPart(p.paint)
    // Local x (depth) along the temple axis, local z across it: the stand-in faces east, toward the door.
    b.box(
      [x + p.min[0] * s, top + p.min[1] * s, p.min[2] * s],
      [x + p.max[0] * s, top + p.max[1] * s, p.max[2] * s],
      p.grounded && p.min[1] === 0 ? ['-y'] : [],
    )
  }
  b.endPart()
  const colliders: Collider[] = [{ kind: 'box', name: 'cult-statue-base', minX: x - hx, maxX: x + hx, minZ: -hz, maxZ: hz, y0: C.floorY, y1: top + s }]
  return {
    instances: [],
    colliders,
    levels: [],
    slot: { x, z: 0, baseTopY: top, halfX: hx, halfZ: hz, ranges: [{ group: 'cult-statue', start, count: b.idx.length - start }] },
  }
}
