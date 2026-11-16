// src/geometry and src/data stay pure (Worker/Node): no `three` anywhere in their import graph, and the
// built Worker chunk carries no copy of three (three lives once, in the main chunk).
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { build } from 'vite'

const root = resolve(__dirname, '../..')
const IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|new URL\(\s*['"]([^'"]+)['"]/g

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(f) ? [p] : []
  })

function resolveLocal(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(from), spec)
  for (const c of [base, `${base}.ts`, join(base, 'index.ts')]) {
    try {
      if (statSync(c).isFile()) return c
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

/** All bare (package) imports reachable from `entry` through local imports. */
function reachableBareImports(entry: string): Map<string, string> {
  const bare = new Map<string, string>()
  const seen = new Set<string>()
  const stack = [entry]
  while (stack.length) {
    const f = stack.pop()!
    if (seen.has(f) || !f.endsWith('.ts')) continue
    seen.add(f)
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2] ?? m[3]
      const local = resolveLocal(f, spec)
      if (local) stack.push(local)
      else if (!spec.startsWith('.')) bare.set(spec, f)
    }
  }
  return bare
}

const pureFiles = [...walk(join(root, 'src/geometry')), ...walk(join(root, 'src/data'))]

describe('import graph purity', () => {
  it('finds the generator and data modules', () => {
    expect(pureFiles.some((f) => f.endsWith('geometry/temple.ts'))).toBe(true)
    expect(pureFiles.some((f) => f.endsWith('geometry/worker.ts'))).toBe(true)
    expect(pureFiles.some((f) => f.endsWith('data/resolveDimensions.ts'))).toBe(true)
  })

  it.each(pureFiles.map((f) => [f.slice(root.length + 1), f]))('%s never reaches three', (_, f) => {
    const bad = [...reachableBareImports(f)].filter(([spec]) => spec === 'three' || spec.startsWith('three/'))
    expect(bad).toEqual([])
  })

  it('the import scanner sees three in src/app (control)', () => {
    expect([...reachableBareImports(join(root, 'src/app/build-scene.ts')).keys()]).toContain('three')
  })
})

describe('built bundle', () => {
  it('the Worker chunk contains no three; the main chunk contains it once', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'aphaia-purity-'))
    try {
      await build({ root, logLevel: 'silent', build: { outDir, emptyOutDir: true } })
      const assets = readdirSync(join(outDir, 'assets')).filter((f) => f.endsWith('.js'))
      const worker = assets.filter((f) => f.startsWith('worker'))
      expect(worker).toHaveLength(1)
      // three's class registry strings survive minification.
      const marker = /"BufferGeometry"|WebGLRenderer|"Object3D"/
      const workerSrc = readFileSync(join(outDir, 'assets', worker[0]), 'utf8')
      expect(marker.test(workerSrc)).toBe(false)
      const withThree = assets.filter((f) => marker.test(readFileSync(join(outDir, 'assets', f), 'utf8')))
      expect(withThree).toHaveLength(1)
      expect(withThree[0].startsWith('worker')).toBe(false)
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 60_000)
})
