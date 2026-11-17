// The only place `three` meets generator output: one merged mesh per pattern material, one InstancedMesh
// per instance set. Materials here are the Step 3 plain placeholders; Step 4 swaps in src/materials.
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Material,
} from 'three'
import type { GeneratorOutput, GeometryGroup } from '../geometry/types'

export interface BuildOptions {
  /** Show the per-vertex palette colours (provisional paint). Default: plain unpainted material. */
  paint: boolean
}

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

function material(opts: BuildOptions, ground: boolean): Material {
  return new MeshStandardMaterial({
    color: opts.paint || ground ? 0xffffff : 0xe8e2d4,
    vertexColors: opts.paint || ground,
    roughness: 0.85,
    metalness: 0,
    side: ground ? DoubleSide : undefined,
  })
}

export function buildScene(out: GeneratorOutput, opts: BuildOptions): Group {
  const root = new Group()
  root.name = 'temple'
  const byMaterial = new Map<string, GeometryGroup[]>()
  for (const g of out.groups) {
    // Ground and sanctuary terrain keep their earth vertex colour even in the plain (unpainted) view.
    const key = g.name === 'ground' || g.name === 'terrain' ? 'ground' : g.material
    byMaterial.set(key, [...(byMaterial.get(key) ?? []), g])
  }
  for (const [key, groups] of byMaterial) {
    const mesh = new Mesh(toGeometry(groups), material(opts, key === 'ground'))
    mesh.name = key
    mesh.userData.elements = groups.map((g) => g.name)
    root.add(mesh)
  }
  const m = new Matrix4()
  for (const s of out.instances) {
    const count = s.matrices.length / 16
    const mesh = new InstancedMesh(toGeometry([s.geometry]), material(opts, false), count)
    for (let i = 0; i < count; i++) mesh.setMatrixAt(i, m.fromArray(s.matrices, i * 16))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    mesh.name = s.name
    root.add(mesh)
  }
  return root
}
