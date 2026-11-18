// Krepis: stepped platform whose top course is the stylobate. Optional source-gated east ramp.
// Step bottoms are omitted (each rests on the course below, the lowest on the ground).
import type { Resolved } from '../data/resolveDimensions'
import type { Collector } from './mesh'
import type { GeneratorOutput, Level } from './types'

export function crepidoma(r: Resolved, col: Collector): Omit<GeneratorOutput, 'groups'> {
  const steps = r.crepidoma.steps
  steps.forEach((s, i) => {
    const b = col.get(i === steps.length - 1 ? 'stylobate' : 'crepidoma')
    b.box([-s.halfX, s.y0, -s.halfZ], [s.halfX, s.y1, s.halfZ], ['-y'])
  })
  const levels: Level[] = r.levels
    .filter((l) => l.name === 'stylobate' || l.name.startsWith('step-'))
    .map((l) => ({ name: l.name, y: l.y, ...l.box }))

  if (r.ramp) {
    const rp = r.ramp
    const b = col.get('ramp')
    const z0 = -rp.halfZ
    const z1 = rp.halfZ
    // Sloped top, from (minX, topY) down to (maxX, 0).
    b.polygonFacing(
      [
        [rp.minX, rp.topY, z0],
        [rp.minX, rp.topY, z1],
        [rp.maxX, 0, z1],
        [rp.maxX, 0, z0],
      ],
      [1, 1, 0],
    )
    b.polygonFacing([[rp.minX, 0, z1], [rp.maxX, 0, z1], [rp.minX, rp.topY, z1]], [0, 0, 1])
    b.polygonFacing([[rp.minX, 0, z0], [rp.minX, rp.topY, z0], [rp.maxX, 0, z0]], [0, 0, -1])
    // Fill over the lower treads up to the ramp top (bottom on the tread, back against the next step, front inside the ramp).
    for (const f of rp.fills) b.box([f.minX, f.y0, z0], [f.maxX, rp.topY, z1], ['-y', '-x', '+x'])
    for (const f of rp.fills) levels.push({ name: 'ramp-fill', y: rp.topY, minX: f.minX, maxX: f.maxX, minZ: z0, maxZ: z1 })
    levels.push({ name: 'ramp', y: rp.topY, minX: rp.minX, maxX: rp.maxX, minZ: z0, maxZ: z1, slopeX: -rp.topY / (rp.maxX - rp.minX) })
  }
  return { instances: [], colliders: [], levels }
}
