// Sanctuary assembly: builds every feature shown at the display year, reports placement provenance for
// every feature (shown or hidden), and returns the outlines the terrain must be cut by.
import type { Point2, SanctuaryDoc, SanctuaryFeature } from '../../data/sanctuary'
import { footprints, isDisplayed, isShown } from '../../data/sanctuary'
import type { PaletteLike } from '../mesh'
import { Collector } from '../mesh'
import type { GeneratorOutput, Heightfield, Tier } from '../types'
import { mergeOutputs } from '../types'
import { altar } from './altar'
import { building } from './building'
import { cistern, cisternLoops } from './cistern'
import { pavement } from './pavement'
import { BASE_SIDES, votiveColumn, type SphinxSlot } from './votive'
import type { GroundFn, SanctuaryContext } from './common'
import { sampleHeight, terrain } from './terrain'
import { channel, wallRun } from './wall'
import { demGrid, demGround, type Dem } from './dem'
import { clampNearTerraces, meshedGround, sparseTerrain, type TerrainMismatch } from './terraces'

export interface FeatureReport {
  id: string
  kind: SanctuaryFeature['kind'] | 'unmodelled'
  name: string
  shown: boolean
  phase: string
  placement: 'plan'
  /** Shown but uncertain at the display date (About panel), or why a listed feature is hidden. */
  uncertain?: string
  hiddenReason?: string
  note?: string
}

/** Outlines a feature cuts out of the terrain (convex polygons). */
export function terrainCuts(f: SanctuaryFeature, tier: Tier): Point2[][] {
  if (f.kind === 'cistern') return [cisternLoops(f, tier).outer]
  if (f.kind === 'column') {
    // Exactly the tessellated base disc of this tier (no uncovered slivers between it and a finer polygon).
    const n = BASE_SIDES[tier]
    const R = f.baseDiameter.value / 2
    return [Array.from({ length: n }, (_, i): Point2 => [f.center[0] + R * Math.cos((2 * Math.PI * i) / n), f.center[1] + R * Math.sin((2 * Math.PI * i) / n)])]
  }
  return footprints(f)
}

