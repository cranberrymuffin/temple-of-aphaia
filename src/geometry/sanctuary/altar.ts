// Parametric altar: rectangular block with an optional flight of steps (prothysis) along one side.
import type { AltarFeature, BaseFeature } from '../../data/sanctuary'
import { footprints } from '../../data/sanctuary'
import type { Collector, Face, Vec3 } from '../mesh'
import { MeshBuilder, composeMatrix, transformPoint } from '../mesh'
import type { GeneratorOutput, Level } from '../types'
import { SANCTUARY_CONVENTIONS as K, deg, groundRange, obb, type SanctuaryContext } from './common'

/** Altar (with an optional flight of steps up to it) or a plain statue base ('base' kind). */
export function altar(id: string, f: AltarFeature | BaseFeature, ctx: SanctuaryContext, col: Collector): Omit<GeneratorOutput, 'groups'> {
  const L = f.length.value
  const W = f.width.value
  const H = f.height.value
  const ranges = footprints(f).map((poly) => groundRange(ctx.ground, poly))
  const range = { min: Math.min(...ranges.map((r) => r.min)), max: Math.max(...ranges.map((r) => r.max)) }
  const base = f.baseLevel !== undefined ? ctx.stylobateTop + f.baseLevel : range.max
  const bottom = Math.min(base, range.min) - K.skirt
  const m = composeMatrix([f.center[0], 0, f.center[1]], deg(f.rotation))
  const b = new MeshBuilder(f.kind === 'altar' ? 'altar' : 'statue-base')
  const hx = L / 2
  const hz = W / 2
  b.box([-hx, bottom, -hz], [hx, base + H, hz], ['-y'])
  const levels: Level[] = []
  if (f.kind === 'altar' && f.steps) {
    const n = f.steps.count.value
    const rise = f.steps.rise.value
    const tread = f.steps.tread.value
    if (n * rise > H) throw new Error(`${id}: altar steps taller than the altar`)
    // Steps against the given face: step k reaches (n - k) treads out and (k + 1) rises up.
    const side = f.steps.side
    const toAltar: Face = { e: '-x', w: '+x', n: '+z', s: '-z' }[side] as Face
    for (let k = 0; k < n; k++) {
      const out = (n - k) * tread
      const y0 = k === 0 ? bottom : base + k * rise
      const y1 = base + (k + 1) * rise
      let min: Vec3
      let max: Vec3
      if (side === 'e') [min, max] = [[hx, y0, -hz], [hx + out, y1, hz]]
      else if (side === 'w') [min, max] = [[-hx - out, y0, -hz], [-hx, y1, hz]]
      else if (side === 's') [min, max] = [[-hx, y0, hz], [hx, y1, hz + out]]
      else [min, max] = [[-hx, y0, -hz - out], [hx, y1, -hz]]
      b.box(min, max, ['-y', toAltar])
      const c = transformPoint(m, [(min[0] + max[0]) / 2, 0, (min[2] + max[2]) / 2])
      const hw = (max[0] - min[0]) / 2
      const hd = (max[2] - min[2]) / 2
      levels.push({ name: `${id}-step-${k}`, y: y1, minX: c[0] - hw, maxX: c[0] + hw, minZ: c[2] - hd, maxZ: c[2] + hd, rotY: deg(f.rotation) })
    }
  }
  col.get(b.name).append(b, m)
  return { instances: [], colliders: [obb(`${id}-${f.kind}`, f.center, hx, hz, f.rotation, bottom, base + H)], levels }
}
