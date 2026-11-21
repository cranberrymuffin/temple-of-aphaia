// Rectangular building (propylon, house, bath, room) in a local frame (x along length, z along width;
// sides n = -z, s = +z, e = +x, w = -x), rotated into place. Walls with doors, open sides, interior
// cross walls, columns with timber architraves, an optional gabled roof (ridge offset allowed, gables
// filled on the end walls) and an outer flight of steps.
import type { BuildingFeature, Door, Side } from '../../data/sanctuary'
import { footprints, stepSequence } from '../../data/sanctuary'
import type { Collector, Face, Vec3 } from '../mesh'
import { MeshBuilder, composeMatrix, transformPoint } from '../mesh'
import type { Collider, GeneratorOutput, Level } from '../types'
import { SANCTUARY_CONVENTIONS as K, deg, groundRange, type SanctuaryContext } from './common'

export function building(id: string, f: BuildingFeature, ctx: SanctuaryContext, col: Collector): Omit<GeneratorOutput, 'groups'> {
  const L = f.length.value
  const W = f.width.value
  const t = f.wallThickness.value
  const H = f.wallHeight.value
  const open = new Set<Side>(f.openSides ?? [])
  const ranges = footprints(f).map((p) => groundRange(ctx.ground, p))
  const gMin = Math.min(...ranges.map((r) => r.min))
  const gMax = Math.max(...ranges.map((r) => r.max))
  const fixed = f.baseLevel !== undefined ? ctx.stylobateTop + f.baseLevel : undefined
  const floorY = fixed ?? gMax + K.floorRiseRatio * t
  const stepsDrop = f.steps ? stepSequence(f.steps).reduce((a, q) => a + q.rise, 0) : 0
  const bottom = Math.min(fixed ?? gMin, gMin, floorY - stepsDrop) - K.skirt
  const top = floorY + H
  const m = composeMatrix([f.center[0], 0, f.center[1]], deg(f.rotation))
  const walls = new MeshBuilder('sanctuary-building')
  const floor = new MeshBuilder('sanctuary-floor')
  const wood = new MeshBuilder('timber')
  // Columns are stone (the propylon's are octagonal, stuccoed, carrying timber architraves, per Furtwängler);
  // only the architraves are timber.
  const stone = new MeshBuilder('propylon-column')
  const roofB = new MeshBuilder('sanctuary-roof')
  const colliders: Collider[] = []
  const levels: Level[] = []
  const hx = L / 2
  const hz = W / 2

  const collide = (name: string, min: Vec3, max: Vec3) => {
    if (max[0] - min[0] <= 1e-9 || max[2] - min[2] <= 1e-9) return
    const c = transformPoint(m, [(min[0] + max[0]) / 2, 0, (min[2] + max[2]) / 2])
    colliders.push({ kind: 'obb', name: `${id}-${name}`, cx: c[0], cz: c[2], halfX: (max[0] - min[0]) / 2, halfZ: (max[2] - min[2]) / 2, rotY: deg(f.rotation), y0: min[1], y1: max[1] })
  }

  /**
   * Straight wall along local axis (x: u = x, v = z; z: u = z, v = x) over u in [u0, u1], v in [v0, v1],
   * from y0 to top, with door openings (centre u = offset). `ends` = [omit low end, omit high end].
   */
  const straight = (name: string, axis: 'x' | 'z', u0: number, u1: number, v0: number, v1: number, y0: number, doors: Door[], ends: [boolean, boolean], threshold: boolean) => {
    const box = (a0: number, a1: number, b0: number, b1: number, omit: Face[]) => {
      const min: Vec3 = axis === 'x' ? [a0, b0, v0] : [v0, b0, a0]
      const max: Vec3 = axis === 'x' ? [a1, b1, v1] : [v1, b1, a1]
      walls.box(min, max, omit)
      return [min, max] as const
    }
    const lo: Face = axis === 'x' ? '-x' : '-z'
    const hi: Face = axis === 'x' ? '+x' : '+z'
    const ds = doors.map((d) => [d.offset - d.width.value / 2, d.offset + d.width.value / 2, d.height.value] as const).sort((a, b) => a[0] - b[0])
    let cur = u0
    ds.forEach(([d0, d1, dh], i) => {
      const [mn, mx] = box(cur, d0, y0, top, ['-y', ...(cur === u0 && ends[0] ? [lo] : [])])
      collide(`${name}-${i}`, mn, mx)
      const [lmn, lmx] = box(d0, d1, floorY + dh, top, [lo, hi])
      collide(`${name}-lintel-${i}`, lmn, lmx)
      if (threshold) box(d0, d1, y0, floorY, ['-y', lo, hi])
      cur = d1
    })
    const [mn, mx] = box(cur, u1, y0, top, ['-y', ...(cur === u0 && ends[0] ? [lo] : []), ...(ends[1] ? [hi] : [])])
    collide(`${name}-${ds.length}`, mn, mx)
  }

  const outer = (s: Side) => f.doors.filter((d) => d.wall === s)
  if (!open.has('n')) straight('n-wall', 'x', -hx, hx, -hz, -hz + t, bottom, outer('n'), [false, false], true)
  if (!open.has('s')) straight('s-wall', 'x', -hx, hx, hz - t, hz, bottom, outer('s'), [false, false], true)
  const z0 = open.has('n') ? -hz : -hz + t
  const z1 = open.has('s') ? hz : hz - t
  if (!open.has('e')) straight('e-wall', 'z', z0, z1, hx - t, hx, bottom, outer('e'), [!open.has('n'), !open.has('s')], true)
  if (!open.has('w')) straight('w-wall', 'z', z0, z1, -hx, -hx + t, bottom, outer('w'), [!open.has('n'), !open.has('s')], true)
  ;(f.crossWalls ?? []).forEach((cw, i) => {
    const h = cw.thickness.value / 2
    straight(`cross-${i}`, cw.axis, Math.min(cw.from, cw.to), Math.max(cw.from, cw.to), cw.offset - h, cw.offset + h, floorY, cw.doors, [true, true], false)
  })

  // Floor; open sides show the socle edge down to the skirt (unless a flight of steps covers it).
  const x0 = open.has('w') ? -hx : -hx + t
  const x1 = open.has('e') ? hx : hx - t
  floor.polygonFacing([[x0, floorY, z0], [x1, floorY, z0], [x1, floorY, z1], [x0, floorY, z1]], [0, 1, 0])
  const edge: Record<Side, [Vec3, Vec3, Vec3]> = {
    n: [[x0, 0, z0], [x1, 0, z0], [0, 0, -1]],
    s: [[x0, 0, z1], [x1, 0, z1], [0, 0, 1]],
    e: [[x1, 0, z0], [x1, 0, z1], [1, 0, 0]],
    w: [[x0, 0, z0], [x0, 0, z1], [-1, 0, 0]],
  }
  for (const side of open) {
    if (f.steps?.side === side) continue
    const [a, b, dir] = edge[side]
    floor.polygonFacing([[a[0], bottom, a[2]], [b[0], bottom, b[2]], [b[0], floorY, b[2]], [a[0], floorY, a[2]]], dir)
  }

  // Outer flight(s) of steps, descending away from the floor (upper flight, landing, lower flight).
  if (f.steps) {
    const seq = stepSequence(f.steps)
    const n = seq.length
    const s = f.steps.side
    const sign = s === 'e' || s === 's' ? 1 : -1
    const alongX = s === 'n' || s === 's' // the flight spans local x when it is on the n or s side
    const base = alongX ? hz : hx
    // Offsets (outward from the wall face) and tops of every step.
    const o: number[] = [0]
    const yTop: number[] = [floorY]
    seq.forEach((q, j) => {
      o.push(o[j] + q.depth)
      yTop.push(yTop[j] - q.rise)
    })
    // Between the side walls when they exist (flanked flight), else the full side.
    const a0 = alongX ? (open.has('w') ? -hx : -hx + t) : open.has('n') ? -hz : -hz + t
    const a1 = alongX ? (open.has('e') ? hx : hx - t) : open.has('s') ? hz : hz - t
    const inner: Face = alongX ? (sign > 0 ? '-z' : '+z') : sign > 0 ? '-x' : '+x'
    const outerF: Face = alongX ? (sign > 0 ? '+z' : '-z') : sign > 0 ? '+x' : '-x'
    // Where a side wall stands, it continues beside the flight as a cheek wall (the orthostate walls flanking
    // the stair), one block per step from the skirt up to cheekHeight above that tread (default: the floor), so
    // the steps' ends abut it and the footprint is filled.
    const cheekLo = alongX ? !open.has('w') : !open.has('n')
    const cheekHi = alongX ? !open.has('e') : !open.has('s')
    const endLo: Face = alongX ? '-x' : '-z'
    const endHi: Face = alongX ? '+x' : '+z'
    const ch = f.steps.cheekHeight?.value ?? Infinity
    const span = (j: number): [number, number] => (sign > 0 ? [base + o[j - 1], base + o[j]] : [-base - o[j], -base - o[j - 1]])
    for (const [has, w0, w1, face] of [
      [cheekLo, alongX ? -hx : -hz, a0, endHi],
      [cheekHi, a1, alongX ? hx : hz, endLo],
    ] as const) {
      if (!has) continue
      const wf = face === endHi ? w1 : w0
      for (let j = 1; j <= n; j++) {
        const top = Math.min(floorY, yTop[j] + ch)
        const [c0, c1] = span(j)
        const min: Vec3 = alongX ? [w0, bottom, c0] : [c0, bottom, w0]
        const max: Vec3 = alongX ? [w1, top, c1] : [c1, top, w1]
        // The face toward the building is covered by the previous (taller) block or the side wall; toward the
        // flight only the part above the tread shows.
        floor.box(min, max, ['-y', inner, face])
        if (top - yTop[j] > 1e-9) {
          const q: Vec3[] = alongX
            ? [[wf, yTop[j], c0], [wf, yTop[j], c1], [wf, top, c1], [wf, top, c0]]
            : [[c0, yTop[j], wf], [c1, yTop[j], wf], [c1, top, wf], [c0, top, wf]]
          floor.polygonFacing(q, alongX ? [face === endHi ? 1 : -1, 0, 0] : [0, 0, face === endHi ? 1 : -1])
        }
        const c = transformPoint(m, [(min[0] + max[0]) / 2, 0, (min[2] + max[2]) / 2])
        colliders.push({ kind: 'obb', name: `${id}-cheek-${j}`, cx: c[0], cz: c[2], halfX: (max[0] - min[0]) / 2, halfZ: (max[2] - min[2]) / 2, rotY: deg(f.rotation), y0: bottom, y1: top })
      }
    }
    for (let j = 1; j <= n; j++) {
      const [c0, c1] = span(j)
      const min: Vec3 = alongX ? [a0, bottom, c0] : [c0, bottom, a0]
      const max: Vec3 = alongX ? [a1, yTop[j], c1] : [c1, yTop[j], a1]
      floor.box(min, max, ['-y', inner, ...(j < n ? [outerF] : []), ...(cheekLo ? [endLo] : []), ...(cheekHi ? [endHi] : [])])
      // Riser above the previous step's top at this step's inner edge (the part not shared with step j-1).
      const oi = sign * (base + o[j - 1])
      const riser: Vec3[] = alongX
        ? [[a0, yTop[j], oi], [a1, yTop[j], oi], [a1, yTop[j - 1], oi], [a0, yTop[j - 1], oi]]
        : [[oi, yTop[j], a0], [oi, yTop[j], a1], [oi, yTop[j - 1], a1], [oi, yTop[j - 1], a0]]
      if (j > 1 || open.has(s)) floor.polygonFacing(riser, alongX ? [0, 0, sign] : [sign, 0, 0])
      const c = transformPoint(m, [(min[0] + max[0]) / 2, 0, (min[2] + max[2]) / 2])
      levels.push({ name: `${id}-step-${j}`, y: yTop[j], minX: c[0] - (max[0] - min[0]) / 2, maxX: c[0] + (max[0] - min[0]) / 2, minZ: c[2] - (max[2] - min[2]) / 2, maxZ: c[2] + (max[2] - min[2]) / 2, rotY: deg(f.rotation) })
    }
  }

  // Timber architraves and stone columns.
  const archH = Math.max(0, ...(f.architraves ?? []).map((a) => a.height.value))
  for (const a of f.architraves ?? []) {
    const d = a.depth.value / 2
    const u0 = Math.min(a.from, a.to)
    const u1 = Math.max(a.from, a.to)
    const min: Vec3 = a.axis === 'x' ? [u0, top - a.height.value, a.offset - d] : [a.offset - d, top - a.height.value, u0]
    const max: Vec3 = a.axis === 'x' ? [u1, top, a.offset + d] : [a.offset + d, top, u1]
    wood.box(min, max, a.axis === 'x' ? ['+x', '-x'] : ['+z', '-z'])
  }
  if (f.columns) {
    // The diameter is across flats.
    const sides = f.columns.shape === 'octagonal' ? 8 : 16
    const r = f.columns.diameter.value / 2 / Math.cos(Math.PI / sides) // across-flats diameter
    const colTop = top - archH
    for (const [cx, cz] of f.columns.positions) {
      const ring = Array.from({ length: sides }, (_, i) => {
        const a = (2 * Math.PI * (i + 0.5)) / sides
        return [cx + r * Math.cos(a), cz + r * Math.sin(a)] as const
      })
      for (let i = 0; i < sides; i++) {
        const p = ring[i]
        const q = ring[(i + 1) % sides]
        stone.polygonFacing(
          [
            [p[0], floorY, p[1]],
            [q[0], floorY, q[1]],
            [q[0], colTop, q[1]],
            [p[0], colTop, p[1]],
          ],
          [(p[0] + q[0]) / 2 - cx, 0, (p[1] + q[1]) / 2 - cz],
        )
      }
      const c = transformPoint(m, [cx, 0, cz])
      colliders.push({ kind: 'circle', name: `${id}-column`, x: c[0], z: c[2], r: f.columns.diameter.value / 2, y0: floorY, y1: colTop })
    }
  }

  if (f.roof) addRoof(f, roofB, walls, open, top, hx, hz, t)
  if (f.roofOrnament) {
    // Placeholder block astride the ridge at its middle (the gable sculpture of the Ministry board).
    if (!f.roof) throw new Error(`${id}: a roof ornament needs a ridge`)
    const ow = f.roofOrnament.width.value / 2
    const yr = top + f.roof.ridgeHeight.value + K.roofThickness
    const r = f.roof.ridgeOffset ?? 0
    const [cx, cz] = f.roof.ridge === 'x' ? [0, r] : [r, 0]
    // Sunk by its half-width times the steeper pitch so its base never floats above the slopes.
    const hv = f.roof.ridge === 'x' ? hz : hx
    const sink = ow * (f.roof.ridgeHeight.value / Math.max(1e-6, hv - Math.abs(r)))
    const ob = new MeshBuilder('sculpture-placeholder')
    ob.box([cx - ow, yr - sink, cz - ow], [cx + ow, yr + f.roofOrnament.height.value, cz + ow], ['-y'])
    col.get('sculpture-placeholder').append(ob, m)
  }

  col.get('sanctuary-building').append(walls, m)
  col.get('sanctuary-floor').append(floor, m)
  if (wood.idx.length) col.get('timber').append(wood, m)
  if (stone.idx.length) col.get(stone.name).append(stone, m)
  if (roofB.idx.length) col.get('sanctuary-roof').append(roofB, m)
  const c = transformPoint(m, [(x0 + x1) / 2, 0, (z0 + z1) / 2])
  levels.push({ name: `${id}-floor`, y: floorY, minX: c[0] - (x1 - x0) / 2, maxX: c[0] + (x1 - x0) / 2, minZ: c[2] - (z1 - z0) / 2, maxZ: c[2] + (z1 - z0) / 2, rotY: deg(f.rotation) })
  return { instances: [], colliders, levels }
}

