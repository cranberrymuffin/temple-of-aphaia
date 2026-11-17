// Site-wide: no sky through gaps. For every shown feature (and the temple), each terrain cut is covered
// from above, and along each cut's edge the feature reaches down to the terrain surface (gap <= 1 cm).
// Runs on the parametric terrain and on the real Copernicus DEM, every tier.
import { readFileSync } from 'node:fs'
import { resolve as res } from 'node:path'
import { describe, expect, it } from 'vitest'
import dimensions from '../../src/data/dimensions.json'
import palette from '../../src/data/palette.json'
import sanctuary from '../../src/data/sanctuary.json'
import hilltopMeta from '../../measurements/hilltop.json'
import landscapeMeta from '../../measurements/landscape.json'
import { resolveDimensions } from '../../src/data/resolveDimensions'
import { isShown, rotatedRect, type SanctuaryDoc } from '../../src/data/sanctuary'
import type { Dimensions } from '../../src/data/types'
import { buildSite, terrainCuts } from '../../src/geometry/sanctuary'
import { loadDem, type Dem, type DemMeta } from '../../src/geometry/sanctuary/dem'
import { buildTemple } from '../../src/geometry/temple'
import { TIERS, mergeOutputs, type Tier } from '../../src/geometry/types'
import { findGaps } from './helpers/gaps'
import { worldTriangles } from './helpers/triangles'

const doc = sanctuary as unknown as SanctuaryDoc
const dims = dimensions.dimensions as unknown as Dimensions
const png = (f: string) => new Uint8Array(readFileSync(res(__dirname, '../../measurements', f)))

function check(tier: Tier, dem?: Dem) {
  const r = resolveDimensions(dims, { eastRamp: true, rampWidth: doc.temple.rampWidth.value, foundationDepth: doc.temple.foundationDepth.value })
  const temple = buildTemple(r, tier, palette.colors, { ground: false })
  const site = buildSite(doc, r.stylobate.top, tier, palette.colors, { dem })
  const tris = worldTriangles(mergeOutputs([temple, site.sanctuary.output, site.terrain]))
  const s0 = r.crepidoma.steps[0]
  const outlines = [{ id: 'temple-krepis', poly: rotatedRect([0, 0], 2 * s0.halfX, 2 * s0.halfZ, 0) }]
  for (const [id, f] of Object.entries(doc.features)) {
    if (!isShown(f.phase, doc.meta.displayYear)) continue
    terrainCuts(f, tier).forEach((poly, i) => outlines.push({ id: `${id}#${i}`, poly }))
  }
  return findGaps(tris, outlines)
}

describe.each(TIERS)('no gaps under features, parametric terrain (%s)', (tier) => {
  it('every cut covered, every edge closed down to the terrain', () => {
    const g = check(tier)
    expect(g.edgeSamples).toBeGreaterThan(500)
    expect(g.holes.slice(0, 20)).toEqual([])
    expect(g.slits.slice(0, 20)).toEqual([])
  }, 120_000)
})

describe('no gaps under features, real DEM', async () => {
  const dem = await loadDem(hilltopMeta as unknown as DemMeta, png('hilltop.png'), landscapeMeta as unknown as DemMeta, png('landscape.png'))
  it.each(TIERS)('%s tier', (tier) => {
    const g = check(tier, dem)
    expect(g.edgeSamples).toBeGreaterThan(500)
    expect(g.holes.slice(0, 20)).toEqual([])
    expect(g.slits.slice(0, 20)).toEqual([])
  }, 120_000)
})
