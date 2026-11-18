// Usage: npx vite-node tools/sculpture/turntable.ts -- <out.png> <file.stl> <up> <facingDeg>
// Writes four views of the oriented scan (from +Z = front, +X, -Z, -X) to check up axis and facing.
import { MeshoptSimplifier } from 'three/examples/jsm/libs/meshopt_simplifier.module.js'
import { compact, previewPng, readMesh, TURNTABLE } from './mesh-io'
import { orientPositions } from './orient'

const [out, file, up, facing] = process.argv.slice(2).filter((a) => a !== '--')
await MeshoptSimplifier.ready
const m = readMesh(file)
const [idx] = MeshoptSimplifier.simplifySloppy(m.indices, m.positions, 3, null, Math.min(m.indices.length, 60000 * 3), 1)
const c = compact(m.positions, idx)
previewPng(out, { positions: orientPositions(c.positions, up, Number(facing)), indices: c.indices }, 280, TURNTABLE)
