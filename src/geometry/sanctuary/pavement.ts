// Paved surface (altar court, paved way): a slab of the given thickness on the terrain, convex outline.
import type { PavementFeature } from '../../data/sanctuary'
import type { Collector, Vec3 } from '../mesh'
import type { GeneratorOutput } from '../types'
import { SANCTUARY_CONVENTIONS as K, groundRange, type SanctuaryContext } from './common'

export function pavement(id: string, f: PavementFeature, ctx: SanctuaryContext, col: Collector): Omit<GeneratorOutput, 'groups'> {
  const poly = f.polygon
  const range = groundRange(ctx.ground, poly)
  const base = f.baseLevel !== undefined ? ctx.stylobateTop + f.baseLevel : range.max
  const topY = base + f.thickness.value
  const bottom = Math.min(base, range.min) - K.skirt
  const b = col.get('pavement')
  const P = (p: [number, number], y: number): Vec3 => [p[0], y, p[1]]
  b.polygonFacing(poly.map((p) => P(p, topY)), [0, 1, 0])
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length
  const cz = poly.reduce((a, p) => a + p[1], 0) / poly.length
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const c = poly[(i + 1) % poly.length]
    b.polygonFacing([P(a, bottom), P(c, bottom), P(c, topY), P(a, topY)], [(a[0] + c[0]) / 2 - cx, 0, (a[1] + c[1]) / 2 - cz])
  }
  return {
    instances: [],
    colliders: [],
    levels: [
      {
        name: `${id}-pavement`,
        y: topY,
        minX: Math.min(...poly.map((p) => p[0])),
        maxX: Math.max(...poly.map((p) => p[0])),
        minZ: Math.min(...poly.map((p) => p[1])),
        maxZ: Math.max(...poly.map((p) => p[1])),
        polygon: poly,
      },
    ],
  }
}
