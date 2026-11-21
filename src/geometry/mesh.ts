// Pure mesh-building helpers (no `three`). Flat faces get world-anchored planar UVs in metres so
// ornament textures tile continuously across blocks.
import type { GeometryGroup, GroupPart } from './types'

export type Vec3 = [number, number, number]

export interface PaletteEntryLike {
  color: string
  pattern: string
}
export type PaletteLike = Record<string, PaletteEntryLike>

/** Which palette entry paints each element. Step 4 refines the mapping; ids must exist in palette.json. */
export const ELEMENT_PALETTE: Record<string, string> = {
  ground: '',
  crepidoma: 'step-limestone',
  stylobate: 'step-limestone',
  ramp: 'step-limestone',
  'peristyle-column': 'shaft-stucco',
  'column-shaft': 'shaft-stucco',
  echinus: 'capital-stucco',
  abacus: 'capital-stucco',
  architrave: 'architrave',
  taenia: 'taenia-red',
  regulae: 'regula',
  guttae: 'guttae-white',
  frieze: 'architrave',
  triglyphs: 'triglyph-black',
  metopes: 'metope',
  cornice: 'corona-white',
  mutules: 'mutule-black',
  'raking-geison': 'raking-corona-soffit',
  tympanum: 'tympanum-blue',
  roof: 'roof-tile',
  'roof-tiles': 'roof-tile',
  ceiling: 'marble',
  'cella-walls': 'cella-wall-upper',
  antae: 'cella-wall-upper',
  'porch-columns': 'shaft-stucco',
  'porch-entablature': 'architrave',
  'cella-floor': 'cella-floor-red',
  threshold: 'marble',
  'interior-step': 'cella-floor-red',
  // Sanctuary (Step 3b; Step 4 refines the paint).
  terrain: '',
  sea: '',
  altar: 'step-limestone',
  'sanctuary-building': 'house-stucco',
  'sanctuary-floor': 'step-limestone',
  'sanctuary-wall': 'rubble-stone',
  'ashlar-wall': 'ashlar-wall',
  'older-wall': 'older-masonry',
  // Natural rock faces at terrace edges.
  'rock-face': 'rock-face',
  mudbrick: 'mudbrick',
  'wall-coping': 'wall-coping',
  'sculpture-placeholder': 'marble',
  cistern: 'step-limestone',
  channel: 'step-limestone',
  'statue-base': 'marble',
  pavement: 'pavement',
  timber: 'timber',
  'propylon-column': 'shaft-stucco',
  'sanctuary-roof': 'roof-tile-terracotta',
  'votive-column': 'marble',
  sphinx: 'marble',
  'interior-columns-lower': 'shaft-stucco',
  'interior-epistyle': 'architrave',
  'interior-columns-upper': 'shaft-stucco',
  // Step 4: painted moulding bands (src/geometry/ornament.ts) and pediment figures (figures.ts).
  cymatium: 'cornice-hawksbeak',
  'raking-cymatium': 'raking-cymatium',
  sima: 'sima-palmette',
  'interior-crown': 'interior-crown-meander',
  'pediment-figures': 'figure-armour',
  'figure-flesh': 'figure-flesh',
  'figure-armour': 'figure-armour',
  'figure-shield': 'figure-shield',
  'figure-hair': 'figure-hair',
  'athena-aegis': 'athena-aegis',
  'archer-vest': 'archer-vest-yellow',
  'archer-costume': 'archer-diamond-pattern',
  // Cult statue base and stand-in (cult.ts).
  'cult-base': 'marble',
  'cult-statue': 'athena-aegis',
}

/** Unpainted ground colour (not a reconstruction claim, so not in palette.json). */
const GROUND_RGB: Vec3 = [146, 132, 104]
/** Unpainted sea colour (scenery, not a reconstruction claim). */
const SEA_RGB: Vec3 = [58, 104, 140]
export const NO_PALETTE = 0xffff

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2])
export const norm = (a: Vec3): Vec3 => {
  const l = len(a)
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]
}

