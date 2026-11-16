// Web Worker: resolves dimensions.json and runs the generators off the main thread, then transfers the
// typed arrays (zero-copy). Pure: no `three` in this chunk.
import dimensions from '../data/dimensions.json'
import palette from '../data/palette.json'
import sources from '../data/sources.json'
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

scope.onmessage = (e) => {
  const t0 = performance.now()
  try {
    // The east ramp is built only because sources.json records the reconstruction choice.
    const eastRamp = 'east-ramp' in sources.choices
    const r = resolveDimensions(dimensions.dimensions as unknown as Dimensions, { eastRamp })
    const output = buildTemple(r, e.data.tier, palette.colors, { colorIdx: e.data.keepColorIdx })
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
      cella: {
        centerX: r.cella.centerX,
        halfX: r.cella.halfX,
        halfZ: r.cella.halfZ,
        floorY: r.cella.floorY,
        eastWallX: r.cella.eastWallX,
        westWallX: r.cella.westWallX,
      },
      log: r.log,
    }
    const ms = performance.now() - t0
    scope.postMessage({ ok: true, tier: e.data.tier, output, meta, ms, triangles: triangleCount(output) }, transferables(output))
  } catch (err) {
    scope.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
