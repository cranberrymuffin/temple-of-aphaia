// Types and pure helpers for the sanctuary contract (src/data/schemas/sanctuary.schema.json).
// Coordinates: metres in the temple frame (x east, z south, origin at the stylobate centre). No `three`.
import { isSimple, pointInPolygon, triangulate } from './polygon'
import type { Confidence } from './types'

export type Point2 = [number, number]
export type Side = 'n' | 's' | 'e' | 'w'

export interface Measure {
  value: number
  unit: 'm' | 'deg' | 'count' | 'ratio'
  source: 'published'
  ref: string
  page?: string
  url?: string
  verified: boolean
  provisional?: boolean
  note?: string
}

/** The scan covers only the temple: every sanctuary feature is placed from the published site plan. */
export interface Placement {
  source: 'plan'
  ref: string
  page?: string
  verified: boolean
  confidence: Confidence
  note?: string
}

export interface Terrace {
  polygon: Point2[]
  /** Surface level relative to the stylobate top (m). */
  level: Measure
  note?: string
}

/** Sparse, conjectural terrain: terraces + retaining walls (wall features, role terrace) + hilltop falloff. */
export interface TerrainDesc {
  confidence: 'conjectural'
  sourceIds: string[]
  note?: string
  terraces: Record<string, Terrace>
  falloff: { slope: Measure; radius: Measure }
  dem?: { file: string; ref: string; verified: boolean; note?: string }
}

export interface Phase {
  label: string
  /** Negative = BCE; null = unknown/open. */
  fromYear: number | null
  toYear: number | null
  confidence: Confidence
  sourceIds: string[]
  note?: string
}

interface FeatureBase {
  name: string
  phase: Phase
  placement: Placement
  sourceIds: string[]
  confidence: Confidence
  note?: string
  /** Fixed base level; otherwise the base follows the terrain. */
  baseY?: number
}

export interface AltarFeature extends FeatureBase {
  kind: 'altar'
  center: Point2
  rotation: number
  length: Measure
  width: Measure
  height: Measure
  steps?: { count: Measure; rise: Measure; tread: Measure; side: Side }
}

export interface Door {
  wall: Side
  offset: number
  width: Measure
  height: Measure
}

export interface BuildingFeature extends FeatureBase {
  kind: 'building'
  role: 'propylon' | 'house' | 'ancillary' | 'other'
  center: Point2
  rotation: number
  length: Measure
  width: Measure
  wallHeight: Measure
  wallThickness: Measure
  doors: Door[]
  openSides?: Side[]
}

export interface WallFeature extends FeatureBase {
  kind: 'wall'
  role: 'terrace' | 'peribolos' | 'other'
  polyline: Point2[]
  closed?: boolean
  thickness: Measure
  height: Measure
  top?: 'level' | 'follow'
}

export interface CisternFeature extends FeatureBase {
  kind: 'cistern'
  shape: 'rect' | 'circle'
  center: Point2
  rotation: number
  length?: Measure
  width?: Measure
  diameter?: Measure
  depth: Measure
  rimHeight: Measure
  rimWidth: Measure
}

export interface ChannelFeature extends FeatureBase {
  kind: 'channel'
  polyline: Point2[]
  width: Measure
  depth: Measure
  feeds?: string
}

export type SanctuaryFeature = AltarFeature | BuildingFeature | WallFeature | CisternFeature | ChannelFeature

export interface SanctuaryDoc {
  meta: { status: 'provisional' | 'merged'; note: string; displayYear: number }
  terrain: TerrainDesc
  features: Record<string, SanctuaryFeature>
}

/** A feature is shown when its phase spans the display year (open ends count as spanning). */
export function isShown(phase: Phase, year: number): boolean {
  return (phase.fromYear === null || phase.fromYear <= year) && (phase.toYear === null || year <= phase.toYear)
}

export function partitionByPhase(doc: SanctuaryDoc): { shown: string[]; hidden: string[] } {
  const shown: string[] = []
  const hidden: string[] = []
  for (const [id, f] of Object.entries(doc.features)) (isShown(f.phase, doc.meta.displayYear) ? shown : hidden).push(id)
  return { shown, hidden }
}