/** Tangent frame for world-anchored planar UVs on a face with normal n. */
function uvAxes(n: Vec3): [Vec3, Vec3] {
  if (Math.abs(n[1]) > 0.9) return [[1, 0, 0], [0, 0, n[1] > 0 ? -1 : 1]]
  const t = norm(cross([0, 1, 0], n))
  return [t, norm(cross(n, t))]
}

function hexToRgb(hex: string): Vec3 {
  const v = parseInt(hex.replace('#', ''), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

export class MeshBuilder {
  readonly pos: number[] = []
  readonly nor: number[] = []
  readonly uv: number[] = []
  readonly idx: number[] = []
  readonly parts: GroupPart[] = []
  /** Palette id per vertex (a part can repaint, e.g. capital vs shaft inside one column group). */
  readonly vpal: string[] = []
  private paint: string
  private partName: string | null = null
  private partStart = 0
  readonly name: string

  constructor(name: string) {
    if (!(name in ELEMENT_PALETTE)) throw new Error(`no palette mapping for element ${name}`)
    this.name = name
    this.paint = ELEMENT_PALETTE[name]
  }

  get vertexCount() {
    return this.pos.length / 3
  }

  vertex(p: Vec3, n: Vec3, uv: [number, number]): number {
    this.pos.push(p[0], p[1], p[2])
    this.nor.push(n[0], n[1], n[2])
    this.uv.push(uv[0], uv[1])
    this.vpal.push(this.paint)
    return this.pos.length / 3 - 1
  }

  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c)
  }

  /** Planar convex polygon, counter-clockwise when seen from the side its normal points to. */
  polygon(pts: Vec3[]) {
    if (pts.length < 3) return
    let n: Vec3 = [0, 0, 0]
    for (let i = 1; i + 1 < pts.length; i++) n = add(n, cross(sub(pts[i], pts[0]), sub(pts[i + 1], pts[0])))
    if (len(n) < 1e-12) return
    n = norm(n)
    const [tu, tv] = uvAxes(n)
    const base = this.vertexCount
    for (const p of pts) this.vertex(p, n, [dot(p, tu), dot(p, tv)])
    for (let i = 1; i + 1 < pts.length; i++) {
      const a = pts[0]
      // Skip slivers and fan triangles whose winding disagrees with the polygon (near-collinear points).
      const tn = cross(sub(pts[i], a), sub(pts[i + 1], a))
      if (len(tn) > 1e-9 && dot(tn, n) > 0) this.tri(base, base + i, base + i + 1)
    }
  }

  /** Planar convex polygon whose winding is flipped if needed so its normal points along `dir`. */
  polygonFacing(pts: Vec3[], dir: Vec3) {
    let n: Vec3 = [0, 0, 0]
    for (let i = 1; i + 1 < pts.length; i++) n = add(n, cross(sub(pts[i], pts[0]), sub(pts[i + 1], pts[0])))
    this.polygon(dot(n, dir) < 0 ? [...pts].reverse() : pts)
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3) {
    this.polygon([a, b, c, d])
  }

  /**
   * Axis-aligned box. `omit` lists hidden contact faces that must not be emitted (no coplanar overlaps):
   * '+x' '-x' '+y' '-y' '+z' '-z'.
   */
  box(min: Vec3, max: Vec3, omit: Face[] = []) {
    const [x0, y0, z0] = min
    const [x1, y1, z1] = max
    if (x1 - x0 <= 1e-9 || y1 - y0 <= 1e-9 || z1 - z0 <= 1e-9) return
    const skip = new Set(omit)
    if (!skip.has('+x')) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1])
    if (!skip.has('-x')) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0])
    if (!skip.has('+y')) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0])
    if (!skip.has('-y')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1])
    if (!skip.has('+z')) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1])
    if (!skip.has('-z')) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0])
  }

  /** Starts a named sub-range (closes the previous one). */
  beginPart(name: string) {
    this.endPart()
    this.partName = name
    this.partStart = this.idx.length
    this.paint = ELEMENT_PALETTE[name] ?? ELEMENT_PALETTE[this.name]
  }

  endPart() {
    if (this.partName !== null && this.idx.length > this.partStart)
      this.parts.push({ name: this.partName, start: this.partStart, count: this.idx.length - this.partStart })
    this.partName = null
  }

  /** Appends another builder's geometry, transformed by a column-major 4x4 matrix (rigid + uniform scale). */
  append(other: MeshBuilder, m?: Float32Array | number[]) {
    const base = this.vertexCount
    for (let i = 0; i < other.pos.length; i += 3) {
      const p: Vec3 = [other.pos[i], other.pos[i + 1], other.pos[i + 2]]
      const n: Vec3 = [other.nor[i], other.nor[i + 1], other.nor[i + 2]]
      const tp = m ? transformPoint(m, p) : p
      const tn = m ? norm(transformDir(m, n)) : n
      this.pos.push(tp[0], tp[1], tp[2])
      this.nor.push(tn[0], tn[1], tn[2])
    }
    this.uv.push(...other.uv)
    this.vpal.push(...other.vpal)
    for (const i of other.idx) this.idx.push(base + i)
  }

  build(palette: PaletteLike, paletteIds: string[]): GeometryGroup {
    this.endPart()
    const paletteId = ELEMENT_PALETTE[this.name]
    const entry = paletteId ? palette[paletteId] : undefined
    if (paletteId && !entry) throw new Error(`palette entry ${paletteId} missing`)
    const nv = this.vertexCount
    const color = new Uint8Array(nv * 3)
    const colorIdx = new Uint16Array(nv)
    const cache = new Map<string, [Vec3, number]>()
    for (let i = 0; i < nv; i++) {
      const id = this.vpal[i]
      let c = cache.get(id)
      if (!c) {
        const e = id ? palette[id] : undefined
        if (id && !e) throw new Error(`palette entry ${id} missing`)
        if (e && entry && e.pattern !== entry.pattern) throw new Error(`${this.name}: part palette ${id} needs another material`)
        c = [e ? hexToRgb(e.color) : this.name === 'sea' ? SEA_RGB : GROUND_RGB, e ? paletteIds.indexOf(id) : NO_PALETTE]
        cache.set(id, c)
      }
      color.set(c[0], i * 3)
      colorIdx[i] = c[1]
    }
    return {
      name: this.name,
      material: entry ? entry.pattern : 'plain',
      paletteId,
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nor),
      uvs: new Float32Array(this.uv),
      color,
      colorIdx,
      indices: new Uint32Array(this.idx),
      parts: this.parts.length ? [...this.parts] : undefined,
    }
  }
}

