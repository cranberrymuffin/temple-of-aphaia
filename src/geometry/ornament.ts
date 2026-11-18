// Painted moulding bands carrying the ornament materials (Step 4): thin strips set just proud of the
// faces they decorate, with band UVs (u = ornament repeats along the band, v = 0..1 across it) so one
// texture tile spans one repeat. Pure: no `three`.
// - Flank cornice cymatium: Doric leaf (hawksbeak), ornament axes about 5.2 cm (Furtwängler 1906, p. 47).
// - Cymatium under the raking cornice: leaf moulding, axes about 19.5 cm (p. 48).
// - Gable sima: palmettes (red by one fragment, blue-and-red by Athenian analogy, p. 48).
// - Interior crowning band round the peristasis: meander (Blouet, via p. 47; conjectural).
// Band heights and the 2 cm projection are CONVENTIONS (not sourced).
import type { Resolved } from '../data/resolveDimensions'
import type { Collector, MeshBuilder, Vec3 } from './mesh'
import { add, cross, dot, len, norm, scale, sub } from './mesh'
import type { GeneratorOutput } from './types'

export const ORNAMENT_CONVENTIONS = {
  projection: 0.02,
  flankCymatiumHeight: 0.09,
  /** Two leaves per tile. */
  flankLeafAxis: 0.052,
  rakingCymatiumHeight: 0.1,
  rakingLeafAxis: 0.195,
  simaHeight: 0.18,
  /** Palmette tile aspect (width / height), matching src/app/materials/patterns.ts. */
  palmetteAspect: 1.25,
  interiorBandHeight: 0.1,
  interiorBandDrop: 0.03,
  interiorBandProjection: 0.015,
}

/**
 * A band on a plane: `a`->`b` is the bottom edge, `up` the in-plane direction across the band (unit, length
 * = height applied by the caller), `out` the outward normal. Emits the front face with band UVs and the
 * thin top, bottom and end faces (ends optional, to bury them in a neighbouring band).
 */
function band(
  b: MeshBuilder,
  a: Vec3,
  c: Vec3,
  up: Vec3,
  height: number,
  out: Vec3,
  proj: number,
  tileLen: number,
  u0: number,
  ends: [boolean, boolean] = [true, true],
) {
  const h = scale(up, height)
  const o = scale(out, proj)
  const A = add(a, o)
  const C = add(c, o)
  const A2 = add(A, h)
  const C2 = add(C, h)
  const L = len(sub(c, a))
  const u1 = u0 + L / tileLen
  // Front face (CCW seen from outside).
  const n = norm(out)
  const front = cross(sub(C, A), h)
  const quad = dot(front, n) > 0 ? [A, C, C2, A2] : [A, A2, C2, C]
  const uvs: [number, number][] = dot(front, n) > 0 ? [[u0, 0], [u1, 0], [u1, 1], [u0, 1]] : [[u0, 0], [u0, 1], [u1, 1], [u1, 0]]
  const base = b.vertexCount
  quad.forEach((p, i) => b.vertex(p, n, uvs[i]))
  b.tri(base, base + 1, base + 2)
  b.tri(base, base + 2, base + 3)
  // Thin faces back to the host face.
  const upN = norm(up)
  b.polygonFacing([a, c, C, A], scale(upN, -1))
  b.polygonFacing([add(a, h), A2, C2, add(c, h)], upN)
  const along = norm(sub(c, a))
  if (ends[0]) b.polygonFacing([a, A, A2, add(a, h)], scale(along, -1))
  if (ends[1]) b.polygonFacing([c, add(c, h), C2, C], along)
}

export function ornament(r: Resolved, col: Collector): Omit<GeneratorOutput, 'groups'> {
  const K = ORNAMENT_CONVENTIONS
  const E = r.entablature
  const c1 = E.cornice.y1
  const X = r.roof.halfX
  const Z = r.roof.halfZ
  const tan = Math.tan(r.pediment.pitch)

  // Flank cornice cymatium (both flanks), at the top of the cornice face.
  const cym = col.get('cymatium')
  for (const sz of [1, -1]) {
    const z = sz * E.cornice.halfZ
    band(cym, [-E.cornice.halfX, c1 - K.flankCymatiumHeight, z], [E.cornice.halfX, c1 - K.flankCymatiumHeight, z], [0, 1, 0], K.flankCymatiumHeight, [0, 0, sz], K.projection, 2 * K.flankLeafAxis, 0)
  }

  // Raking bands on the gable face of the raking geison (x = +-X): cymatium at its foot, sima at its top.
  const raking = col.get('raking-cymatium')
  const sima = col.get('sima')
  const up: Vec3 = [0, 1, 0]
  const e = r.roof.eaveY
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      // Bands rise from the eave to the apex, where the two halves meet (apex end faces omitted: they would
      // be coplanar with each other). Vertical band height; the sima top follows the geison top edge.
      band(raking, [sx * X, e, sz * Z], [sx * X, e + Z * tan, 0], up, K.rakingCymatiumHeight, [sx, 0, 0], K.projection, 2 * K.rakingLeafAxis, 0, [true, false])
      const h = K.simaHeight
      band(sima, [sx * X, e + r.roof.thickness - h, sz * Z], [sx * X, r.roof.ridgeY - h, 0], up, h, [sx, 0, 0], K.projection, h * K.palmetteAspect, 0, [true, false])
    }
  }

  // Interior crowning band round the peristasis: on the inner face of the cornice ring, facing the cella.
  const mb = col.get('interior-crown')
  const y0 = c1 - K.interiorBandDrop - K.interiorBandHeight
  const p = K.interiorBandProjection
  const { innerX: ix, innerZ: iz } = E
  const tile = K.interiorBandHeight
  // Each run ends inside the crossing run with no end face (an end face would lie on the host wall or on
  // the other band); the east/west runs sit 2 mm lower and shorter so their top/bottom faces never share
  // a plane with the north/south runs.
  for (const sz of [1, -1])
    band(mb, [-(ix - p / 2), y0, sz * iz], [ix - p / 2, y0, sz * iz], up, K.interiorBandHeight, [0, 0, -sz], p, tile, 0, [false, false])
  for (const sx of [1, -1])
    band(mb, [sx * ix, y0 + 0.002, -(iz - p / 2)], [sx * ix, y0 + 0.002, iz - p / 2], up, K.interiorBandHeight - 0.004, [-sx, 0, 0], p, tile, 0, [false, false])
  return { instances: [], colliders: [], levels: [] }
}
