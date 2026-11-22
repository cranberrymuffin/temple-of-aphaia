// Priests' houses outside the SE boundary wall (Ministry boards IMG_8187 / IMG_8191): each block is a solid walled
// volume standing on the rock outcrop under a hipped roof of four equal pitches. The front block has an open porch
// on its west face (the board's columns toward the gate): the temple's Doric column scaled to the eave, plus a solid end wall.
// Local frame per block: x along its length, z along its width, rotated into place. Pure (no `three`).
import type { HouseBlock, HouseInterior, HousesFeature } from '../../data/sanctuary'
import { rotatedRect } from '../../data/sanctuary'
import type { Collector, Face, Vec3 } from '../mesh'
import dimensions from '../../data/dimensions.json'
import { resolveDimensions } from '../../data/resolveDimensions'
import type { Dimensions } from '../../data/types'
import { columnMesh } from '../cella'
import { MeshBuilder, composeMatrix } from '../mesh'
import type { ColumnSpec } from '../../data/resolveDimensions'
import type { Collider, GeneratorOutput, Level } from '../types'
import { SANCTUARY_CONVENTIONS as K, deg, groundRange, localToWorld, obb, type SanctuaryContext } from './common'

export function priestsHouses(id: string, f: HousesFeature, ctx: SanctuaryContext, col: Collector): Omit<GeneratorOutput, 'groups'> {
  const colliders: Collider[] = []
  const levels: Level[] = []
  for (const [i, b] of f.blocks.entries()) {
    const r = block(`${id}-${b.id}`, b, i, ctx, col)
    colliders.push(...r.colliders)
    levels.push(...r.levels)
  }
  return { instances: [], colliders, levels }
}

function block(name: string, b: HouseBlock, ordinal: number, ctx: SanctuaryContext, col: Collector): { colliders: Collider[]; levels: Level[] } {
  const hx = b.length.value / 2
  const hz = b.width.value / 2
  const g = groundRange(ctx.ground, rotatedRect(b.center, b.length.value, b.width.value, b.rotation))
  // Neighbouring blocks overlap by a few centimetres; each floor sits 2 mm apart so no two slabs share a plane.
  const floorY = g.max - 0.002 * ordinal
  const bottom = g.min - K.skirt
  const top = floorY + b.eaveHeight.value
  const m = composeMatrix([b.center[0], 0, b.center[1]], deg(b.rotation))
  // Walls: a closed volume (its top is covered by the roof's underside), or a hollow shell with doorways and rooms.
  const walls = new MeshBuilder('sanctuary-building')
  const p = b.porch
  const colliders: Collider[] = []
  const levels: Level[] = []
  const d = p ? p.depth.value : 0
  const zw = p ? hz - p.endWall.value : hz
  const toWorld = localToWorld(b.center, b.rotation)
  const wallBox = (n: string, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number) => {
    const [wx, wz] = toWorld((x0 + x1) / 2, (z0 + z1) / 2)
    colliders.push(obb(`${name}-${n}`, [wx, wz], (x1 - x0) / 2, (z1 - z0) / 2, b.rotation, y0, y1))
  }
  const I = b.interior
  if (!I) {
    if (!p) walls.box([-hx, bottom, -hz], [hx, top, hz], ['-y'])
    else {
      // Back wall of the porch, full width; the solid end wall (+z) runs out to the west face; the rest stays open.
      walls.box([-hx + d, bottom, -hz], [hx, top, zw], ['-y', '+z'])
      walls.box([-hx, bottom, zw], [hx, top, hz], ['-y'])
    }
    if (!p) wallBox('walls', -hx, hx, -hz, hz, bottom, top)
    else {
      wallBox('walls', -hx + d, hx, -hz, hz, bottom, top)
      wallBox('end-wall', -hx, -hx + d, zw, hz, bottom, top)
    }
  } else hollow(b, I, { name, walls, top, bottom, floorY, hx, hz, d, zw, ctx }, wallBox, col, m)
  if (p) {
    // Porch floor (closes the terrain cut under the open recess), and the columns carrying a timber architrave under the roof's west slope.
    const floor = new MeshBuilder('sanctuary-floor')
    floor.box([-hx, bottom, -hz], [-hx + d, floorY, zw], ['-y', '+x', '+z'])
    col.get('sanctuary-floor').append(floor, m)
    const wood = new MeshBuilder('timber')
    const cols = new MeshBuilder('house-porch-columns')
    const spec = templeColumn()
    const arch = 0.5
    const s = (b.eaveHeight.value - arch) / spec.height
    const mesh = columnMesh('house-porch-columns', spec, ctx.tier, false)
    const cx = -hx + 0.65
    const span = zw + hz // open length along z, from -hz to zw
    for (let i = 0; i < p.columns; i++) {
      const cz = -hz + ((i + 0.5) * span) / p.columns
      cols.append(mesh, composeMatrix([cx, floorY, cz], 0, [s, s, s]))
      colliders.push(obbCircle(`${name}-porch-column-${i}`, b, cx, cz, spec.lowerRadius * s, floorY, top - arch))
    }
    // Beam: from the column tops up to the roof's underside (at the beam's inner edge the slope is ~0.3 m above the eave).
    wood.box([cx - 0.3, top - arch, -hz], [cx + 0.3, top + 0.28, zw - 0.02], ['-y'])
    col.get('timber').append(wood, m)
    col.get('house-porch-columns').append(cols, m)
  }
  const roof = new MeshBuilder('sanctuary-roof')
  if (b.doors?.length && !I) {
    // Doors: a dark timber leaf just proud of the wall, standing on the ground outside the face.
    const wood = new MeshBuilder('timber')
    for (const d of b.doors) {
      const w = d.width.value / 2
      const h = d.height.value
      if (d.side === '-x') {
        const [gx, gz] = toWorld(-hx - 0.5, d.offset)
        const y = ctx.ground(gx, gz)
        wood.box([-hx - 0.04, y, d.offset - w], [-hx, y + h, d.offset + w], ['-y', '+x'])
      } else {
        const [gx, gz] = toWorld(d.offset, -hz - 0.5)
        const y = ctx.ground(gx, gz)
        wood.box([d.offset - w, y, -hz - 0.04], [d.offset + w, y + h, -hz], ['-y', '+z'])
      }
    }
    col.get('timber').append(wood, m)
  }
  if (b.roof === 'shed') {
    shedRoof(walls, roof, b, top, hx, hz)
  }
  else hippedRoof(roof, b, top, hx, hz)
  col.get('sanctuary-building').append(walls, m)
  col.get('sanctuary-roof').append(roof, m)
  return { colliders, levels }
}

