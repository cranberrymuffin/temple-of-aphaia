// Types and pure helpers for the sanctuary contract (src/data/schemas/sanctuary.schema.json).
// Coordinates: metres in the temple frame (x east, z south, origin at the stylobate centre).
// Levels (terrace levels, baseLevel) are metres relative to the stylobate top. No `three`.
import { isSimple, offsetPolyline, pointInPolygon, triangulate } from './polygon'
import type { Confidence } from './types'

export type Point2 = [number, number]
export type Side = 'n' | 's' | 'e' | 'w'

export interface Measure {
  value: number
  unit: 'm' | 'deg' | 'count' | 'ratio'
  /** published = read in the text; plan = measured on the digitised site plan. */
  source: 'published' | 'plan'
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
  uncertaintyM?: number
  note?: string
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

export interface FalloffOverride {
  edgeDrop: Measure
  slope: Measure
}

export interface Terrace {
  polygon: Point2[]
  /** Surface level relative to the stylobate top (m). */
  level: Measure
  /** Uniform falloff for this terrace's edges instead of the directional default. */
  falloff?: FalloffOverride
  /** Listed but not depicted (user decision): left out of the terrain. */
  hiddenReason?: string
  /** Material of the exposed edge faces (retaining masonry or rock face); default rubble. */
  edgeFace?: EdgeFace
  /** Per polygon edge (edge i from point i to i + 1); overrides edgeFace. */
  edgeFaces?: EdgeFace[]
  note?: string
}

export type EdgeFace = 'rubble' | 'ashlar' | 'older' | 'rock'

export type Dir<T> = { n: T; e: T; s: T; w: T }

/** Sparse, conjectural terrain: terraces + retaining walls (wall features, role terrace) + directional hill falloff. */
export interface TerrainDesc {
  confidence: 'conjectural'
  sourceIds: string[]
  note?: string
  terraces: Record<string, Terrace>
  falloff: { edgeDrop: Dir<Measure>; slope: Dir<Measure>; radius: Measure }
  dem?: {
    file: string
    ref: string
    verified: boolean
    note?: string
    /** Conjectural DSM correction: within radius (m) of a terrace edge the ground stays at least drop (m) below it. */
    nearTerraceClamp?: { radius: Measure; drop: Measure; hold?: Measure; note?: string }
  }
}

interface FeatureBase {
  name: string
  phase: Phase
  placement: Placement
  sourceIds: string[]
  confidence: Confidence
  note?: string
  /** Fixed base level relative to the stylobate top; otherwise the base follows the terrain. */
  baseLevel?: number
  /** Shown, but uncertain at the display date (About panel). */
  uncertain?: string
  /** Adjoining features of one complex may touch. */
  complex?: string
  /** Listed but not depicted whatever the display date (user decision); the reason goes to the About panel. */
  hiddenReason?: string
}

export interface Steps {
  count: Measure
  rise: Measure
  tread: Measure
  side: Side
}

export interface AltarFeature extends FeatureBase {
  kind: 'altar'
  center: Point2
  rotation: number
  length: Measure
  width: Measure
  height: Measure
  steps?: Steps
  /** Raised rear screen on the side opposite the steps, rising above the altar top. */
  backScreen?: { height: Measure; thickness: Measure }
}

export interface BaseFeature extends FeatureBase {
  kind: 'base'
  center: Point2
  rotation: number
  length: Measure
  width: Measure
  height: Measure
  /** Placeholder block for the statue on top (Step 4 may replace it). */
  figure?: { height: Measure; width: Measure; depth: Measure }
}

export interface Door {
  wall?: Side
  offset: number
  width: Measure
  height: Measure
}

export interface CrossWall {
  axis: 'x' | 'z'
  offset: number
  from: number
  to: number
  thickness: Measure
  doors: Door[]
}

export interface Roof {
  /** gabled (default): two pitches, gables on the end walls; hipped: four pitches; pent: one pitch, high on highSide. */
  form?: 'gabled' | 'hipped' | 'pent'
  highSide?: Side
  ridge: 'x' | 'z'
  ridgeOffset?: number
  ridgeHeight: Measure
  overhang: Measure
  tiled?: boolean
  confidence: Confidence
  note?: string
}

export interface BuildingFeature extends FeatureBase {
  kind: 'building'
  role: 'propylon' | 'house' | 'bath' | 'ancillary' | 'other'
  center: Point2
  rotation: number
  length: Measure
  width: Measure
  wallHeight: Measure
  wallThickness: Measure
  doors: Door[]
  openSides?: Side[]
  crossWalls?: CrossWall[]
  columns?: { shape: 'octagonal' | 'round' | 'square'; diameter: Measure; positions: Point2[] }
  architraves?: { axis: 'x' | 'z'; offset: number; from: number; to: number; depth: Measure; height: Measure }[]
  roof?: Roof
  steps?: Steps
  /** Small sculpture on the roof ridge (placeholder block). */
  roofOrnament?: { width: Measure; height: Measure }
}

export interface WallFeature extends FeatureBase {
  kind: 'wall'
  role: 'terrace' | 'peribolos' | 'fence' | 'other'
  polyline: Point2[]
  closed?: boolean
  thickness: Measure
  /** Height above the highest ground under the wall (0 = top flush with the upper terrace). */
  height: Measure
  top?: 'level' | 'follow'
  /** Masonry of the wall body: one kind, or one per segment (material id for Step 4). Default rubble. */
  masonry?: Masonry | Masonry[]
  /** Superstructures on the wall top, by segment: stone socle, mudbrick, coping (any may be 0). */
  parapets?: Parapet[]
}

export type Masonry = 'rubble' | 'ashlar' | 'older'

export interface Parapet {
  /** Segment indices (polyline segment i runs from point i to i + 1). */
  segments: number[]
  socle: Measure
  mudbrick: Measure
  coping: Measure
  /** Coping projection beyond each wall face (m). */
  overhang: Measure
}

export interface CisternFeature extends FeatureBase {
  kind: 'cistern'
  shape: 'rect' | 'circle' | 'pear'
  center: Point2
  rotation: number
  length?: Measure
  width?: Measure
  diameter?: Measure
  smallDiameter?: Measure
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
  /** Cut into the rock: the coping is flush with the ground instead of raised. */
  sunk?: boolean
}

export interface PavementFeature extends FeatureBase {
  kind: 'pavement'
  polygon: Point2[]
  thickness: Measure
}

export interface ColumnFeature extends FeatureBase {
  kind: 'column'
  center: Point2
  baseDiameter: Measure
  baseHeight: Measure
  lowerDiameter: Measure
  upperDiameter: Measure
  height: Measure
  flutes: Measure
  capital: { kind: 'ionic' | 'doric'; width: Measure; height: Measure }
  crowning?: { kind: 'sphinx'; height: Measure }
}

export type SanctuaryFeature =
  | AltarFeature
  | BaseFeature
  | BuildingFeature
  | WallFeature
  | CisternFeature
  | ChannelFeature
  | PavementFeature
  | ColumnFeature

export interface HiddenFeature {
  name: string
  phase: Phase
  sourceIds: string[]
  reason: string
  note?: string
}

export interface SanctuaryDoc {
  meta: { status: 'provisional' | 'merged'; note: string; displayYear: number; displayLabel: string }
  temple: { foundationDepth: Measure; rampWidth: Measure; note?: string }
  terrain: TerrainDesc
  features: Record<string, SanctuaryFeature>
  hidden: Record<string, HiddenFeature>
}

/** A feature is shown when its phase spans the display year (open ends count as spanning). */
export function isShown(phase: Phase, year: number): boolean {
  return (phase.fromYear === null || phase.fromYear <= year) && (phase.toYear === null || year <= phase.toYear)
}

/** Shown in the scene: in phase at the display year and not hidden by decision. */
export function isDisplayed(f: SanctuaryFeature, year: number): boolean {
  return !f.hiddenReason && isShown(f.phase, year)
}

export function partitionByPhase(doc: SanctuaryDoc): { shown: string[]; hidden: string[] } {
  const shown: string[] = []
  const hidden: string[] = []
  for (const [id, f] of Object.entries(doc.features)) (isDisplayed(f, doc.meta.displayYear) ? shown : hidden).push(id)
  return { shown, hidden: [...hidden, ...Object.keys(doc.hidden ?? {})] }
}

const measuresOf = (o: unknown, path: string, out: [string, Measure][]) => {
  if (!o || typeof o !== 'object') return
  if ('unit' in o && 'ref' in o && 'value' in o) {
    out.push([path, o as Measure])
    return
  }
  for (const [k, v] of Object.entries(o)) measuresOf(v, path ? `${path}.${k}` : k, out)
}

/** Reference problems the schema cannot express. */
export function sanctuaryRefErrors(doc: SanctuaryDoc, sourceIds: Set<string>): string[] {
  const errs: string[] = []
  const T = doc.terrain
  const terraces = Object.entries(T.terraces)
  for (const [id, f] of Object.entries(doc.features)) {
    for (const s of [...f.sourceIds, ...f.phase.sourceIds, f.placement.ref]) if (!sourceIds.has(s)) errs.push(`${id}: unknown source ${s}`)
    const ms: [string, Measure][] = []
    measuresOf(f, '', ms)
    for (const [k, m] of ms) if (!sourceIds.has(m.ref)) errs.push(`${id}.${k}: unknown source ${m.ref}`)
    if (f.kind === 'channel' && f.feeds && doc.features[f.feeds]?.kind !== 'cistern') errs.push(`${id}: feeds ${f.feeds} is not a cistern`)
    if (f.kind === 'building') {
      for (const d of f.doors) {
        if (!d.wall) {
          errs.push(`${id}: outer door without a wall`)
          continue
        }
        const wallLen = d.wall === 'n' || d.wall === 's' ? f.length.value : f.width.value
        if (Math.abs(d.offset) + d.width.value / 2 > wallLen / 2 - f.wallThickness.value) errs.push(`${id}: door on ${d.wall} wall does not fit`)
        if (d.height.value >= f.wallHeight.value) errs.push(`${id}: door taller than the wall`)
        if (f.openSides?.includes(d.wall)) errs.push(`${id}: door on an open side`)
      }
      for (const cw of f.crossWalls ?? [])
        for (const d of cw.doors)
          if (d.offset - d.width.value / 2 < Math.min(cw.from, cw.to) || d.offset + d.width.value / 2 > Math.max(cw.from, cw.to))
            errs.push(`${id}: cross-wall door does not fit`)
    }
    if ((f.kind === 'wall' || f.kind === 'channel') && f.polyline.some((p, i) => i > 0 && Math.hypot(p[0] - f.polyline[i - 1][0], p[1] - f.polyline[i - 1][1]) < 1e-6))
      errs.push(`${id}: repeated polyline point`)
    if (['altar', 'base', 'building', 'cistern', 'column'].includes(f.kind) && f.baseLevel === undefined) {
      const c = (f as { center: Point2 }).center
      if (!terraces.some(([, t]) => pointInPolygon(t.polygon, c)) && !f.uncertain) errs.push(`${id}: not on a terrace`)
    }
  }
  for (const [id, h] of Object.entries(doc.hidden ?? {}))
    for (const s of [...h.sourceIds, ...h.phase.sourceIds]) if (!sourceIds.has(s)) errs.push(`hidden ${id}: unknown source ${s}`)
  for (const s of T.sourceIds) if (!sourceIds.has(s)) errs.push(`terrain: unknown source ${s}`)
  const tms: [string, Measure][] = []
  measuresOf({ falloff: T.falloff, temple: doc.temple }, '', tms)
  for (const [, t] of terraces) measuresOf(t, '', tms)
  for (const [k, m] of tms) if (!sourceIds.has(m.ref)) errs.push(`terrain/temple ${k}: unknown source ${m.ref}`)
  for (const [id, t] of terraces) if (!isSimple(t.polygon)) errs.push(`terrace ${id}: polygon is not simple`)
  const tris = terraces.filter(([, t]) => isSimple(t.polygon)).map(([id, t]) => [id, triangulate(t.polygon)] as const)
  for (let i = 0; i < tris.length; i++)
    for (let j = i + 1; j < tris.length; j++)
      if (tris[i][1].some((a) => tris[j][1].some((b) => convexOverlap(a, b, 1e-6)))) errs.push(`terraces ${tris[i][0]} and ${tris[j][0]} overlap`)
  return errs
}

// ---- footprints (plan polygons) ---------------------------------------------------------------

/** Local (x along length, z along width) to world; positive rotation turns local x toward north (-z). */
export function localToWorld2(c: Point2, rotationDeg: number) {
  const a = (rotationDeg * Math.PI) / 180
  const cs = Math.cos(a)
  const sn = Math.sin(a)
  return (x: number, z: number): Point2 => [c[0] + cs * x + sn * z, c[1] - sn * x + cs * z]
}

export function rotatedRect(center: Point2, length: number, width: number, rotationDeg: number): Point2[] {
  const T = localToWorld2(center, rotationDeg)
  return [T(-length / 2, -width / 2), T(length / 2, -width / 2), T(length / 2, width / 2), T(-length / 2, width / 2)]
}

/** Rectangle occupied by a flight of steps against one side of a local L x W block. */
export function stepsRect(center: Point2, L: number, W: number, rotation: number, s: Steps): Point2[] {
  const out = s.count.value * s.tread.value
  const [dx, dz] = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[s.side]
  const T = localToWorld2(center, rotation)
  return rotatedRect(T(dx * (L / 2 + out / 2), dz * (W / 2 + out / 2)), dx ? out : L, dz ? out : W, rotation)
}

/** Circumscribed 32-gon of a circle (covers the tessellated shapes of every tier). */
export function circlePolygon(c: Point2, r: number, n = 32): Point2[] {
  const R = r / Math.cos(Math.PI / n)
  return Array.from({ length: n }, (_, i) => [c[0] + R * Math.cos((2 * Math.PI * i) / n), c[1] + R * Math.sin((2 * Math.PI * i) / n)] as Point2)
}

/** Convex hull (monotone chain) of points. */
export function convexHull(pts: Point2[]): Point2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: Point2, a: Point2, b: Point2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Point2[] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: Point2[] = []
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/** Pear outline: convex hull of a large circle (at local -x) and a small one (at local +x), `segs` per circle. */
export function pearOutline(center: Point2, length: number, diameter: number, small: number, rotation: number, segs = 24, grow = 0): Point2[] {
  const T = localToWorld2(center, rotation)
  const R = diameter / 2 + grow
  const r = small / 2 + grow
  const c1 = -length / 2 + diameter / 2
  const c2 = length / 2 - small / 2
  const pts: Point2[] = []
  for (let i = 0; i < segs; i++) {
    const a = (2 * Math.PI * i) / segs
    pts.push(T(c1 + R * Math.cos(a), R * Math.sin(a)), T(c2 + r * Math.cos(a), r * Math.sin(a)))
  }
  return convexHull(pts)
}

/** Plan footprint of a feature as convex polygons (walls and channels: one per segment). */
export function footprints(f: SanctuaryFeature): Point2[][] {
  switch (f.kind) {
    case 'altar': {
      const box = rotatedRect(f.center, f.length.value, f.width.value, f.rotation)
      return f.steps && f.steps.count.value > 0 ? [box, stepsRect(f.center, f.length.value, f.width.value, f.rotation, f.steps)] : [box]
    }
    case 'base':
      return [rotatedRect(f.center, f.length.value, f.width.value, f.rotation)]
    case 'building': {
      const box = rotatedRect(f.center, f.length.value, f.width.value, f.rotation)
      return f.steps && f.steps.count.value > 0 ? [box, stepsRect(f.center, f.length.value, f.width.value, f.rotation, f.steps)] : [box]
    }
    case 'cistern': {
      const rw = f.rimWidth.value
      if (f.shape === 'circle') return [circlePolygon(f.center, f.diameter!.value / 2 + rw)]
      if (f.shape === 'pear') return [pearOutline(f.center, f.length!.value, f.diameter!.value, f.smallDiameter!.value, f.rotation, 24, rw)]
      return [rotatedRect(f.center, f.length!.value + 2 * rw, f.width!.value + 2 * rw, f.rotation)]
    }
    case 'pavement':
      return [f.polygon]
    case 'column':
      return [circlePolygon(f.center, f.baseDiameter.value / 2)]
    case 'wall':
    case 'channel': {
      // The same mitred outline the generators extrude, one quad per segment.
      const w = f.kind === 'wall' ? f.thickness.value : f.width.value * 1.5
      const closed = f.kind === 'wall' && !!f.closed
      const { left, right } = offsetPolyline(f.polyline, w, closed)
      const L = closed ? [...left, left[0]] : left
      const R = closed ? [...right, right[0]] : right
      return L.slice(1).map((_, i) => [L[i], L[i + 1], R[i + 1], R[i]])
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
