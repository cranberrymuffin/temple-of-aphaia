// Pediments: tympanum fields recessed to the frieze plane, sitting on the horizontal cornice and closed
// above by the raking geison (the roof slab's gable band and soffit, see roof.ts).
// Step 4 places the figure stand-ins inside resolved.pediment.
import type { Resolved } from '../data/resolveDimensions'
import type { Collector } from './mesh'
import type { GeneratorOutput } from './types'

export function pediment(r: Resolved, col: Collector): Omit<GeneratorOutput, 'groups'> {
  const { tympanumX: X, baseY, halfZ, apexY } = r.pediment
  const b = col.get('tympanum')
  for (const sx of [1, -1]) {
    b.polygonFacing(
      [
        [sx * X, baseY, halfZ],
        [sx * X, baseY, -halfZ],
        [sx * X, apexY, 0],
      ],
      [sx, 0, 0],
    )
  }
  return { instances: [], colliders: [], levels: [] }
}
