// Cella: naos with pronaos (east) and opisthodomos (west), each distyle in antis on a double step;
// east door with threshold sill; naos floor; interior two-tier colonnade (lower columns, epistyle,
// upper columns). Wall tops are omitted (ceiling above), bottoms omitted (stylobate below), and joints
// between abutting boxes omitted.
import type { ColumnSpec, Resolved } from '../data/resolveDimensions'
import { addShaft } from './column'
import { addAbacus, addEchinus } from './capital'
import type { Collector, Face, Vec3 } from './mesh'
import { MeshBuilder, composeMatrix } from './mesh'
import type { Collider, GeneratorOutput, Level, Tier } from './types'

/** One column (shaft + echinus + abacus) in local coordinates, with named parts. */
export function columnMesh(name: string, c: ColumnSpec, tier: Tier, abacusTop: boolean): MeshBuilder {
  const b = new MeshBuilder(name)
  b.beginPart('column-shaft')
  addShaft(b, c, tier)
  b.beginPart('echinus')
  addEchinus(b, c, tier)
  b.beginPart('abacus')
  addAbacus(b, c, abacusTop)
  b.endPart()
  return b
}

export function cella(r: Resolved, tier: Tier, col: Collector): Omit<GeneratorOutput, 'groups'> {
  const C = r.cella
  const S = r.stylobate.top
  const top = C.wallTop
  const xE = C.centerX + C.halfX
  const xW = C.centerX - C.halfX
  const Z = C.halfZ
  const w = C.wall
  const ad = C.anta.depth
  const zi = Z - w
  const colliders: Collider[] = []
  const walls = col.get('cella-walls')
  const antae = col.get('antae')
  const boxCollider = (name: string, min: Vec3, max: Vec3) =>
    colliders.push({ kind: 'box', name, minX: min[0], maxX: max[0], minZ: min[2], maxZ: max[2], y0: min[1], y1: max[1] })

  // Long walls between the antae; antae (wall-thick piers) at both ends.
  for (const sz of [1, -1]) {
    const z0 = sz > 0 ? zi : -Z
    const z1 = sz > 0 ? Z : -zi
    walls.box([xW + ad, S, z0], [xE - ad, top, z1], ['+y', '-y', '+x', '-x'])
    boxCollider(sz > 0 ? 'wall-south' : 'wall-north', [xW + ad, S, z0], [xE - ad, top, z1])
    antae.box([xE - ad, S, z0], [xE, top, z1], ['+y', '-y', '-x'])
    antae.box([xW, S, z0], [xW + ad, top, z1], ['+y', '-y', '+x'])
    boxCollider(`anta-e${sz > 0 ? 's' : 'n'}`, [xE - ad, S, z0], [xE, top, z1])
    boxCollider(`anta-w${sz > 0 ? 's' : 'n'}`, [xW, S, z0], [xW + ad, top, z1])
  }

  // East cross wall with the door, lintel and threshold sill.
  const [ex0, ex1] = C.eastWallX
  const dw = C.door.width / 2
  const doorTop = S + C.door.height
  for (const sz of [1, -1]) {
    const min: Vec3 = [ex0, S, sz > 0 ? dw : -zi]
    const max: Vec3 = [ex1, top, sz > 0 ? zi : -dw]
    walls.box(min, max, ['+y', '-y', sz > 0 ? '+z' : '-z'])
    boxCollider(`door-wall-${sz > 0 ? 's' : 'n'}`, min, max)
  }
  walls.box([ex0, doorTop, -dw], [ex1, top, dw], ['+y', '+z', '-z'])
  boxCollider('door-lintel', [ex0, doorTop, -dw], [ex1, top, dw])
  col.get('threshold').box([ex0, S, -dw], [ex1, C.thresholdY, dw], ['-y', '+z', '-z'])

  // West cross wall (solid).
  const [wx0, wx1] = C.westWallX
  walls.box([wx0, S, -zi], [wx1, top, zi], ['+y', '-y', '+z', '-z'])
  boxCollider('west-wall', [wx0, S, -zi], [wx1, top, zi])

  // Naos floor: only its top shows (its sides abut walls and threshold).
  col.get('cella-floor').polygonFacing(
    [
      [wx1, C.floorY, -zi],
      [ex0, C.floorY, -zi],
      [ex0, C.floorY, zi],
      [wx1, C.floorY, zi],
    ],
    [0, 1, 0],
  )

  // Pronaos / opisthodomos floors on a double step that continues in front of the antae.
  const floor = col.get('cella-floor')
  const { rise, tread } = C.porchStep
  for (const sx of [1, -1]) {
    const wallFace = sx > 0 ? ex1 : wx0
    const front = sx > 0 ? xE : xW
    const back: Face = sx > 0 ? '-x' : '+x'
    const fwd: Face = sx > 0 ? '+x' : '-x'
    const span = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a])
    for (let k = 0; k < 2; k++) {
      const y0 = S + k * rise
      const y1 = y0 + rise
      const reach = (2 - k) * tread
      // Between the antae: sides abut walls/antae, back abuts the cross wall, front continues outside.
      const [a0, a1] = span(wallFace, front)
      floor.box([a0, y0, -zi], [a1, y1, zi], ['-y', '+z', '-z', back, fwd])
      const [b0, b1] = span(front, front + sx * reach)
      floor.box([b0, y0, -zi], [b1, y1, zi], ['-y', back])
    }
  }

  // Porch columns in antis on the upper step, and the porch entablature beams on them and the antae.
  const porch = columnMesh('porch-columns', C.porchColumn, tier, false)
  const porchOut = col.get('porch-columns')
  const pe = col.get('porch-entablature')
  for (const sx of [1, -1]) {
    const x = (sx > 0 ? xE : xW) - (sx * ad) / 2
    for (const z of C.porchColumnsZ) {
      porchOut.append(porch, composeMatrix([x, C.floorY, z], 0))
      colliders.push({ kind: 'circle', name: 'porch-column', x, z, r: C.porchColumn.lowerRadius, y0: C.floorY, y1: C.floorY + C.porchColumn.height })
    }
    pe.box([x - ad / 2, C.porchEntablature.y0, -zi], [x + ad / 2, C.porchEntablature.y1, zi], ['+y', '+z', '-z'])
  }

  // Interior two-tier colonnade.
  const I = r.interior
  const lower = columnMesh('interior-columns-lower', I.lower, tier, false)
  const upper = columnMesh('interior-columns-upper', I.upper, tier, false)
  const lowerOut = col.get('interior-columns-lower')
  const upperOut = col.get('interior-columns-upper')
  const ep = col.get('interior-epistyle')
  const steps = col.get('interior-step')
  for (const z of I.zs) {
    const sw = I.step.width / 2
    steps.box([wx1, I.step.y0, z - sw], [ex0, I.step.y1, z + sw], ['-y', '+x', '-x'])
    for (const x of I.xs) {
      lowerOut.append(lower, composeMatrix([x, I.step.y1, z], 0))
      upperOut.append(upper, composeMatrix([x, I.epistyle.y1, z], 0))
      colliders.push({ kind: 'circle', name: 'interior-column', x, z, r: I.lower.lowerRadius, y0: I.step.y1, y1: I.epistyle.y0 })
    }
    const hw = I.epistyle.width / 2
    ep.box([wx1, I.epistyle.y0, z - hw], [ex0, I.epistyle.y1, z + hw], ['+x', '-x'])
    // Upper epistyle: carried by the upper columns, top under the ceiling (contact face omitted).
    const uw = I.upperEpistyle.width / 2
    ep.box([wx1, I.upperEpistyle.y0, z - uw], [ex0, I.upperEpistyle.y1, z + uw], ['+x', '-x', '+y'])
  }

  const levels: Level[] = r.levels
    .filter((l) => ['threshold', 'naos-floor', 'pronaos-floor', 'opisthodomos-floor'].includes(l.name) || l.name.startsWith('interior-step'))
    .map((l) => ({ name: l.name, y: l.y, ...l.box }))
  return { instances: [], colliders, levels }
}