let column: ColumnSpec | undefined
function templeColumn(): ColumnSpec {
  column ??= resolveDimensions(dimensions as unknown as Dimensions).column
  return column
}

function obbCircle(name: string, b: HouseBlock, lx: number, lz: number, r: number, y0: number, y1: number): Collider {
  const [x, z] = localToWorld(b.center, b.rotation)(lx, lz)
  return { kind: 'circle', name, x, z, r, y0, y1 }
}

/**
 * Hipped roof slab (four equal pitches) over the wall tops: the ridge runs along the longer side (a point for a
 * square block); each slope's underside passes through the outer wall faces at the wall top and runs on to the
 * eave overhang.
 */
function hippedRoof(roof: MeshBuilder, b: HouseBlock, top: number, hx: number, hz: number) {
  const ridgeX = hx >= hz
  const hu = ridgeX ? hx : hz
  const hv = ridgeX ? hz : hx
  const rh = b.roofRise.value
  const o = b.overhang.value
  const th = K.roofThickness
  const tan = rh / hv
  const yr = top + rh
  const e = top - o * tan
  const U = hu + o
  const V = hv + o
  const r = Math.max(0, hu - hv) // half ridge length
  const P = (u: number, y: number, v: number): Vec3 => (ridgeX ? [u, y, v] : [v, y, u])
  const N = (du: number, dv: number): Vec3 => (ridgeX ? [du, 1, dv] : [dv, 1, du])
  for (const [dy, down] of [
    [th, false],
    [0, true],
  ] as const) {
    const flip = (n: Vec3): Vec3 => (down ? [-n[0], -n[1], -n[2]] : n)
    const slope = (pts: Vec3[], n: Vec3) => roof.polygonFacing(pts, flip(n))
    if (r > 0) {
      slope([P(-U, e + dy, -V), P(U, e + dy, -V), P(r, yr + dy, 0), P(-r, yr + dy, 0)], N(0, -tan))
      slope([P(-U, e + dy, V), P(U, e + dy, V), P(r, yr + dy, 0), P(-r, yr + dy, 0)], N(0, tan))
    } else {
      slope([P(-U, e + dy, -V), P(U, e + dy, -V), P(0, yr + dy, 0)], N(0, -tan))
      slope([P(-U, e + dy, V), P(U, e + dy, V), P(0, yr + dy, 0)], N(0, tan))
    }
    slope([P(U, e + dy, -V), P(U, e + dy, V), P(r, yr + dy, 0)], N(tan, 0))
    slope([P(-U, e + dy, -V), P(-U, e + dy, V), P(-r, yr + dy, 0)], N(-tan, 0))
  }
  // Eave fascias all round.
  const c: [number, number][] = [
    [-U, -V],
    [U, -V],
    [U, V],
    [-U, V],
  ]
  for (let i = 0; i < 4; i++) {
    const [u0, v0] = c[i]
    const [u1, v1] = c[(i + 1) % 4]
    const out = P((u0 + u1) / 2, 0, (v0 + v1) / 2)
    roof.polygonFacing([P(u0, e, v0), P(u1, e, v1), P(u1, e + th, v1), P(u0, e + th, v0)], [out[0], 0, out[2]])
  }
}

