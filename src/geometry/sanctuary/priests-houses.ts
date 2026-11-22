// Priests' houses outside the SE boundary wall (Ministry boards IMG_8187 / IMG_8191): each block is a solid walled
// volume standing on the rock outcrop under a hipped roof of four equal pitches. The front block has an open porch
// on its west face (the board's columns toward the gate): the temple's Doric column scaled to the eave, plus a solid end wall.
// Local frame per block: x along its length, z along its width, rotated into place. Pure (no `three`).
import type { HouseBlock, HousesFeature } from '../../data/sanctuary'
import { rotatedRect } from '../../data/sanctuary'
import type { Collector, Vec3 } from '../mesh'
import dimensions from '../../data/dimensions.json'
import { resolveDimensions } from '../../data/resolveDimensions'
import type { Dimensions } from '../../data/types'
import { columnMesh } from '../cella'
import { MeshBuilder, composeMatrix } from '../mesh'
import type { ColumnSpec } from '../../data/resolveDimensions'
import type { Collider, GeneratorOutput } from '../types'
import { SANCTUARY_CONVENTIONS as K, deg, groundRange, localToWorld, obb, type SanctuaryContext } from './common'

export function priestsHouses(id: string, f: HousesFeature, ctx: SanctuaryContext, col: Collector): Omit<GeneratorOutput, 'groups'> {
  const colliders: Collider[] = []
  for (const b of f.blocks) colliders.push(...block(`${id}-${b.id}`, b, ctx, col))
  return { instances: [], colliders, levels: [] }
}

function block(name: string, b: HouseBlock, ctx: SanctuaryContext, col: Collector): Collider[] {
  const hx = b.length.value / 2
  const hz = b.width.value / 2
  const g = groundRange(ctx.ground, rotatedRect(b.center, b.length.value, b.width.value, b.rotation))
  const floorY = g.max
  const bottom = g.min - K.skirt
  const top = floorY + b.eaveHeight.value
  const m = composeMatrix([b.center[0], 0, b.center[1]], deg(b.rotation))
  // Walls: one closed volume; its top is covered by the roof's underside.
  const walls = new MeshBuilder('sanctuary-building')
  const p = b.porch
  const colliders: Collider[] = []
  if (!p) walls.box([-hx, bottom, -hz], [hx, top, hz], ['-y'])
  else {
    // Back wall of the porch, full width; the solid end wall (+z) runs out to the west face; the rest stays open.
    const d = p.depth.value
    const zw = hz - p.endWall.value
    walls.box([-hx + d, bottom, -hz], [hx, top, zw], ['-y', '+z'])
    walls.box([-hx, bottom, zw], [hx, top, hz], ['-y'])
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
  if (b.doors?.length) {
    // Doors: a dark timber leaf just proud of the wall, standing on the ground outside the face.
    const wood = new MeshBuilder('timber')
    const toWorld = localToWorld(b.center, b.rotation)
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
  if (!p) return [obb(name, b.center, hx, hz, b.rotation, bottom, top)]
  // Colliders: the back block and the end wall; the open porch is walkable between the columns.
  const d = p.depth.value
  const zw = hz - p.endWall.value
  const at = (x0: number, x1: number, z0: number, z1: number, n: string) => {
    const [wx, wz] = localToWorld(b.center, b.rotation)((x0 + x1) / 2, (z0 + z1) / 2)
    return obb(n, [wx, wz], (x1 - x0) / 2, (z1 - z0) / 2, b.rotation, bottom, top)
  }
  return [at(-hx + d, hx, -hz, hz, name), at(-hx, -hx + d, zw, hz, `${name}-end-wall`), ...colliders]
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
