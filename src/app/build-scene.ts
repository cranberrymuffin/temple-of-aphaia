// The only place `three` meets generator output: one merged mesh per material (src/app/materials), one
// InstancedMesh per instance set.
import { BufferAttribute, BufferGeometry, DoubleSide, Group, InstancedMesh, Matrix4, Mesh } from 'three'
import type { GeneratorOutput, GeometryGroup } from '../geometry/types'
import type { MaterialSet } from './materials'

function toGeometry(groups: GeometryGroup[]): BufferGeometry {
  let nv = 0
  let ni = 0
  for (const g of groups) {
    nv += g.positions.length / 3
    ni += g.indices.length
  }
  const pos = new Float32Array(nv * 3)
  const nor = new Float32Array(nv * 3)
  const uv = new Float32Array(nv * 2)
  const col = new Uint8Array(nv * 3)
  const idx = new Uint32Array(ni)
  let vo = 0
  let io = 0
  for (const g of groups) {
    pos.set(g.positions, vo * 3)
    nor.set(g.normals, vo * 3)
    uv.set(g.uvs, vo * 2)
    col.set(g.color, vo * 3)
    for (let i = 0; i < g.indices.length; i++) idx[io + i] = g.indices[i] + vo
    vo += g.positions.length / 3
    io += g.indices.length
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(pos, 3))
  geo.setAttribute('normal', new BufferAttribute(nor, 3))
  geo.setAttribute('uv', new BufferAttribute(uv, 2))
  geo.setAttribute('color', new BufferAttribute(col, 3, true))
  geo.setIndex(new BufferAttribute(idx, 1))
  geo.computeBoundingSphere()
  return geo
}

export function buildScene(out: GeneratorOutput, materials: MaterialSet): Group {
  const root = new Group()
  root.name = 'temple'
  const byMaterial = new Map<string, GeometryGroup[]>()
  for (const g of out.groups) {
    // Ground and sanctuary terrain get the terrain material; the rest groups by its pattern material.
    const key = materials.canonical(g.name === 'ground' || g.name === 'terrain' ? 'ground' : g.name === 'sea' ? 'sea' : g.material)
    byMaterial.set(key, [...(byMaterial.get(key) ?? []), g])
  }
  for (const [key, groups] of byMaterial) {
    const mat = materials.get(key)
    // Terrain faces are seen from below at skirts and cut faces: render both sides.
    if (key === 'ground') mat.side = DoubleSide
    const mesh = new Mesh(toGeometry(groups), mat)
    mesh.name = key
    mesh.userData.elements = groups.map((g) => g.name)
    root.add(mesh)
  }
  const m = new Matrix4()
  for (const s of out.instances) {
    const count = s.matrices.length / 16
    const mesh = new InstancedMesh(toGeometry([s.geometry]), materials.get(s.geometry.material), count)
    for (let i = 0; i < count; i++) mesh.setMatrixAt(i, m.fromArray(s.matrices, i * 16))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    mesh.name = s.name
    root.add(mesh)
  }
  return root
}
