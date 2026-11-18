// The walk world exactly as the Worker builds it (temple + sanctuary + DEM terrain), for collision tests.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import dimensions from '../../../src/data/dimensions.json'
import palette from '../../../src/data/palette.json'
import sanctuary from '../../../src/data/sanctuary.json'
import hilltopMeta from '../../../measurements/hilltop.json'
import landscapeMeta from '../../../measurements/landscape.json'
import { resolveDimensions } from '../../../src/data/resolveDimensions'
import type { SanctuaryDoc } from '../../../src/data/sanctuary'
import type { Dimensions } from '../../../src/data/types'
import { buildSite } from '../../../src/geometry/sanctuary'
import { loadDem, type DemMeta } from '../../../src/geometry/sanctuary/dem'
import { buildTemple } from '../../../src/geometry/temple'
import { mergeOutputs, type GeneratorOutput, type Tier } from '../../../src/geometry/types'

const png = (f: string) => new Uint8Array(readFileSync(resolve(__dirname, '../../../measurements', f)))

export async function buildWorld(tier: Tier = 'low'): Promise<GeneratorOutput> {
  const dem = await loadDem(hilltopMeta as unknown as DemMeta, png('hilltop.png'), landscapeMeta as unknown as DemMeta, png('landscape.png'))
  const doc = sanctuary as unknown as SanctuaryDoc
  const r = resolveDimensions(dimensions.dimensions as unknown as Dimensions, {
    eastRamp: true,
    rampWidth: doc.temple.rampWidth.value,
    foundationDepth: doc.temple.foundationDepth.value,
  })
  const temple = buildTemple(r, tier, palette.colors, { ground: false })
  const site = buildSite(doc, r.stylobate.top, tier, palette.colors, { dem })
  return mergeOutputs([temple, site.sanctuary.output, site.terrain])
}
