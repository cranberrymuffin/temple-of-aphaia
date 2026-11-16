// Sanctuary assembly: builds every feature shown at the display year, reports placement provenance for
// every feature (shown or hidden), and returns the outlines the terrain must be cut by.
import type { Point2, SanctuaryDoc, SanctuaryFeature } from '../../data/sanctuary'
import { footprints, isShown } from '../../data/sanctuary'
import type { PaletteLike } from '../mesh'
import { Collector } from '../mesh'
import type { GeneratorOutput, Heightfield, Tier } from '../types'
import { mergeOutputs } from '../types'
import { altar } from './altar'
import { building } from './building'
import { cistern, cisternLoops } from './cistern'
import type { GroundFn, SanctuaryContext } from './common'
import { sampleHeight, terrain } from './terrain'
import { channel, wallRun } from './wall'

export interface FeatureReport {
  id: string
  kind: SanctuaryFeature['kind']
  name: string
  shown: boolean
  phase: string
  placement: 'scan' | 'plan'
  note?: string
}

/** Outlines a feature cuts out of the terrain (convex polygons). */
export function terrainCuts(f: SanctuaryFeature, tier: Tier): Point2[][] {
  return f.kind === 'cistern' ? [cisternLoops(f, tier).outer] : footprints(f)
}

export function buildFeature(id: string, f: SanctuaryFeature, ctx: SanctuaryContext, col: Collector): Omit<GeneratorOutput, 'groups'> {
  switch (f.kind) {
    case 'altar':
      return altar(id, f, ctx, col)
    case 'building':
      return building(id, f, ctx, col)
    case 'wall':
      return wallRun(id, f, ctx, col)
    case 'cistern':
      return cistern(id, f, ctx, col)
    case 'channel':
      return channel(id, f, ctx, col)
  }
}

export interface SanctuaryBuild {
  output: GeneratorOutput
  report: FeatureReport[]
  cuts: Point2[][]
}

export function buildSanctuary(doc: SanctuaryDoc, tier: Tier, palette: PaletteLike, ground: GroundFn): SanctuaryBuild {
  const col = new Collector()
  const ctx: SanctuaryContext = { ground, tier }
  const parts: Omit<GeneratorOutput, 'groups'>[] = []
  const report: FeatureReport[] = []
  const cuts: Point2[][] = []
  for (const [id, f] of Object.entries(doc.features)) {
    const shown = isShown(f.phase, doc.meta.displayYear)
    report.push({ id, kind: f.kind, name: f.name, shown, phase: f.phase.label, placement: f.placement.source, note: f.placement.note })
    if (!shown) continue
    parts.push(buildFeature(id, f, ctx, col))
    cuts.push(...terrainCuts(f, tier))
  }
  const merged = mergeOutputs(parts.map((p) => ({ ...p, groups: [] })))
  return { output: { ...merged, groups: col.build(palette) }, report, cuts }
}

/** Terrain group + heightfield level, cut by the given outlines (temple krepis, sanctuary features). */
export function buildTerrain(hf: Heightfield, tier: Tier, palette: PaletteLike, cuts: Point2[][]): GeneratorOutput {
  const col = new Collector()
  const t = terrain(hf, tier, col, cuts)
  return { ...t, groups: col.build(palette) }
}

export const groundFromHeightfield = (hf: Heightfield): GroundFn => (x, z) => sampleHeight(hf, x, z)
