// Real terrain from the Copernicus GLO-30 DEM (measurements/landscape.* and hilltop.*, already in the
// temple frame): decode, sample (2 m hilltop blended into the 20 m landscape), push sea cells to a seabed
// under the sea plane, and lay out a rectilinear LOD grid (fine over the hilltop, coarse out to the edge).
import type { Heightfield, Tier } from '../types'
import type { GroundFn } from './common'
import { decodePng16 } from './png16'
import { sampleHeight } from './terrain'

/** The fields of measurements/{landscape,hilltop}.json this code relies on. */
export interface DemMeta {
  origin: { x0: number; z0: number }
  cell: number
  dims: { nx: number; nz: number }
  zMin: number
  zMax: number
  seaLevelY: number
  attribution: string
  liability: string
}

export interface Dem {
  hilltop: Heightfield
  landscape: Heightfield
  seaLevelY: number
  attribution: string
  liability: string
}

/** Decode a DEM PNG16 into a Heightfield whose samples sit at the cell centres. */
export async function demHeightfield(meta: DemMeta, png: Uint8Array): Promise<Heightfield> {
  const img = await decodePng16(png)
  if (img.width !== meta.dims.nx || img.height !== meta.dims.nz) throw new Error('DEM PNG size does not match its metadata')
  const k = (meta.zMax - meta.zMin) / 65535
  const heights = new Float32Array(img.data.length)
  for (let i = 0; i < heights.length; i++) heights[i] = meta.zMin + img.data[i] * k
  return { nx: meta.dims.nx, nz: meta.dims.nz, cell: meta.cell, originX: meta.origin.x0 + meta.cell / 2, originZ: meta.origin.z0 + meta.cell / 2, heights }
}

export async function loadDem(hilltopMeta: DemMeta, hilltopPng: Uint8Array, landscapeMeta: DemMeta, landscapePng: Uint8Array): Promise<Dem> {
  const [hilltop, landscape] = await Promise.all([demHeightfield(hilltopMeta, hilltopPng), demHeightfield(landscapeMeta, landscapePng)])
  return { hilltop, landscape, seaLevelY: landscapeMeta.seaLevelY, attribution: landscapeMeta.attribution, liability: landscapeMeta.liability }
}

/** Width of the hilltop -> landscape blend band inside the hilltop window (m). */
export const DEM_BLEND = 20
/** Depth of the seabed below the sea plane wherever the DEM is at sea level (keeps them apart). */
export const SEABED_DEPTH = 3
const SEA_TOLERANCE = 0.5

export function demExtent(hf: Heightfield) {
  return { minX: hf.originX, maxX: hf.originX + (hf.nx - 1) * hf.cell, minZ: hf.originZ, maxZ: hf.originZ + (hf.nz - 1) * hf.cell }
}

/** Natural ground from the DEM: hilltop grid inside its window, blended into the landscape grid. */
export function demGround(dem: Dem): GroundFn {
  const h = demExtent(dem.hilltop)
  const sea = dem.seaLevelY
  return (x, z) => {
    let y = sampleHeight(dem.landscape, x, z)
    const inset = Math.min(x - h.minX, h.maxX - x, z - h.minZ, h.maxZ - z)
    if (inset > 0) {
      const w = Math.min(1, inset / DEM_BLEND)
      const yh = sampleHeight(dem.hilltop, x, z)
      if (Number.isFinite(yh)) y = Number.isFinite(y) ? y * (1 - w) + yh * w : yh
    }
    if (!Number.isFinite(y)) return sea - SEABED_DEPTH
    return y <= sea + SEA_TOLERANCE ? sea - SEABED_DEPTH : y
  }
}

/** Inner (hilltop) and outer (landscape) grid spacing per tier (m). */
export const DEM_GRID: Record<Tier, { inner: number; outer: number }> = {
  low: { inner: 6, outer: 120 },
  med: { inner: 3, outer: 60 },
  high: { inner: 2, outer: 30 },
}

/** Axis coordinates: fine spacing inside [-innerHalf, innerHalf], coarse out to [-outerHalf, outerHalf]. */
export function nestedAxis(innerHalf: number, outerHalf: number, inner: number, outer: number): Float64Array {
  const xs: number[] = []
  const nIn = Math.ceil((2 * innerHalf) / inner)
  const nOut = Math.max(1, Math.ceil((outerHalf - innerHalf) / outer))
  for (let i = nOut; i >= 1; i--) xs.push(-innerHalf - (i * (outerHalf - innerHalf)) / nOut)
  for (let i = 0; i <= nIn; i++) xs.push(-innerHalf + (i * 2 * innerHalf) / nIn)
  for (let i = 1; i <= nOut; i++) xs.push(innerHalf + (i * (outerHalf - innerHalf)) / nOut)
  return new Float64Array(xs)
}

/** The rectilinear terrain grid for a tier: nodes on the hilltop window, coarse to the landscape edge. */
export function demGrid(dem: Dem, tier: Tier): { xs: Float64Array; zs: Float64Array } {
  const h = demExtent(dem.hilltop)
  const l = demExtent(dem.landscape)
  const g = DEM_GRID[tier]
  const innerHalf = Math.min(h.maxX, -h.minX, h.maxZ, -h.minZ)
  const outerHalf = Math.min(l.maxX, -l.minX, l.maxZ, -l.minZ)
  const a = nestedAxis(innerHalf, outerHalf, g.inner, g.outer)
  return { xs: a, zs: a }
}
