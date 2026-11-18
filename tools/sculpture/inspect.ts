// Usage: npx vite-node tools/sculpture/inspect.ts -- <out-dir> <file.stl>...
// Prints size and triangle count, and writes a 3-view preview PNG (front -Z, side +X, top -Y in file axes).
import { basename } from 'node:path'
import { MeshoptSimplifier } from 'three/examples/jsm/libs/meshopt_simplifier.module.js'
import { bounds, compact, previewPng, readStl } from './mesh-io'

const [outDir, ...files] = process.argv.slice(2).filter((a) => a !== '--')
await MeshoptSimplifier.ready
for (const f of files) {
  const m = readStl(f)
  const b = bounds(m.positions)
  const [idx] = MeshoptSimplifier.simplifySloppy(m.indices, m.positions, 3, null, Math.min(m.indices.length, 60000 * 3), 1)
  previewPng(`${outDir}/${basename(f, '.stl')}.png`, compact(m.positions, idx))
  console.log(basename(f), 'tris', m.indices.length / 3, 'verts', m.positions.length / 3, 'size', b.size.map((v) => v.toFixed(1)).join(' x '), 'min', b.min.map((v) => v.toFixed(1)).join(','))
}
