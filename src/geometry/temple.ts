// Assembles the whole temple from the resolved dimensions. Pure: runs in the Worker and in Node.
import type { Resolved } from '../data/resolveDimensions'
import { cella, columnMesh } from './cella'
import { crepidoma } from './crepidoma'
import { entablature } from './entablature'
import { ground } from './ground'
import type { PaletteLike } from './mesh'
import { Collector, composeMatrix } from './mesh'
import { pediment } from './pediment'
import { roof } from './roof'
import type { Collider, GeneratorOutput, InstanceSet, Tier } from './types'

export interface TempleOptions {
  /** Keep the per-vertex palette index (traceability tests). Default true. */
  colorIdx?: boolean
}

function peristyle(r: Resolved, tier: Tier, palette: PaletteLike): { instance: InstanceSet; colliders: Collider[] } {
  const b = columnMesh('peristyle-column', r.column, tier, false)
  const geometry = b.build(palette, Object.keys(palette))
  const matrices = new Float32Array(r.peristyle.length * 16)
  const labels: string[] = []
  const colliders: Collider[] = []
  const S = r.stylobate.top
  r.peristyle.forEach((p, i) => {
    matrices.set(composeMatrix([p.x, S, p.z], p.rotY, [p.scale, 1, p.scale]), i * 16)
    labels.push(`r${p.row}c${p.col}`)
    colliders.push({ kind: 'circle', name: `column-r${p.row}c${p.col}`, x: p.x, z: p.z, r: r.column.lowerRadius * p.scale, y0: S, y1: S + r.column.height })
  })
  return { instance: { name: 'peristyle', geometry, matrices, labels }, colliders }
}

export function buildTemple(r: Resolved, tier: Tier, palette: PaletteLike, opts: TempleOptions = {}): GeneratorOutput {
  const col = new Collector()
  const parts = [
    ground(r, col),
    crepidoma(r, col),
    entablature(r, tier, col),
    pediment(r, col),
    roof(r, col),
    cella(r, tier, col),
  ]
  const ps = peristyle(r, tier, palette)
  const out: GeneratorOutput = {
    groups: col.build(palette),
    instances: [ps.instance],
    colliders: [...ps.colliders, ...parts.flatMap((p) => p.colliders)],
    levels: parts.flatMap((p) => p.levels),
  }
  if (opts.colorIdx === false) {
    for (const g of out.groups) delete g.colorIdx
    for (const s of out.instances) delete s.geometry.colorIdx
  }
  return out
}

/** Triangle count with instances expanded. */
export function triangleCount(out: GeneratorOutput): number {
  let n = 0
  for (const g of out.groups) n += g.indices.length / 3
  for (const s of out.instances) n += (s.geometry.indices.length / 3) * (s.matrices.length / 16)
  return n
}
