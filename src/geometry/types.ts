// Plain-data contract between the pure generators (src/geometry), the Worker and build-scene.ts.
// No `three` here: everything is typed arrays so it can cross the Worker boundary as transferables.

export type Tier = 'low' | 'med' | 'high'
export const TIERS: readonly Tier[] = ['low', 'med', 'high']

/** Named index range inside a group (used by tests to find AC3 elements inside merged instance geometry). */
export interface GroupPart {
  name: string
  /** First index (into `indices`) of the part. */
  start: number
  /** Number of indices. */
  count: number
}

export interface GeometryGroup {
  /** Architectural element, e.g. 'triglyphs'. Unique per generator output. */
  name: string
  /** Ornament pattern id = material (palette entry's `pattern`). */
  material: string
  /** Palette entry id (src/data/palette.json) or '' when the element is unpainted ground. */
  paletteId: string
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  /** Normalized RGB, 3 per vertex. */
  color: Uint8Array
  /** Palette index per vertex (traceability tests only; stripped from production Worker output). */
  colorIdx?: Uint16Array
  indices: Uint32Array
  parts?: GroupPart[]
}

export interface InstanceSet {
  name: string
  geometry: GeometryGroup
  /** 16 floats per instance, column-major (three.js Matrix4.elements order). */
  matrices: Float32Array
  /** Per-instance labels, e.g. 'r0c0'. Same order as `matrices`. */
  labels: string[]
}

export type Collider =
  | { kind: 'circle'; name: string; x: number; z: number; r: number; y0: number; y1: number }
  | { kind: 'box'; name: string; minX: number; maxX: number; minZ: number; maxZ: number; y0: number; y1: number }
  /** Oriented box: centre, half extents along its local x/z, rotation about +y (radians, same sense as instance matrices). */
  | { kind: 'obb'; name: string; cx: number; cz: number; halfX: number; halfZ: number; rotY: number; y0: number; y1: number }

/** Regular height grid in the temple frame: heights[iz * nx + ix] at (originX + ix*cell, originZ + iz*cell); NaN = no data. */
export interface Heightfield {
  nx: number
  nz: number
  cell: number
  originX: number
  originZ: number
  heights: Float32Array
}

/** Walkable surface. Flat unless `slopeX` is set (dy/dx, y = `y` at x = minX) or `heightfield` is given (terrain). */
export interface Level {
  heightfield?: Heightfield
  /** Rotation of the box about its centre (radians, same sense as instance matrices); 0 when absent. */
  rotY?: number
  /** Exact walkable outline (plan x, z) when the surface is not a box, e.g. a terrace. */
  polygon?: [number, number][]
  name: string
  y: number
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  slopeX?: number
}

export interface GeneratorOutput {
  groups: GeometryGroup[]
  instances: InstanceSet[]
  colliders: Collider[]
  levels: Level[]
}

export const emptyOutput = (): GeneratorOutput => ({ groups: [], instances: [], colliders: [], levels: [] })

export function mergeOutputs(outs: GeneratorOutput[]): GeneratorOutput {
  const res = emptyOutput()
  for (const o of outs) {
    res.groups.push(...o.groups)
    res.instances.push(...o.instances)
    res.colliders.push(...o.colliders)
    res.levels.push(...o.levels)
  }
  return res
}
