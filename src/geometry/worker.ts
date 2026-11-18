// Web Worker: resolves dimensions.json and runs the generators off the main thread, then transfers the
// typed arrays (zero-copy). Pure: no `three` in this chunk.
import dimensions from '../data/dimensions.json'
import palette from '../data/palette.json'
import sources from '../data/sources.json'
import sanctuary from '../data/sanctuary.json'
import type { SanctuaryDoc } from '../data/sanctuary'
import { buildSite } from './sanctuary'
import { demExtent, loadDem, type Dem, type DemMeta } from './sanctuary/dem'
import hilltopMeta from '../../measurements/hilltop.json'
import landscapeMeta from '../../measurements/landscape.json'
import hilltopUrl from '../../measurements/hilltop.png?url'
import landscapeUrl from '../../measurements/landscape.png?url'
import { terrainBounds } from './sanctuary/terraces'
import { mergeOutputs } from './types'
import { resolveDimensions } from '../data/resolveDimensions'
import type { Dimensions } from '../data/types'
import type { GenerateRequest, GenerateResponse, TempleMeta } from './protocol'
import { transferables } from './protocol'
import { buildTemple, triangleCount } from './temple'

interface WorkerScope {
  onmessage: ((e: MessageEvent<GenerateRequest>) => void) | null
  postMessage(msg: GenerateResponse, transfer?: Transferable[]): void
}
const scope = self as unknown as WorkerScope

const bytes = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

/** The DEM, or undefined (parametric falloff fallback) when it cannot be fetched or decoded. */
async function tryLoadDem(): Promise<{ dem?: Dem; error?: string }> {
  try {
    const [h, l] = await Promise.all([bytes(hilltopUrl), bytes(landscapeUrl)])
    return { dem: await loadDem(hilltopMeta as unknown as DemMeta, h, landscapeMeta as unknown as DemMeta, l) }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

scope.onmessage = async (e) => {
  const t0 = performance.now()
  try {
    // Real hill and sea (Copernicus GLO-30, in the temple frame) around the ancient terraces.
    // If it fails to load, the site falls back to the parametric hilltop falloff (logged in meta.site.demError).
    const { dem, error: demError } = await tryLoadDem()
    const tDem = performance.now()
    // The east ramp is built only because sources.json records the reconstruction choice.
    const eastRamp = 'east-ramp' in sources.choices
    const doc = sanctuary as unknown as SanctuaryDoc
    const r = resolveDimensions(dimensions.dimensions as unknown as Dimensions, {
      eastRamp,
      rampWidth: doc.temple.rampWidth.value,
      foundationDepth: doc.temple.foundationDepth.value,
    })
    // The sanctuary terrain replaces the flat ground plane; the krepis rests on the temple terrace.
    const temple = buildTemple(r, e.data.tier, palette.colors, { colorIdx: e.data.keepColorIdx, ground: false })
    const site = buildSite(doc, r.stylobate.top, e.data.tier, palette.colors, { dem })
    const land = dem ? demExtent(dem.landscape) : undefined
    const output = mergeOutputs([{ groups: temple.groups, instances: temple.instances, colliders: temple.colliders, levels: temple.levels }, site.sanctuary.output, site.terrain])
    if (!e.data.keepColorIdx) for (const g of output.groups) delete g.colorIdx
    const tb = terrainBounds(doc.terrain)
    const meta: TempleMeta = {
      stylobate: { halfX: r.stylobate.halfX, halfZ: r.stylobate.halfZ, top: r.stylobate.top },
      bounds: {
        minX: -Math.max(r.roof.halfX, r.ramp?.maxX ?? 0),
        maxX: Math.max(r.roof.halfX, r.ramp?.maxX ?? 0),
        minY: 0,
        maxY: r.roof.ridgeY,
        minZ: -r.roof.halfZ,
        maxZ: r.roof.halfZ,
      },
      ceilingY: r.ceilingY,
      peristyle: {
        innerX: r.grid.x[r.grid.x.length - 1] - r.column.lowerRadius,
        innerZ: r.grid.z[r.grid.z.length - 1] - r.column.lowerRadius,
      },
      site: {
        bounds: { minX: tb.minX, maxX: tb.maxX, minZ: tb.minZ, maxZ: tb.maxZ },
        displayLabel: doc.meta.displayLabel,
        features: site.sanctuary.report,
        landscape: land && { minX: land.minX, maxX: land.maxX, minZ: land.minZ, maxZ: land.maxZ },
        seaLevelY: dem?.seaLevelY,
        terrainMismatches: site.mismatches,
        attribution: dem ? [dem.attribution, dem.liability] : [],
        demLoadMs: tDem - t0,
        demError,
        groundCorrection: site.groundCorrection,
      },
      cella: {
        centerX: r.cella.centerX,
        halfX: r.cella.halfX,
        halfZ: r.cella.halfZ,
        floorY: r.cella.floorY,
        eastWallX: r.cella.eastWallX,
        westWallX: r.cella.westWallX,
      },
      log: r.log,
      sculpture: {
        field: { faceX: r.pediment.tympanumX, outerX: r.roof.halfX, baseY: r.pediment.baseY, halfZ: r.pediment.halfZ, apexY: r.pediment.apexY },
        figureSlots: temple.figureSlots,
        cultSlot: temple.cultSlot,
        sphinxSlot: site.sanctuary.sphinxSlots[0],
      },
    }
    const ms = performance.now() - t0
    scope.postMessage({ ok: true, tier: e.data.tier, output, meta, ms, triangles: triangleCount(output) }, transferables(output))
  } catch (err) {
    scope.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