/**
 * Lean-to roof (IMG_8191): one slab rising from the free west eave toward the main block, whose wall it leans on;
 * roofRise is the height of the high (+x) edge above the low eave. The end triangles are filled in the walls.
 */
function shedRoof(walls: MeshBuilder, roof: MeshBuilder, b: HouseBlock, top: number, hx: number, hz: number) {
  const rise = b.roofRise.value
  const o = b.overhang.value
  const th = K.roofThickness
  const s = rise / (2 * hx)
  const Z = hz // no side overhang: the lean-to is exactly as wide as the block it leans on
  const U = hx + o
  const yAt = (x: number) => top + (x + hx) * s
  for (const sz of [-1, 1]) walls.polygonFacing([[-hx, top, sz * hz], [hx, top, sz * hz], [hx, top + rise, sz * hz]], [0, 0, sz])
  walls.box([hx - 0.01, top, -hz], [hx, top + rise, hz], ['-y', '+y', '-z', '+z', '-x'])
  for (const [dy, down] of [[th, false], [0, true]] as const)
    roof.polygonFacing([[-U, yAt(-U) + dy, -Z], [hx, yAt(hx) + dy, -Z], [hx, yAt(hx) + dy, Z], [-U, yAt(-U) + dy, Z]], down ? [s, -1, 0] : [-s, 1, 0])
  const y0 = yAt(-U)
  roof.polygonFacing([[-U, y0, -Z], [-U, y0, Z], [-U, y0 + th, Z], [-U, y0 + th, -Z]], [-1, 0, 0])
  for (const sz of [-1, 1]) roof.polygonFacing([[-U, y0, sz * Z], [hx, yAt(hx), sz * Z], [hx, yAt(hx) + th, sz * Z], [-U, y0 + th, sz * Z]], [0, 0, sz])
}

interface HollowCtx {
  name: string
  walls: MeshBuilder
  top: number
  bottom: number
  floorY: number
  hx: number
  hz: number
  d: number
  zw: number
  ctx: SanctuaryContext
}

/**
 * Hollow block: a floor slab, four shell walls (thickness t) with doorway openings, interior partitions with
 * doors, a lintel over every opening. Wall boxes overlap or omit shared faces, so no two faces coincide.
 */