/** Reference problems the schema cannot express: unknown source ids, dangling `feeds`, bad geometry. */
export function sanctuaryRefErrors(doc: SanctuaryDoc, sourceIds: Set<string>): string[] {
  const errs: string[] = []
  const measures = (f: SanctuaryFeature): [string, Measure][] => {
    const out: [string, Measure][] = []
    for (const [k, v] of Object.entries(f)) if (v && typeof v === 'object' && 'unit' in v) out.push([k, v as Measure])
    if (f.kind === 'altar' && f.steps) for (const [k, v] of Object.entries(f.steps)) if (typeof v === 'object') out.push([`steps.${k}`, v])
    if (f.kind === 'building') f.doors.forEach((d, i) => out.push([`doors[${i}].width`, d.width], [`doors[${i}].height`, d.height]))
    return out
  }
  for (const [id, f] of Object.entries(doc.features)) {
    for (const s of [...f.sourceIds, ...f.phase.sourceIds, f.placement.ref]) if (!sourceIds.has(s)) errs.push(`${id}: unknown source ${s}`)
    for (const [k, m] of measures(f)) if (!sourceIds.has(m.ref)) errs.push(`${id}.${k}: unknown source ${m.ref}`)
    if (f.kind === 'channel' && f.feeds && doc.features[f.feeds]?.kind !== 'cistern') errs.push(`${id}: feeds ${f.feeds} is not a cistern`)
    if (f.kind === 'building')
      for (const d of f.doors) {
        const wallLen = d.wall === 'n' || d.wall === 's' ? f.length.value : f.width.value
        if (Math.abs(d.offset) + d.width.value / 2 > wallLen / 2 - f.wallThickness.value) errs.push(`${id}: door on ${d.wall} wall does not fit`)
        if (d.height.value >= f.wallHeight.value) errs.push(`${id}: door taller than the wall`)
        if (f.openSides?.includes(d.wall)) errs.push(`${id}: door on an open side`)
      }
    if (f.kind === 'altar' || f.kind === 'building' || f.kind === 'cistern') {
      const c = f.center
      if (!Object.values(doc.terrain.terraces).some((t) => pointInPolygon(t.polygon, c))) errs.push(`${id}: not on a terrace`)
    }
    if ((f.kind === 'wall' || f.kind === 'channel') && f.polyline.some((p, i) => i > 0 && Math.hypot(p[0] - f.polyline[i - 1][0], p[1] - f.polyline[i - 1][1]) < 1e-6))
      errs.push(`${id}: repeated polyline point`)
  }
  const T = doc.terrain
  for (const s of T.sourceIds) if (!sourceIds.has(s)) errs.push(`terrain: unknown source ${s}`)
  for (const m of [T.falloff.slope, T.falloff.radius]) if (!sourceIds.has(m.ref)) errs.push(`terrain.falloff: unknown source ${m.ref}`)
  if (T.dem && !sourceIds.has(T.dem.ref)) errs.push(`terrain.dem: unknown source ${T.dem.ref}`)
  const terraces = Object.entries(T.terraces)
  for (const [id, t] of terraces) {
    if (!sourceIds.has(t.level.ref)) errs.push(`terrace ${id}: unknown source ${t.level.ref}`)
    if (!isSimple(t.polygon)) errs.push(`terrace ${id}: polygon is not simple`)
  }
  // Terraces may share edges but must not overlap.
  const tris = terraces.filter(([, t]) => isSimple(t.polygon)).map(([id, t]) => [id, triangulate(t.polygon)] as const)
  for (let i = 0; i < tris.length; i++)
    for (let j = i + 1; j < tris.length; j++)
      if (tris[i][1].some((a) => tris[j][1].some((b) => convexOverlap(a, b, 1e-6))))
        errs.push(`terraces ${tris[i][0]} and ${tris[j][0]} overlap`)
  return errs
}

// ---- footprints (plan polygons, counter-clockwise seen from above in x/z) -------------------

export function rotatedRect(center: Point2, length: number, width: number, rotationDeg: number): Point2[] {
  const a = (rotationDeg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  // Local x along `length`, local z along `width`; rotation about +y (x -> -z for positive angles).
  return [
    [-length / 2, -width / 2],
    [length / 2, -width / 2],
    [length / 2, width / 2],
    [-length / 2, width / 2],
  ].map(([x, z]) => [center[0] + c * x + s * z, center[1] - s * x + c * z] as Point2)
}

/** Plan footprint of a feature (walls and channels: the offset polygon of each segment). */
export function footprints(f: SanctuaryFeature): Point2[][] {
  switch (f.kind) {
    case 'altar': {
      const box = rotatedRect(f.center, f.length.value, f.width.value, f.rotation)
      if (!f.steps || f.steps.count.value === 0) return [box]
      // The flight of steps occupies a rectangle against one face (local x = length, local z = width).
      const out = f.steps.count.value * f.steps.tread.value
      const [dx, dz] = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[f.steps.side]
      const lx = dx ? out : f.length.value
      const lz = dz ? out : f.width.value
      const ox = dx * (f.length.value / 2 + out / 2)
      const oz = dz * (f.width.value / 2 + out / 2)
      const a = (f.rotation * Math.PI) / 180
      const c: Point2 = [f.center[0] + Math.cos(a) * ox + Math.sin(a) * oz, f.center[1] - Math.sin(a) * ox + Math.cos(a) * oz]
      return [box, rotatedRect(c, lx, lz, f.rotation)]
    }
    case 'building':
      return [rotatedRect(f.center, f.length.value, f.width.value, f.rotation)]
    case 'cistern': {
      const rim = 2 * f.rimWidth.value
      if (f.shape === 'circle') return [rotatedRect(f.center, f.diameter!.value + rim, f.diameter!.value + rim, 0)]
      return [rotatedRect(f.center, f.length!.value + rim, f.width!.value + rim, f.rotation)]
    }
    case 'wall':
    case 'channel': {
      const w = f.kind === 'wall' ? f.thickness.value : f.width.value
      const pts = f.kind === 'wall' && f.closed ? [...f.polyline, f.polyline[0]] : f.polyline
      return pts.slice(1).map((b, i) => {
        const a = pts[i]
        const L = Math.hypot(b[0] - a[0], b[1] - a[1])
        const rot = (-Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI
        return rotatedRect([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], L, w, rot)
      })
    }
  }
}

/** Convex polygon overlap by separating axes (touching edges do not count). */
export function convexOverlap(a: Point2[], b: Point2[], eps = 1e-6): boolean {
  for (const poly of [a, b])
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]
      const q = poly[(i + 1) % poly.length]
      const nx = q[1] - p[1]
      const nz = p[0] - q[0]
      const proj = (pts: Point2[]) => pts.map((v) => v[0] * nx + v[1] * nz)
      const pa = proj(a)
      const pb = proj(b)
      const l = Math.hypot(nx, nz)
      if (Math.max(...pa) <= Math.min(...pb) + eps * l || Math.max(...pb) <= Math.min(...pa) + eps * l) return false
    }
  return true
}
