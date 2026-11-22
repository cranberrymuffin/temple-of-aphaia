// Worker message protocol (pure types + the transferable list).
import type { LogEntry } from '../data/resolveDimensions'
import type { FeatureReport } from './sanctuary'
import type { TerrainMismatch } from './sanctuary/terraces'
import type { CultSlot } from './cult'
import type { Field, PlacedFigure } from './figures'
import type { StatueSlot } from './sanctuary/altar'
import type { SphinxSlot } from './sanctuary/votive'
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
  /** Sanctuary: modelled extent (terraces plus the hill falloff) and every feature's shown/hidden/uncertain status. */
  site: {
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
    displayLabel: string
    features: FeatureReport[]
    /** Extent of the DEM landscape mesh, and the sea level (y); absent when the DEM failed to load (fallback). */
    landscape?: { minX: number; maxX: number; minZ: number; maxZ: number }
    seaLevelY?: number
    /** Terrace edges where today's DEM rises above the ancient terrace level (cut faces built). */
    terrainMismatches: TerrainMismatch[]
    /** Copernicus attribution and liability texts: show wherever the terrain is shown. */
    attribution: string[]
    demLoadMs: number
    /** Why the DEM was not used (the parametric falloff was built instead). */
    demError?: string
    /** Conjectural correction of the DSM next to the terraces (largest lowering in m), when applied. */
    groundCorrection?: { maxLowered: number; maxRaised: number; radius: number; drop: number; hold: number }
  }
  cella: { centerX: number; halfX: number; halfZ: number; floorY: number; eastWallX: [number, number]; westWallX: [number, number] }
  /** Where scanned sculptures replace stand-ins: the pediment field, each figure slot, the cult-statue base. */
  sculpture: { field: Field; figureSlots: PlacedFigure[]; cultSlot: CultSlot; sphinxSlot?: SphinxSlot; statueSlots?: StatueSlot[] }
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
