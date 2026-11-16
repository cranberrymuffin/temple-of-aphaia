// A1b fallback: bake the procedural temple to a GLB in Node (no three, no new dependencies).
// Usage: npm run bake -- [low|med|high] [outFile]   (default: high -> dist/bake/temple-<tier>.glb)
// One mesh primitive per pattern material; the peristyle instances are expanded into their own mesh.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import dimensions from '../../src/data/dimensions.json'
import palette from '../../src/data/palette.json'
import sources from '../../src/data/sources.json'
import { resolveDimensions } from '../../src/data/resolveDimensions'
import type { Dimensions } from '../../src/data/types'
import { MeshBuilder } from '../../src/geometry/mesh'
import { buildTemple, triangleCount } from '../../src/geometry/temple'
import { TIERS, type GeometryGroup, type Tier } from '../../src/geometry/types'

interface Prim {
  name: string
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  color: Uint8Array
  indices: Uint32Array
}

function merge(name: string, groups: GeometryGroup[]): Prim {
  const cat = <T extends Float32Array | Uint8Array>(ctor: new (n: number) => T, pick: (g: GeometryGroup) => T): T => {
    const out = new ctor(groups.reduce((a, g) => a + pick(g).length, 0))
    let o = 0
    for (const g of groups) {
      out.set(pick(g), o)
      o += pick(g).length
    }
    return out
  }
  const indices = new Uint32Array(groups.reduce((a, g) => a + g.indices.length, 0))
  let io = 0
  let vo = 0
  for (const g of groups) {
    for (let i = 0; i < g.indices.length; i++) indices[io + i] = g.indices[i] + vo
    io += g.indices.length
    vo += g.positions.length / 3
  }
  return {
    name,
    positions: cat(Float32Array, (g) => g.positions),
    normals: cat(Float32Array, (g) => g.normals),
    uvs: cat(Float32Array, (g) => g.uvs),
    color: cat(Uint8Array, (g) => g.color),
    indices,
  }
}

/** Expands an instance set into one group (positions and normals transformed). */
function expand(g: GeometryGroup, matrices: Float32Array): GeometryGroup {
  const src = new MeshBuilder('peristyle-column')
  src.pos.push(...g.positions)
  src.nor.push(...g.normals)
  src.uv.push(...g.uvs)
  src.idx.push(...g.indices)
  const dst = new MeshBuilder('peristyle-column')
  for (let k = 0; k < matrices.length / 16; k++) dst.append(src, matrices.subarray(k * 16, k * 16 + 16))
  const n = dst.vertexCount
  const color = new Uint8Array(n * 3)
  for (let i = 0; i < n; i++) color.set(g.color.subarray((i % (g.positions.length / 3)) * 3, (i % (g.positions.length / 3)) * 3 + 3), i * 3)
  return { ...g, positions: new Float32Array(dst.pos), normals: new Float32Array(dst.nor), uvs: new Float32Array(dst.uv), color, indices: new Uint32Array(dst.idx), colorIdx: undefined }
}

function glb(prims: Prim[]): Buffer {
  const chunks: Buffer[] = []
  let offset = 0
  const bufferViews: object[] = []
  const accessors: object[] = []
  const pushView = (arr: ArrayBufferView, target: number) => {
    const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)
    const pad = (4 - (b.length % 4)) % 4
    chunks.push(b, Buffer.alloc(pad))
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: b.length, target })
    offset += b.length + pad
    return bufferViews.length - 1
  }
  const minMax = (a: Float32Array) => {
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < a.length; i += 3)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], a[i + k])
        max[k] = Math.max(max[k], a[i + k])
      }
    return { min, max }
  }
  const meshes = prims.map((p) => {
    const n = p.positions.length / 3
    const acc = (view: number, componentType: number, type: string, count: number, extra: object = {}) => {
      accessors.push({ bufferView: view, componentType, type, count, ...extra })
      return accessors.length - 1
    }
    const ARRAY = 34962
    const ELEMENTS = 34963
    const attributes = {
      POSITION: acc(pushView(p.positions, ARRAY), 5126, 'VEC3', n, minMax(p.positions)),
      NORMAL: acc(pushView(p.normals, ARRAY), 5126, 'VEC3', n),
      TEXCOORD_0: acc(pushView(p.uvs, ARRAY), 5126, 'VEC2', n),
      COLOR_0: acc(pushView(p.color, ARRAY), 5121, 'VEC3', n, { normalized: true }),
    }
    const indices = acc(pushView(p.indices, ELEMENTS), 5125, 'SCALAR', p.indices.length)
    return { name: p.name, primitives: [{ attributes, indices, material: 0 }] }
  })
  const bin = Buffer.concat(chunks)
  const json = {
    asset: { version: '2.0', generator: 'temple-of-aphaia tools/bake' },
    scene: 0,
    scenes: [{ nodes: meshes.map((_, i) => i) }],
    nodes: meshes.map((m, i) => ({ name: m.name, mesh: i })),
    meshes,
    materials: [{ name: 'plain', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.85 } }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
  }
  let jsonBuf = Buffer.from(JSON.stringify(json))
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)])
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8)
  const chunkHead = (len: number, type: number) => {
    const b = Buffer.alloc(8)
    b.writeUInt32LE(len, 0)
    b.writeUInt32LE(type, 4)
    return b
  }
  return Buffer.concat([header, chunkHead(jsonBuf.length, 0x4e4f534a), jsonBuf, chunkHead(bin.length, 0x004e4942), bin])
}

const args = process.argv.slice(2).filter((a) => a !== '--')
const tier = (args[0] ?? 'high') as Tier
if (!TIERS.includes(tier)) throw new Error(`tier must be one of ${TIERS.join(', ')}`)
const outFile = resolve(args[1] ?? `dist/bake/temple-${tier}.glb`)
const t0 = performance.now()
const r = resolveDimensions(dimensions.dimensions as unknown as Dimensions, { eastRamp: 'east-ramp' in sources.choices })
const out = buildTemple(r, tier, palette.colors, { colorIdx: false })
const byMaterial = new Map<string, GeometryGroup[]>()
for (const g of out.groups) byMaterial.set(g.material, [...(byMaterial.get(g.material) ?? []), g])
const prims = [...byMaterial].map(([m, gs]) => merge(m, gs))
for (const s of out.instances) prims.push(merge(s.name, [expand(s.geometry, s.matrices)]))
const buf = glb(prims)
mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, buf)
console.log(`${outFile}: ${(buf.length / 1024).toFixed(0)} KB, ${triangleCount(out)} triangles, ${(performance.now() - t0).toFixed(0)} ms`)
