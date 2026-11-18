// Usage: npx vite-node tools/sculpture/process.ts -- refs/scans public/sculptures [id...]
// For every real sculpture in src/data/sculptures.json (or the ids given): read the scan (<scan-dir>/<scan.file>, STL or GLB),
// orient it (+Y up, presentation front +Z, resting on y = 0), scale it to metres (scan.heightM or
// scan.unitToMetre), simplify to the high and low LOD
// triangle targets with meshoptimizer, recompute normals and write <out-dir>/<id>-<lod>.glb compressed with
// gltfpack 1.3.0 via npx (EXT_meshopt_compression + quantization; not a project dependency). Prints triangle counts and file sizes.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MeshoptSimplifier } from 'three/examples/jsm/libs/meshopt_simplifier.module.js'
import { bounds, compact, readMesh, vertexNormals, writeGlb } from './mesh-io'
import { orientPositions } from './orient'

const [scanDir, outDir, ...only] = process.argv.slice(2).filter((a) => a !== '--')
if (!scanDir || !outDir) throw new Error('usage: process.mjs <scan-dir> <out-dir> [id...]')
const manifest = JSON.parse(readFileSync(new URL('../../src/data/sculptures.json', import.meta.url), 'utf8'))
const tmp = mkdtempSync(join(tmpdir(), 'aphaia-sculpture-'))
const assetsPath = new URL('../../src/data/sculpture-assets.json', import.meta.url)
let assets = {}
try {
  assets = JSON.parse(readFileSync(assetsPath, 'utf8'))
} catch {
  assets = {}
}
await MeshoptSimplifier.ready

/** Height of the cast's plinth: the lowest band whose plan extent stays near the base slab's. */
function plinthHeight(p, height) {
  const step = 0.005
  const area = (y0) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, n = 0
    for (let i = 0; i < p.length; i += 3) {
      if (p[i + 1] < y0 || p[i + 1] >= y0 + step) continue
      n++
      x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 2]); z1 = Math.max(z1, p[i + 2])
    }
    return n ? (x1 - x0) * (z1 - z0) : 0
  }
  const a0 = area(0)
  for (let y = step; y < height * 0.25; y += step) if (area(y) < 0.6 * a0) return y
  return 0
}

for (const s of manifest.sculptures) {
  if (!s.scan || (only.length && !only.includes(s.id))) continue
  const m = readMesh(join(scanDir, s.scan.file))
  const p = orientPositions(m.positions, s.scan.up, s.scan.facingDeg)
  // Real size: the museum's recorded height when given (the files' units vary), else file units -> metres.
  const k = s.scan.heightM ? s.scan.heightM / bounds(p).size[1] : s.scan.unitToMetre
  for (let i = 0; i < p.length; i++) p[i] *= k
  const b = bounds(p)
  const entry = { plinthM: s.slot.site ? 0 : Number(plinthHeight(p, b.size[1]).toFixed(3)), size: b.size.map((v) => Number(v.toFixed(3))), lods: {} }
  for (const [lod, target] of Object.entries(manifest.lodTriangles)) {
    const [idx, err] = MeshoptSimplifier.simplify(m.indices, p, 3, Math.min(m.indices.length, target * 3), 0.05, ['LockBorder'])
    let ind = idx
    // Fall back to sloppy simplification when topology prevents reaching the target.
    if (ind.length > target * 3 * 1.15) [ind] = MeshoptSimplifier.simplifySloppy(m.indices, p, 3, null, target * 3, 0.05)
    const c = compact(p, ind)
    const raw = join(tmp, `${s.id}-${lod}.raw.glb`)
    writeGlb(raw, { positions: c.positions, normals: vertexNormals(c.positions, c.indices), indices: c.indices }, { id: s.id })
    const packed = join(tmp, `${s.id}-${lod}.glb`)
    execFileSync('npx', ['-y', 'gltfpack@1.3.0', '-i', raw, '-o', packed, '-cc', '-vp', '12', '-vn', '8'], { stdio: 'pipe' })
    // Content-hashed names so long-lived caches never serve a stale figure.
    const hash = createHash('sha256').update(readFileSync(packed)).digest('hex').slice(0, 10)
    const file = `${s.id}-${lod}-${hash}.glb`
    const prev = assets[s.id]?.lods?.[lod]?.file
    if (prev && prev !== file) rmSync(join(outDir, prev), { force: true })
    renameSync(packed, join(outDir, file))
    const bytes = statSync(join(outDir, file)).size
    entry.lods[lod] = { file, triangles: c.indices.length / 3, bytes }
    console.log(`${s.id} ${lod}: ${c.indices.length / 3} tris, ${(bytes / 1024).toFixed(1)} KB, error ${err.toFixed(4)}, size ${b.size.map((v) => v.toFixed(2)).join(' x ')} m, plinth ${entry.plinthM} m`)
  }
  assets[s.id] = entry
}
writeFileSync(assetsPath, JSON.stringify(assets, null, 2) + '\n')
