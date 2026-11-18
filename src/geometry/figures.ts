// Pediment figure stand-ins (Step 4): blocky mannequins posed per src/data/pediments.json and fitted
// inside the tympanum (resolved.pediment). Each figure stands on the horizontal cornice in front of the
// tympanum and is scaled down until every vertex clears the raking soffit. Pure: no `three`.
// Proportions below are CONVENTIONS for stand-ins, not reconstruction claims.
import pediments from '../data/pediments.json'
import type { Resolved } from '../data/resolveDimensions'
import type { Collector, MeshBuilder, Vec3 } from './mesh'
import type { GeneratorOutput } from './types'

type Pose = 'standing' | 'striding' | 'lunging' | 'kneeling-archer' | 'fallen'
type Facing = 'left' | 'right' | 'front'

interface FigureSpec {
  id: string
  pose: Pose
  x: number
  facing?: Facing
  nameId?: string
}

/** Local box: z along the pediment (positive = the way the figure faces), y up, x outward. Units: figure heights. */
interface Part {
  min: Vec3
  max: Vec3
  paint: 'figure-flesh' | 'figure-armour' | 'figure-shield' | 'figure-hair' | 'athena-aegis' | 'archer-vest' | 'archer-costume'
  /** Rests on the cornice: its bottom face is a hidden contact face. */
  grounded?: boolean
}

export const FIGURE_CONVENTIONS = {
  /** Natural stand-in height of a standing figure (m); figures are never taller. */
  standingHeight: 1.5,
  /** Fraction of the local tympanum height a figure may fill. */
  fill: 0.94,
  /** Gap between the tympanum face and the back of a figure (m). */
  backGap: 0.06,
  /** Archer costume diamond tile (m). */
  diamondTile: 0.12,
  /** Per-figure depth step and scale step (m, fraction) so neighbouring figures never share a face plane. */
  depthStep: 0.004,
  scaleStep: 0.004,
  /** Local depth of the deepest part (shield front), in figure heights. */
  localDepth: 0.14,
}

const B = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, paint: Part['paint'], grounded = false): Part => ({
  min: [x0, y0, z0],
  max: [x1, y1, z1],
  paint,
  grounded,
})

/** Torso, head and helmet shared by the upright poses (hip height h, torso top t). */
function upper(h: number, t: number, lean: number, opts: { archer: boolean; athena: boolean }): Part[] {
  const torso: Part['paint'] = opts.athena ? 'athena-aegis' : opts.archer ? 'archer-costume' : 'figure-armour'
  const parts = [
    B(-0.09, h - 0.03, -0.11 + lean, 0.09, t, 0.11 + lean, torso),
    B(-0.06, t - 0.01, -0.05 + lean * 1.3, 0.06, t + 0.13, 0.07 + lean * 1.3, 'figure-flesh'),
    B(-0.065, t + 0.09, -0.06 + lean * 1.3, 0.065, t + 0.16, 0.075 + lean * 1.3, opts.archer ? 'archer-vest' : 'figure-hair'),
  ]
  if (opts.archer) parts.push(B(-0.095, h + 0.08, -0.115 + lean, 0.095, t - 0.04, 0.115 + lean, 'archer-vest'))
  return parts
}

function legs(h: number, spread: number, paint: Part['paint']): Part[] {
  return [
    B(-0.05, 0, -0.07 - spread, 0.05, h, 0.0 - spread * 0.2, paint, true),
    B(-0.048, 0, 0.01 + spread * 0.2, 0.052, h + 0.01, 0.075 + spread, paint, true),
  ]
}