/**
 * Gabled roof over the wall tops (local frame). Canonical frame: ridge along u (local x for ridge 'x',
 * local z for ridge 'z'), slopes across v. The underside passes through the outer wall faces at the wall
 * top on both eaves sides (so the ridge may sit off-centre with two pitches); the end walls carry gable
 * infills whose sloped tops touch the underside and are therefore omitted.
 */
function addRoof(f: BuildingFeature, roofB: MeshBuilder, walls: MeshBuilder, open: Set<Side>, top: number, hx: number, hz: number, t: number) {
  const R = f.roof!
  const ridgeX = R.ridge === 'x'
  const hu = ridgeX ? hx : hz // half-length along the ridge
  const hv = ridgeX ? hz : hx // half-width across
  const r = R.ridgeOffset ?? 0
  const rh = R.ridgeHeight.value
  const o = R.overhang.value
  const th = K.roofThickness
  const yr = top + rh
  const tanA = rh / (r + hv) // low-v side
  const tanB = rh / (hv - r) // high-v side
  const eA = top - o * tanA
  const eB = top - o * tanB
  // Map canonical (u, y, v) to local (x, y, z).
  const P = (u: number, y: number, v: number): Vec3 => (ridgeX ? [u, y, v] : [v, y, u])
  const U = hu + o
  const vA = -hv - o
  const vB = hv + o
  const up = (dirV: number): Vec3 => (ridgeX ? [0, 1, dirV] : [dirV, 1, 0])
  const alongU = (s: number): Vec3 => (ridgeX ? [s, 0, 0] : [0, 0, s])
  const alongV = (s: number): Vec3 => (ridgeX ? [0, 0, s] : [s, 0, 0])
  // Top and underside.
  roofB.polygonFacing([P(-U, eA + th, vA), P(U, eA + th, vA), P(U, yr + th, r), P(-U, yr + th, r)], up(-tanA))
  roofB.polygonFacing([P(-U, eB + th, vB), P(U, eB + th, vB), P(U, yr + th, r), P(-U, yr + th, r)], up(tanB))
  roofB.polygonFacing([P(-U, eA, vA), P(U, eA, vA), P(U, yr, r), P(-U, yr, r)], [-up(-tanA)[0], -1, -up(-tanA)[2]])
  roofB.polygonFacing([P(-U, eB, vB), P(U, eB, vB), P(U, yr, r), P(-U, yr, r)], [-up(tanB)[0], -1, -up(tanB)[2]])
  // Eave faces and gable bargeboards.
  roofB.polygonFacing([P(-U, eA, vA), P(U, eA, vA), P(U, eA + th, vA), P(-U, eA + th, vA)], alongV(-1))
  roofB.polygonFacing([P(-U, eB, vB), P(U, eB, vB), P(U, eB + th, vB), P(-U, eB + th, vB)], alongV(1))
  for (const s of [-1, 1]) {
    roofB.polygonFacing([P(s * U, eA, vA), P(s * U, yr, r), P(s * U, yr + th, r), P(s * U, eA + th, vA)], alongU(s))
    roofB.polygonFacing([P(s * U, eB, vB), P(s * U, yr, r), P(s * U, yr + th, r), P(s * U, eB + th, vB)], alongU(s))
  }
  // Gable infills on the end walls (perpendicular to the ridge) that exist.
  const endSides: [Side, number][] = ridgeX ? [['w', -1], ['e', 1]] : [['n', -1], ['s', 1]]
  for (const [side, s] of endSides) {
    if (open.has(side)) continue
    for (const [uu, dir] of [
      [s * hu, s],
      [s * (hu - t), -s],
    ] as const)
      walls.polygonFacing([P(uu, top, -hv), P(uu, top, hv), P(uu, yr, r)], alongU(dir))
  }
}
