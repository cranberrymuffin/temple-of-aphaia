// Doric capital: echinus (lathe) + square abacus. Local frame as the shaft (y from the column base).
// Hidden contact faces omitted: echinus bottom/top caps; abacus top when an architrave rests on it.
import type { ColumnSpec } from '../data/resolveDimensions'
import type { MeshBuilder, Vec3 } from './mesh'
import { norm } from './mesh'
import { addFluteCover, arrisRadius, ringAngles } from './column'
import type { Tier } from './types'

export const ECHINUS_RINGS: Record<Tier, number> = { low: 3, med: 5, high: 8 }

/** Echinus radius at fraction s of its height: quick flare, then rounds into the abacus. */
export function echinusRadius(c: ColumnSpec, s: number): number {
  const r0 = arrisRadius(c, 1)
  return r0 + (c.echinusTopRadius - r0) * (1 - (1 - s) ** 2)
}

export function addEchinus(echinus: MeshBuilder, c: ColumnSpec, tier: Tier) {
  const y0 = c.shaftHeight
  addFluteCover(echinus, c, tier, y0)
  const angles = ringAngles(c, tier)
  const rings = ECHINUS_RINGS[tier]
  const base = echinus.vertexCount
  const r0 = arrisRadius(c, 1)
  for (let i = 0; i <= rings; i++) {
    const s = i / rings
    const y = y0 + s * c.echinusHeight
    const r = echinusRadius(c, s)
    const drdy = (2 * (1 - s) * (c.echinusTopRadius - r0)) / c.echinusHeight
    for (const a of angles) {
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      const n: Vec3 = norm([ca, -drdy, sa])
      echinus.vertex([r * ca, y, r * sa], n, [a * r0, y])
    }
  }
  const row = angles.length
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < row - 1; j++) {
      const a = base + i * row + j
      const up = a + row
      echinus.tri(a, up, a + 1)
      echinus.tri(up, up + 1, a + 1)
    }
}

/** Square abacus; its top is omitted when an architrave or epistyle rests on it. */
export function addAbacus(abacus: MeshBuilder, c: ColumnSpec, top: boolean) {
  const h = c.abacusWidth / 2
  const ya = c.shaftHeight + c.echinusHeight
  abacus.box([-h, ya, -h], [h, ya + c.abacusHeight, h], top ? [] : ['+y'])
}
