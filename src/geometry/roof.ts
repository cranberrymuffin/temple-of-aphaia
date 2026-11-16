// Pitched roof slab over the cornice. Its gable ends are the raking geison; the overhang soffit in front
// of each tympanum is the raking soffit. Cover tiles run eave to ridge over the pan-tile joints.
import type { Resolved } from '../data/resolveDimensions'
import type { Collector, Vec3 } from './mesh'
import type { GeneratorOutput } from './types'

export function roof(r: Resolved, col: Collector): Omit<GeneratorOutput, 'groups'> {
  const R = r.roof
  const X = R.halfX
  const Z = R.halfZ
  const e = R.eaveY
  const th = R.thickness
  const tan = Math.tan(r.pediment.pitch)
  const ridgeTop = R.ridgeY
  const ridgeBottom = e + Z * tan
  const roofB = col.get('roof')
  const geison = col.get('raking-geison')
  const tiles = col.get('roof-tiles')

  for (const sz of [1, -1]) {
    // Top slope and eave face.
    roofB.polygonFacing(
      [
        [-X, e + th, sz * Z],
        [X, e + th, sz * Z],
        [X, ridgeTop, 0],
        [-X, ridgeTop, 0],
      ],
      [0, 1, sz * tan],
    )
    roofB.polygonFacing(
      [
        [-X, e, sz * Z],
        [X, e, sz * Z],
        [X, e + th, sz * Z],
        [-X, e + th, sz * Z],
      ],
      [0, 0, sz],
    )
    for (const sx of [1, -1]) {
      // Raking geison: gable band at x = +-X.
      geison.polygonFacing(
        [
          [sx * X, e, sz * Z],
          [sx * X, ridgeBottom, 0],
          [sx * X, ridgeTop, 0],
          [sx * X, e + th, sz * Z],
        ],
        [sx, 0, 0],
      )
      // Raking soffit between the tympanum plane and the gable.
      const x0 = sx * r.pediment.tympanumX
      geison.polygonFacing(
        [
          [x0, e, sz * Z],
          [sx * X, e, sz * Z],
          [sx * X, ridgeBottom, 0],
          [x0, ridgeBottom, 0],
        ],
        [0, -1, -sz * tan],
      )
    }
  }

  // Cover tiles over the pan-tile joints (triangular battens, base on the slope, ridge ends under the cap).
  const w = R.coverTileWidth
  const hgt = w * 0.45
  const cosP = Math.cos(r.pediment.pitch)
  const sinP = Math.sin(r.pediment.pitch)
  for (const sz of [1, -1]) {
    const nrm: Vec3 = [0, cosP, sz * sinP]
    for (let i = 1; i < R.tileColumns; i++) {
      const x = -X + i * R.tilePitch
      const eave: Vec3 = [x, e + th, sz * Z]
      const ridge: Vec3 = [x, ridgeTop, 0]
      const off = (p: Vec3, dx: number, h: number): Vec3 => [p[0] + dx, p[1] + h * nrm[1], p[2] + h * nrm[2]]
      const eL = off(eave, -w / 2, 0)
      const eR = off(eave, w / 2, 0)
      const eA = off(eave, 0, hgt)
      const rL = off(ridge, -w / 2, 0)
      const rR = off(ridge, w / 2, 0)
      const rA = off(ridge, 0, hgt)
      tiles.polygonFacing([eL, rL, rA, eA], [-1, nrm[1], nrm[2]])
      tiles.polygonFacing([eR, eA, rA, rR], [1, nrm[1], nrm[2]])
      tiles.polygonFacing([eL, eA, eR], [0, -sz * sinP, sz * cosP])
    }
  }
  // Ridge cap: two boards whose bottoms follow the slopes (bottom faces omitted).
  const cw = R.tilePitch * 0.5
  const capH = hgt * 1.5
  const yb = ridgeTop - cw * tan
  for (const sz of [1, -1]) {
    tiles.polygonFacing(
      [
        [-X, yb + capH * 0.5, sz * cw],
        [X, yb + capH * 0.5, sz * cw],
        [X, ridgeTop + capH, 0],
        [-X, ridgeTop + capH, 0],
      ],
      [0, 1, sz],
    )
    tiles.polygonFacing(
      [
        [-X, yb, sz * cw],
        [X, yb, sz * cw],
        [X, yb + capH * 0.5, sz * cw],
        [-X, yb + capH * 0.5, sz * cw],
      ],
      [0, 0, sz],
    )
    for (const sx of [1, -1])
      tiles.polygonFacing(
        [
          [sx * X, yb, sz * cw],
          [sx * X, ridgeTop, 0],
          [sx * X, ridgeTop + capH, 0],
          [sx * X, yb + capH * 0.5, sz * cw],
        ],
        [sx, 0, 0],
      )
  }
  return { instances: [], colliders: [], levels: [] }
}
