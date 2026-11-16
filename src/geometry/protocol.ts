// Worker message protocol (pure types + the transferable list).
import type { LogEntry } from '../data/resolveDimensions'
import type { GeneratorOutput, Tier } from './types'

export interface GenerateRequest {
  tier: Tier
  /** Keep per-vertex palette indices (dev/test builds only). */
  keepColorIdx: boolean
}

/** Scene facts the viewer needs without importing the resolver (camera presets, orbit limits). */
export interface TempleMeta {
  stylobate: { halfX: number; halfZ: number; top: number }
  /** Outer bounds of the building (cornice outline, ground to ridge). */
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }
  ceilingY: number
  /** Inner faces of the peristyle columns (grid edge axis minus the lower radius). */
  peristyle: { innerX: number; innerZ: number }
  cella: { centerX: number; halfX: number; halfZ: number; floorY: number; eastWallX: [number, number]; westWallX: [number, number] }
  log: LogEntry[]
}

export type GenerateResponse =
  | { ok: true; tier: Tier; output: GeneratorOutput; meta: TempleMeta; ms: number; triangles: number }
  | { ok: false; error: string }

export function transferables(out: GeneratorOutput): ArrayBuffer[] {
  const bufs = new Set<ArrayBuffer>()
  const add = (g: GeneratorOutput['groups'][number]) => {
    for (const a of [g.positions, g.normals, g.uvs, g.color, g.indices, g.colorIdx]) if (a) bufs.add(a.buffer as ArrayBuffer)
  }
  out.groups.forEach(add)
  for (const s of out.instances) {
    add(s.geometry)
    bufs.add(s.matrices.buffer as ArrayBuffer)
  }
  for (const l of out.levels) if (l.heightfield) bufs.add(l.heightfield.heights.buffer as ArrayBuffer)
  return [...bufs]
}