export function buildFeature(id: string, f: SanctuaryFeature, ctx: SanctuaryContext, col: Collector): Omit<GeneratorOutput, 'groups'> & { sphinxSlot?: SphinxSlot } {
  switch (f.kind) {
    case 'altar':
    case 'base':
      return altar(id, f, ctx, col)
    case 'pavement':
      return pavement(id, f, ctx, col)
    case 'column':
      return votiveColumn(id, f, ctx, col)
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
  /** Sphinx crowning slots (scans replace the stand-in). */
  sphinxSlots: SphinxSlot[]
}

export function buildSanctuary(doc: SanctuaryDoc, tier: Tier, palette: PaletteLike, ground: GroundFn, stylobateTop: number): SanctuaryBuild {
  const col = new Collector()
  const ctx: SanctuaryContext = { ground, tier, stylobateTop }
  const parts: (Omit<GeneratorOutput, 'groups'> & { sphinxSlot?: SphinxSlot })[] = []
  const report: FeatureReport[] = []
  const cuts: Point2[][] = []
  for (const [id, f] of Object.entries(doc.features)) {
    const shown = isDisplayed(f, doc.meta.displayYear)
    report.push({
      id,
      kind: f.kind,
      name: f.name,
      shown,
      phase: f.phase.label,
      placement: f.placement.source,
      uncertain: f.uncertain,
      hiddenReason: shown ? undefined : (f.hiddenReason ?? (isShown(f.phase, doc.meta.displayYear) ? undefined : `outside the display date (${doc.meta.displayLabel})`)),
      note: f.placement.note,
    })
    if (!shown) continue
    parts.push(buildFeature(id, f, ctx, col))
    cuts.push(...terrainCuts(f, tier))
  }
  for (const [id, h] of Object.entries(doc.hidden ?? {}))
    report.push({ id, kind: 'unmodelled', name: h.name, shown: false, phase: h.phase.label, placement: 'plan', hiddenReason: h.reason, note: h.note })
  const merged = mergeOutputs(parts.map((p) => ({ ...p, groups: [] })))
  const sphinxSlots = parts.flatMap((p) => (p.sphinxSlot ? [p.sphinxSlot] : []))
  return { output: { ...merged, groups: col.build(palette) }, report, cuts, sphinxSlots }
}

/** Terrain group + heightfield level, cut by the given outlines (temple krepis, sanctuary features). */
export function buildTerrain(hf: Heightfield, tier: Tier, palette: PaletteLike, cuts: Point2[][]): GeneratorOutput {
  const col = new Collector()
  const t = terrain(hf, tier, col, cuts)
  return { ...t, groups: col.build(palette) }
}

export const groundFromHeightfield = (hf: Heightfield): GroundFn => (x, z) => sampleHeight(hf, x, z)

/** Sea plane half-size beyond the landscape (m): it reaches the horizon past the DEM window. */
export const SEA_EXTENT = 12000

export interface SiteTerrain {
  output: GeneratorOutput
  /** Exact surface: terrace levels inside the terraces, natural ground (DEM or falloff) outside. */
  ground: GroundFn
  /** Places where the natural ground rises above a terrace edge (logged, cut faces built). */
  mismatches: TerrainMismatch[]
  seaLevelY?: number
  /** Conjectural DSM correction next to the terraces (largest lowering, radius, drop), when applied. */
  groundCorrection?: { maxLowered: number; maxRaised: number; radius: number; drop: number; hold: number }
}

/**
 * Terrain for the sanctuary: terraces at their (ancient) levels, the natural ground around them from the DEM
 * when given (real hill + sea plane, rectilinear LOD grid) or else the parametric directional falloff.
 */
/** Natural ground beyond the terraces: the DEM (corrected next to the terraces when the data asks) on its LOD grid, or the falloff. */
export function naturalGround(doc: SanctuaryDoc, stylobateTop: number, tier: Tier, dem?: Dem) {
  if (!dem) return { opts: {}, correction: undefined }
  const c = doc.terrain.dem?.nearTerraceClamp
  const raw = demGround(dem)
  const clamp = c ? clampNearTerraces(raw, doc.terrain, stylobateTop, c.radius.value, c.drop.value, c.hold?.value ?? 0) : undefined
  return { opts: { ground: clamp ? clamp.ground : raw, grid: demGrid(dem, tier) }, correction: clamp?.stats }
}

export function sanctuaryTerrain(doc: SanctuaryDoc, stylobateTop: number, tier: Tier, palette: PaletteLike, cuts: Point2[][], dem?: Dem): SiteTerrain {
  const col = new Collector()
  const nat = naturalGround(doc, stylobateTop, tier, dem)
  const t = sparseTerrain(doc.terrain, stylobateTop, tier, col, cuts, nat.opts)
  if (dem) {
    const e = SEA_EXTENT
    const y = dem.seaLevelY
    col.get('sea').polygonFacing(
      [
        [-e, y, -e],
        [e, y, -e],
        [e, y, e],
        [-e, y, e],
      ],
      [0, 1, 0],
    )
  }
  const { mismatches, ...rest } = t
  return {
    output: { ...rest, groups: col.build(palette) },
    ground: siteGround(doc, stylobateTop, tier, dem),
    mismatches,
    seaLevelY: dem?.seaLevelY,
    groundCorrection: nat.correction,
  }
}

/** The surface features sit on, exactly as the terrain meshes it: terrace level inside a terrace, else the meshed natural ground. */
export function siteGround(doc: SanctuaryDoc, stylobateTop: number, tier: Tier, dem?: Dem): GroundFn {
  return meshedGround(doc.terrain, stylobateTop, tier, naturalGround(doc, stylobateTop, tier, dem).opts)
}

/**
 * Whole site: ground function first, then the features sitting on it, then the terrain cut by their
 * footprints plus any extra outlines.
 */
export function buildSite(doc: SanctuaryDoc, stylobateTop: number, tier: Tier, palette: PaletteLike, opts: { dem?: Dem; extraCuts?: Point2[][] } = {}) {
  const ground = siteGround(doc, stylobateTop, tier, opts.dem)
  const sanctuary = buildSanctuary(doc, tier, palette, ground, stylobateTop)
  const t = sanctuaryTerrain(doc, stylobateTop, tier, palette, [...sanctuary.cuts, ...(opts.extraCuts ?? [])], opts.dem)
  return { sanctuary, terrain: t.output, ground, mismatches: t.mismatches, seaLevelY: t.seaLevelY, groundCorrection: t.groundCorrection }
}