/** Parts for a pose, in figure heights (standing = 1). */
export function poseParts(pose: Pose, opts: { archer: boolean; athena: boolean }): Part[] {
  const legPaint: Part['paint'] = opts.archer ? 'archer-costume' : 'figure-flesh'
  switch (pose) {
    case 'standing': {
      const parts = [...legs(0.48, 0, opts.athena ? 'athena-aegis' : legPaint), ...upper(0.48, 0.82, 0, opts)]
      parts.push(B(-0.04, 0.5, -0.18, 0.04, 0.8, -0.1, 'figure-flesh'), B(-0.04, 0.5, 0.1, 0.04, 0.8, 0.18, 'figure-flesh'))
      if (opts.athena) parts.push(B(0.1, 0.3, -0.24, 0.13, 0.78, 0.0, 'figure-shield'), B(-0.02, 0.0, 0.2, 0.02, 1.05, 0.23, 'figure-armour', true))
      return parts
    }
    case 'striding':
      return [
        ...legs(0.45, 0.14, legPaint),
        ...upper(0.45, 0.78, 0.06, opts),
        B(0.1, 0.38, 0.12, 0.14, 0.78, 0.36, 'figure-shield'),
        B(-0.035, 0.74, -0.16, 0.035, 0.98, -0.1, 'figure-flesh'),
      ]
    case 'lunging':
      return [
        B(-0.05, 0, -0.32, 0.05, 0.12, -0.04, legPaint, true),
        B(-0.048, 0, 0.12, 0.052, 0.3, 0.22, legPaint, true),
        B(-0.09, 0.22, -0.1, 0.09, 0.52, 0.16, 'figure-armour'),
        B(-0.06, 0.5, 0.1, 0.06, 0.63, 0.22, 'figure-flesh'),
        B(-0.065, 0.6, 0.11, 0.065, 0.68, 0.235, 'figure-hair'),
        B(0.1, 0.18, 0.2, 0.14, 0.55, 0.4, 'figure-shield'),
      ]
    case 'kneeling-archer':
      return [
        B(-0.05, 0, -0.3, 0.05, 0.1, 0.0, legPaint, true),
        B(-0.048, 0, 0.06, 0.052, 0.3, 0.17, legPaint, true),
        ...upper(0.26, 0.58, 0.0, opts),
        B(-0.035, 0.46, 0.1, 0.035, 0.52, 0.43, 'figure-flesh'),
        B(-0.02, 0.3, 0.42, 0.02, 0.72, 0.45, 'figure-hair'),
      ]
    case 'fallen':
      return [
        B(-0.07, 0, -0.9, 0.07, 0.11, -0.36, legPaint, true),
        B(-0.09, 0, -0.38, 0.09, 0.2, 0.02, 'figure-armour', true),
        B(-0.06, 0.02, 0.0, 0.06, 0.24, 0.14, 'figure-flesh', true),
        B(0.1, 0.0, -0.3, 0.13, 0.32, 0.02, 'figure-shield', true),
      ]
  }
}

export interface Field {
  /** Tympanum face (|x|) and the cornice outer face (|x|). */
  faceX: number
  outerX: number
  baseY: number
  halfZ: number
  apexY: number
}

/** Allowed top height (above the base) at plan position z. */
const allowed = (f: Field, z: number) => (f.apexY - f.baseY) * Math.max(0, 1 - Math.abs(z) / f.halfZ) * FIGURE_CONVENTIONS.fill

/** Largest scale (<= natural height) at which every vertex of the figure fits under the raking soffit. */
export function fitScale(parts: Part[], zc: number, dir: number, f: Field): number {
  const fits = (s: number) =>
    parts.every((p) =>
      [p.min[2], p.max[2]].every((lz) => {
        const z = zc + dir * lz * s
        return Math.abs(z) < f.halfZ && p.max[1] * s <= allowed(f, z)
      }),
    )
  let lo = 0
  let hi = FIGURE_CONVENTIONS.standingHeight
  if (fits(hi)) return hi
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2
    if (fits(mid)) lo = mid
    else hi = mid
  }
  return lo
}

/** Index range of one stand-in inside a generator group (lets the viewer hide it when a scan replaces it). */
export interface GroupRange {
  group: string
  start: number
  count: number
}

export interface PlacedFigure {
  id: string
  side: 'east' | 'west'
  pose: Pose
  scale: number
  z: number
  /** Top of the figure (m above the cornice). */
  top: number
  /** Plan distance to the neighbouring slot (m). */
  spacing: number
  ranges: GroupRange[]
}

export const SCAN_CONVENTIONS = {
  /** Gap between the tympanum and the back of a scanned figure (m). */
  backGap: 0.02,
  /** How far a scanned figure may project past the cornice edge (m): the originals' shields and limbs did. */
  overhang: 0.12,
  /** Deepest a cast's plinth is sunk into the cornice (m): the detected plinth can include a shield rim. */
  maxPlinth: 0.1,
  /** How far a scan may move toward the centre from its evenly spaced slot, as a fraction of the slot spacing. */
  shiftFraction: 0.6,
}

export interface ScanFit {
  scale: number
  /** World position of the canonical origin and the rotation about +y (radians). */
  position: [number, number, number]
  rotY: number
}

/**
 * Fits a scanned figure into its pediment slot. `points` are canonical scan vertices (metres, +y up,
 * presentation front +z, plinth top at `plinth`). The figure keeps its real size unless it must shrink to
 * clear the raking soffit, stay inside the field and keep its depth on the cornice (plus the overhang).
 * Canonical +x becomes the viewer's right (east front: -z; west front: +z).
 */