export type Face = '+x' | '-x' | '+y' | '-y' | '+z' | '-z'

/** Collects one builder per element name. */
export class Collector {
  private readonly builders = new Map<string, MeshBuilder>()

  get(name: string): MeshBuilder {
    let b = this.builders.get(name)
    if (!b) {
      b = new MeshBuilder(name)
      this.builders.set(name, b)
    }
    return b
  }

  build(palette: PaletteLike): GeometryGroup[] {
    const ids = Object.keys(palette)
    return [...this.builders.values()].filter((b) => b.idx.length > 0).map((b) => b.build(palette, ids))
  }
}

// ---- 4x4 column-major matrices -------------------------------------------------------------

export function composeMatrix(t: Vec3, rotY: number, s: Vec3 = [1, 1, 1]): number[] {
  const c = Math.cos(rotY)
  const n = Math.sin(rotY)
  // R_y * S, column-major.
  return [c * s[0], 0, -n * s[0], 0, 0, s[1], 0, 0, n * s[2], 0, c * s[2], 0, t[0], t[1], t[2], 1]
}

export function transformPoint(m: ArrayLike<number>, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ]
}

export function transformDir(m: ArrayLike<number>, d: Vec3): Vec3 {
  return [
    m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
    m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
    m[2] * d[0] + m[6] * d[1] + m[10] * d[2],
  ]
}
