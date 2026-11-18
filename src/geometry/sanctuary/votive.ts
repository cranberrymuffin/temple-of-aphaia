// Votive column: round base, fluted shaft (shared Doric shaft generator, no entasis or neck rings),
// a volute-capital block and a sphinx stand-in (blocky seated figure). Shape is by analogy only.
import type { ColumnSpec } from '../../data/resolveDimensions'
import type { ColumnFeature } from '../../data/sanctuary'
import { addShaft } from '../column'
import type { Collector, Vec3 } from '../mesh'
import { MeshBuilder, composeMatrix } from '../mesh'
import type { GeneratorOutput } from '../types'
import type { GroupRange } from '../figures'

/** Where a scanned sphinx replaces the stand-in: capital top centre (world), its plan half-size, the crowning height. */
export interface SphinxSlot {
  x: number
  y: number
  z: number
  halfX: number
  halfZ: number
  height: number
  ranges: GroupRange[]
}
import { SANCTUARY_CONVENTIONS as K, groundRange, type SanctuaryContext } from './common'
import { footprints } from '../../data/sanctuary'

export const BASE_SIDES = { low: 16, med: 24, high: 32 } as const

export function votiveColumn(id: string, f: ColumnFeature, ctx: SanctuaryContext, col: Collector): Omit<GeneratorOutput, 'groups'> & { sphinxSlot?: SphinxSlot } {
  const range = groundRange(ctx.ground, footprints(f)[0])
  const g = f.baseLevel !== undefined ? ctx.stylobateTop + f.baseLevel : range.max
  const bottom = Math.min(g, range.min) - K.skirt
  const bh = f.baseHeight.value
  const capH = f.capital.height.value
  const shaftH = f.height.value - capH
  const b = new MeshBuilder('votive-column')
  // Base disc (no bottom; top under the shaft is kept: the shaft has no bottom cap and is narrower).
  const n = BASE_SIDES[ctx.tier]
  const R = f.baseDiameter.value / 2
  const ring = (y: number): Vec3[] => Array.from({ length: n }, (_, i) => [R * Math.cos((2 * Math.PI * i) / n), y, R * Math.sin((2 * Math.PI * i) / n)])
  const lo = ring(bottom - g)
  const hi = ring(bh)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    b.polygonFacing([lo[i], lo[j], hi[j], hi[i]], [(hi[i][0] + hi[j][0]) / 2, 0, (hi[i][2] + hi[j][2]) / 2])
  }
  b.polygonFacing(hi, [0, 1, 0])
  // Shaft (local y from the base top).
  const spec: ColumnSpec = {
    height: shaftH,
    shaftHeight: shaftH,
    lowerRadius: f.lowerDiameter.value / 2,
    upperRadius: f.upperDiameter.value / 2,
    entasis: 0,
    entasisPeak: 0.4,
    flutes: f.flutes.value,
    fluteDepthRatio: 0.12,
    neckRings: [],
    neckRingDepth: 0,
    // Unused by addShaft (the capital is built below).
    echinusHeight: 0,
    echinusTopRadius: 0,
    abacusHeight: 0,
    abacusWidth: 0,
  }
  const shaft = new MeshBuilder('votive-column')
  addShaft(shaft, spec, ctx.tier)
  b.append(shaft, composeMatrix([0, bh, 0], 0))
  // Volute capital: a cushion block wider along x (the volute axis), sitting on the shaft top.
  const cw = f.capital.width.value / 2
  const cd = f.upperDiameter.value / 2 + 0.02
  const y0 = bh + shaftH
  // Its bottom face closes the open shaft top (the shaft has no top cap).
  b.box([-cw, y0, -cd], [cw, y0 + capH, cd])
  let sphinxSlot: SphinxSlot | undefined
  if (f.crowning) {
    // Sphinx stand-in: plinth, body, raised chest/head, sickle wing; blocky on purpose (Step 4 replaces it).
    const h = f.crowning.height.value
    const y1 = y0 + capH
    const s = new MeshBuilder('sphinx')
    s.box([-cw * 0.8, y1, -cd * 0.8], [cw * 0.8, y1 + h * 0.08, cd * 0.8], ['-y'])
    s.box([-cw * 0.7, y1 + h * 0.08, -cd * 0.55], [cw * 0.35, y1 + h * 0.38, cd * 0.55], ['-y', '+x'])
    s.box([cw * 0.35, y1 + h * 0.08, -cd * 0.55], [cw * 0.75, y1 + h * 0.85, cd * 0.55], ['-y'])
    s.box([-cw * 0.55, y1 + h * 0.38, -cd * 0.08], [cw * 0.1, y1 + h * 0.95, cd * 0.08], ['-y'])
    const sg = col.get('sphinx')
    const start = sg.idx.length
    sg.append(s, composeMatrix([f.center[0], g, f.center[1]], 0))
    sphinxSlot = { x: f.center[0], y: g + y1, z: f.center[1], halfX: cw, halfZ: cd, height: h, ranges: [{ group: 'sphinx', start, count: sg.idx.length - start }] }
  }
  col.get('votive-column').append(b, composeMatrix([f.center[0], g, f.center[1]], 0))
  return {
    instances: [],
    colliders: [{ kind: 'circle', name: `${id}-column`, x: f.center[0], z: f.center[1], r: R, y0: bottom, y1: g + bh + f.height.value }],
    levels: [],
    sphinxSlot,
  }
}