function hollow(
  b: HouseBlock,
  I: HouseInterior,
  c: HollowCtx,
  wallBox: (n: string, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number) => void,
  col: Collector,
  m: number[],
) {
  const { walls, top, bottom, floorY, hx, hz, d } = c
  const t = I.wall.value
  const dh = I.doorHeight.value
  const X0 = -hx + d // the shell's west face (behind the porch, when there is one)
  const w2 = t / 2
  // Floor slab under the whole shell.
  const floor = new MeshBuilder('sanctuary-floor')
  floor.box([X0, bottom, -hz], [hx, floorY, hz], ['-y'])
  col.get('sanctuary-floor').append(floor, m)
  const faceOmit = (axis: 'x' | 'z'): Face[] => (axis === 'x' ? ['-x', '+x'] : ['-z', '+z'])
  const pad = new Map<string, { off: number; w: number }[]>()
  for (const dr of b.doors ?? []) {
    const k = dr.side
    pad.set(k, [...(pad.get(k) ?? []), { off: dr.offset, w: dr.width.value }])
  }
  /** A wall run along an axis between [a0, a1] with the given cross-section [c0, c1] and door openings (centre offsets). */
  const run = (n: string, axis: 'x' | 'z', a0: number, a1: number, c0: number, c1: number, doors: { off: number; w: number }[], omit: Face[], yTop: number = top) => {
    const ds = [...doors].sort((p, q) => p.off - q.off)
    const spans: [number, number][] = []
    let at = a0
    for (const o of ds) {
      spans.push([at, o.off - o.w / 2])
      at = o.off + o.w / 2
    }
    spans.push([at, a1])
    const box = (u0: number, u1: number, y0: number, y1: number, om: Face[]) =>
      axis === 'x' ? walls.box([u0, y0, c0], [u1, y1, c1], om) : walls.box([c0, y0, u0], [c1, y1, u1], om)
    const coll = (k: string, u0: number, u1: number, y0: number, y1: number) =>
      axis === 'x' ? wallBox(`${n}-${k}`, u0, u1, c0, c1, y0, y1) : wallBox(`${n}-${k}`, c0, c1, u0, u1, y0, y1)
    spans.forEach(([u0, u1], i) => {
      if (u1 - u0 < 1e-6) return
      // Only the outer span ends keep their end faces (they meet the corner overlap or a neighbour).
      box(u0, u1, floorY, yTop, ['-y', ...omit])
      coll(`seg${i}`, u0, u1, floorY, yTop)
    })
    ds.forEach((o, i) => {
      // The lintel's end faces and top are buried against the wall pieces beside and the roof above (no coincident faces).
      box(o.off - o.w / 2, o.off + o.w / 2, floorY + dh, yTop, ['+y', ...faceOmit(axis)])
      coll(`lintel${i}`, o.off - o.w / 2, o.off + o.w / 2, floorY + dh, yTop)
    })
  }
  // Shell: the north and south walls run the full length (corners included); the west and east walls fit between them.
  const nOmit: Face[] = []
  run('wall-n', 'x', X0, hx, -hz, -hz + t, pad.get('-z') ?? [], nOmit)
  run('wall-s', 'x', X0, hx, hz - t, hz, pad.get('+z') ?? [], nOmit)
  run('wall-w', 'z', -hz + t, hz - t, X0, X0 + t, pad.get('-x') ?? [], ['-z', '+z'])
  run('wall-e', 'z', -hz + t, hz - t, hx - t, hx, pad.get('+x') ?? [], ['-z', '+z'])
  // The porch's solid end wall (+z), outside the shell.
  if (d > 0) {
    walls.box([-hx, bottom, c.zw], [X0, top, hz], ['-y', '+x'])
    wallBox('end-wall', -hx, X0, c.zw, hz, bottom, top)
  }
  // Partitions run between the shell walls, sunk half a wall into them (their end faces stay buried).
  I.partitions.forEach((pt, i) => {
    const doors = pt.doors.map((dr) => ({ off: dr.offset, w: dr.width.value }))
    if (pt.axis === 'x') run(`part${i}`, 'x', pt.from ?? X0 + t - w2, pt.to ?? hx - t + w2, pt.at - w2, pt.at + w2, doors, faceOmit('x'), top - 0.03 - 0.004 * i)
    else run(`part${i}`, 'z', pt.from ?? -hz + t - w2, pt.to ?? hz - t + w2, pt.at - w2, pt.at + w2, doors, faceOmit('z'), top - 0.03 - 0.004 * i)
  })
  // Fixtures: a basin is a low rim round its plastered floor, a stool a small block.
  const fx = new MeshBuilder('sanctuary-floor')
  for (const f of I.fixtures ?? []) {
    const h = f.height.value
    if (f.kind === 'stool') fx.box([f.x0, floorY, f.z0], [f.x1, floorY + h, f.z1], ['-y'])
    else {
      const r = 0.1
      fx.box([f.x0, floorY, f.z0], [f.x1, floorY + h, f.z0 + r], ['-y'])
      fx.box([f.x0, floorY, f.z1 - r], [f.x1, floorY + h, f.z1], ['-y'])
      fx.box([f.x0, floorY, f.z0 + r], [f.x0 + r, floorY + h, f.z1 - r], ['-y', '-z', '+z'])
      fx.box([f.x1 - r, floorY, f.z0 + r], [f.x1, floorY + h, f.z1 - r], ['-y', '-z', '+z'])
    }
  }
  col.get('sanctuary-floor').append(fx, m)
}