export function fitScan(points: ArrayLike<number>, plinth: number, side: 'east' | 'west', zc: number, f: Field, maxShift = 0): ScanFit {
  // The slots are evenly spaced placeholders: a scan may move toward the centre (by up to maxShift) when
  // that lets it keep more of its real size. The smallest shift within 2% of the best scale wins.
  if (maxShift > 0) {
    const inward = -Math.sign(zc) || 1
    let best = fitScan(points, plinth, side, zc, f)
    let bestZ = zc
    for (let d = 0.05; d <= maxShift + 1e-9; d += 0.05) {
      const t = fitScan(points, plinth, side, zc + inward * d, f)
      if (t.scale > best.scale * 1.02) {
        best = t
        bestZ = zc + inward * d
      }
    }
    return { ...best, position: [best.position[0], best.position[1], bestZ] }
  }
  const sx = side === 'east' ? 1 : -1
  const rightZ = side === 'east' ? -1 : 1
  let zmin = Infinity
  let zmax = -Infinity
  for (let i = 2; i < points.length; i += 3) {
    zmin = Math.min(zmin, points[i])
    zmax = Math.max(zmax, points[i])
  }
  const room = f.outerX + SCAN_CONVENTIONS.overhang - f.faceX - SCAN_CONVENTIONS.backGap
  const fits = (s: number) => {
    if ((zmax - zmin) * s > room) return false
    for (let i = 0; i < points.length; i += 3) {
      const y = points[i + 1] - plinth
      const z = zc + rightZ * points[i] * s
      if (Math.abs(z) >= f.halfZ) return false
      if (y > 0 && y * s > allowed(f, z)) return false
    }
    return true
  }
  let lo = 0
  let hi = 1
  if (!fits(hi)) {
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2
      if (fits(mid)) lo = mid
      else hi = mid
    }
    hi = lo
  }
  const s = hi
  const x = sx * (f.faceX + SCAN_CONVENTIONS.backGap - zmin * s)
  return { scale: s, position: [x, f.baseY - plinth * s, zc], rotY: (sx * Math.PI) / 2 }
}

/** Emits every figure of the west pediment and the displayed east option. */
export function figures(r: Resolved, col: Collector): Omit<GeneratorOutput, 'groups'> & { placed: PlacedFigure[] } {
  const P = r.pediment
  const field: Field = { faceX: P.tympanumX, outerX: r.roof.halfX, baseY: P.baseY, halfZ: P.halfZ, apexY: P.apexY }
  const east = pediments.eastOptions.find((o) => o.id === pediments.eastDisplayed)
  const sides: ['east' | 'west', FigureSpec[]][] = [
    ['west', pediments.west.figures as FigureSpec[]],
    ['east', (east?.figures ?? []) as FigureSpec[]],
  ]
  const body = col.get('pediment-figures')
  const costume = col.get('archer-costume')
  const placed: PlacedFigure[] = []
  const C = FIGURE_CONVENTIONS
  let k = 0
  for (const [side, specs] of sides) {
    const sx = side === 'east' ? 1 : -1
    // The viewer faces the pediment from outside: for the east front, viewer-left is south (+z).
    const leftZ = side === 'east' ? 1 : -1
    for (const f of specs) {
      k++
      const opts = { archer: f.nameId === 'trojan-archer', athena: f.nameId === 'athena' }
      const parts = poseParts(f.pose, opts)
      const zc = -f.x * leftZ * P.halfZ
      // Local +z = facing direction in plan; 'front' figures use their right-hand side as +z.
      const dir = f.facing === 'left' ? leftZ : f.facing === 'right' ? -leftZ : -leftZ
      const s = fitScale(parts, zc, dir, field) * (1 - C.scaleStep * (k % 5))
      if (s <= 0.05) continue
      // Keep the figure on the cornice: compress depth if the cornice projection is shallow.
      const room = field.outerX - field.faceX - C.backGap - C.depthStep * 12 - 0.03
      const dScale = Math.min(1, room / (2 * C.localDepth * s))
      const depthCentre = field.faceX + C.backGap + C.depthStep * (k % 12) + C.localDepth * s * dScale
      const r0 = [body.idx.length, costume.idx.length]
      for (const p of parts) {
        const b: MeshBuilder = p.paint === 'archer-costume' ? costume : body
        if (b === body) b.beginPart(p.paint)
        const zs = [zc + dir * p.min[2] * s, zc + dir * p.max[2] * s]
        const xs = [depthCentre + p.min[0] * s * dScale, depthCentre + p.max[0] * s * dScale].map((x) => sx * x)
        const v0 = b.vertexCount
        b.box(
          [Math.min(...xs), field.baseY + p.min[1] * s, Math.min(...zs)],
          [Math.max(...xs), field.baseY + p.max[1] * s, Math.max(...zs)],
          p.grounded && p.min[1] === 0 ? ['-y'] : [],
        )
        if (b === costume) for (let i = v0 * 2; i < b.uv.length; i++) b.uv[i] /= C.diamondTile
      }
      body.endPart()
      const ranges = [
        { group: body.name, start: r0[0], count: body.idx.length - r0[0] },
        { group: costume.name, start: r0[1], count: costume.idx.length - r0[1] },
      ].filter((g) => g.count > 0)
      placed.push({ id: f.id, side, pose: f.pose, scale: s, z: zc, top: Math.max(...parts.map((p) => p.max[1])) * s, spacing: specs.length > 1 ? (1.84 / (specs.length - 1)) * P.halfZ : 0, ranges })
    }
  }
  return { instances: [], colliders: [], levels: [], placed }
}
