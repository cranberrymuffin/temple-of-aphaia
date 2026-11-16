// Rectangular building (house, ancillary room, propylon) with walls, doors and optional open sides.
// Built in a local frame (x along length, z along width) and rotated into place. No roof: the sources
// for the sanctuary buildings do not give one yet.
import type { BuildingFeature, Side } from '../../data/sanctuary'
import { rotatedRect } from '../../data/sanctuary'
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
  const range = groundRange(ctx.ground, rotatedRect(f.center, L, W, f.rotation))
  const floorY = f.baseY ?? range.max + K.floorRiseRatio * t
  const bottom = Math.min(f.baseY ?? range.min, range.min) - K.skirt
  const top = floorY + H
  const m = composeMatrix([f.center[0], 0, f.center[1]], deg(f.rotation))
  const walls = new MeshBuilder('sanctuary-building')
  const floor = new MeshBuilder('sanctuary-floor')
  const colliders: Collider[] = []

  const collide = (name: string, min: Vec3, max: Vec3) => {
    if (max[0] - min[0] <= 1e-9 || max[2] - min[2] <= 1e-9) return
    const c = transformPoint(m, [(min[0] + max[0]) / 2, 0, (min[2] + max[2]) / 2])
    colliders.push({ kind: 'obb', name: `${id}-${name}`, cx: c[0], cz: c[2], halfX: (max[0] - min[0]) / 2, halfZ: (max[2] - min[2]) / 2, rotY: deg(f.rotation), y0: min[1], y1: max[1] })
  }

  /**
   * One wall along its own axis u in [u0, u1] (x for n/s walls, z for e/w walls), across v in [v0, v1],
   * with its doors. `endOmit` lists the ends that abut another wall.
   */
  const wall = (side: Side, u0: number, u1: number, v0: number, v1: number, endOmit: [boolean, boolean]) => {
    const alongX = side === 'n' || side === 's'
    const box = (a0: number, a1: number, y0: number, y1: number, omit: Face[]) => {
      const min: Vec3 = alongX ? [a0, y0, v0] : [v0, y0, a0]
      const max: Vec3 = alongX ? [a1, y1, v1] : [v1, y1, a1]
      walls.box(min, max, omit)
      return [min, max] as const
    }
    const lo: Face = alongX ? '-x' : '-z'
    const hi: Face = alongX ? '+x' : '+z'
    const doors = f.doors
      .filter((d) => d.wall === side)
      .map((d) => [d.offset - d.width.value / 2, d.offset + d.width.value / 2, d.height.value] as const)
      .sort((a, b) => a[0] - b[0])
    let cur = u0
    doors.forEach(([d0, d1, dh], i) => {
      const [mn, mx] = box(cur, d0, bottom, top, ['-y', ...(cur === u0 && endOmit[0] ? [lo] : [])])
      collide(`${side}-wall-${i}`, mn, mx)
      const [lmn, lmx] = box(d0, d1, floorY + dh, top, [lo, hi])
      collide(`${side}-lintel-${i}`, lmn, lmx)
      box(d0, d1, bottom, floorY, ['-y', lo, hi]) // threshold: its top is the door sill at floor level
      cur = d1
    })
    const [mn, mx] = box(cur, u1, bottom, top, ['-y', ...(cur === u0 && endOmit[0] ? [lo] : []), ...(endOmit[1] ? [hi] : [])])
    collide(`${side}-wall-${doors.length}`, mn, mx)
  }

  const hx = L / 2
  const hz = W / 2
  if (!open.has('n')) wall('n', -hx, hx, -hz, -hz + t, [false, false])
  if (!open.has('s')) wall('s', -hx, hx, hz - t, hz, [false, false])
  const z0 = open.has('n') ? -hz : -hz + t
  const z1 = open.has('s') ? hz : hz - t
  if (!open.has('e')) wall('e', z0, z1, hx - t, hx, [!open.has('n'), !open.has('s')])
  if (!open.has('w')) wall('w', z0, z1, -hx, -hx + t, [!open.has('n'), !open.has('s')])

  // Floor (top only where walls enclose it; open sides show the socle edge down to the skirt).
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
    const [a, b, dir] = edge[side]
    floor.polygonFacing([[a[0], bottom, a[2]], [b[0], bottom, b[2]], [b[0], floorY, b[2]], [a[0], floorY, a[2]]], dir)
  }

  col.get('sanctuary-building').append(walls, m)
  col.get('sanctuary-floor').append(floor, m)
  const c = transformPoint(m, [(x0 + x1) / 2, 0, (z0 + z1) / 2])
  const levels: Level[] = [
    { name: `${id}-floor`, y: floorY, minX: c[0] - (x1 - x0) / 2, maxX: c[0] + (x1 - x0) / 2, minZ: c[2] - (z1 - z0) / 2, maxZ: c[2] + (z1 - z0) / 2, rotY: deg(f.rotation) },
  ]
  return { instances: [], colliders, levels }
}
