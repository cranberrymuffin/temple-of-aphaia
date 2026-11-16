// Basic ground: one upward quad at y = 0 under and around the krepis (whose bottom faces are omitted).
import type { Resolved } from '../data/resolveDimensions'
import type { Collector } from './mesh'
import type { GeneratorOutput } from './types'

/** Ground half-extent as a multiple of the stylobate half-length (scenery, not architecture). */
const GROUND_EXTENT = 5

export function ground(r: Resolved, col: Collector): Omit<GeneratorOutput, 'groups'> {
  const h = r.stylobate.halfX * GROUND_EXTENT
  col.get('ground').polygonFacing(
    [
      [-h, 0, -h],
      [h, 0, -h],
      [h, 0, h],
      [-h, 0, h],
    ],
    [0, 1, 0],
  )
  return { instances: [], colliders: [], levels: [{ name: 'ground', y: 0, minX: -h, maxX: h, minZ: -h, maxZ: h }] }
}
