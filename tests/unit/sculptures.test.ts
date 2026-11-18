// Scanned sculptures: manifest, assets and budget, licences, slot fitting of the real GLB vertices.
import { readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import type { Mesh } from 'three'
import dimensions from '../../src/data/dimensions.json'
import palette from '../../src/data/palette.json'
import pediments from '../../src/data/pediments.json'
import sanctuary from '../../src/data/sanctuary.json'
import sources from '../../src/data/sources.json'
import sculptures from '../../src/data/sculptures.json'
import assets from '../../src/data/sculpture-assets.json'
import { validate } from '../../src/data/validate'
import { resolveDimensions } from '../../src/data/resolveDimensions'
import type { SanctuaryDoc } from '../../src/data/sanctuary'
import type { Dimensions } from '../../src/data/types'
import { fitScan, SCAN_CONVENTIONS } from '../../src/geometry/figures'
import { buildTemple } from '../../src/geometry/temple'
import { THORVALDSEN_NOTE, CULT_STATUE_LABEL, aboutText, buildAboutContent } from '../../src/app/about/content'

type Asset = { plinthM: number; lods: Record<string, { file: string; triangles: number; bytes: number }> }
const A = assets as Record<string, Asset>
const doc = sanctuary as unknown as SanctuaryDoc
const r = resolveDimensions(dimensions.dimensions as unknown as Dimensions, { eastRamp: true, rampWidth: doc.temple.rampWidth.value, foundationDepth: doc.temple.foundationDepth.value })
const temple = buildTemple(r, 'low', palette.colors as Record<string, { color: string; pattern: string }>)
const field = { faceX: r.pediment.tympanumX, outerX: r.roof.halfX, baseY: r.pediment.baseY, halfZ: r.pediment.halfZ, apexY: r.pediment.apexY }

async function glbPositions(file: string): Promise<Float32Array> {
  const buf = readFileSync(`public/sculptures/${file}`)
  await MeshoptDecoder.ready
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '')
  const out: number[] = []
  gltf.scene.updateMatrixWorld(true)
  gltf.scene.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh) return
    const p = m.geometry.getAttribute('position')
    const e = m.matrixWorld.elements
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
      out.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14])
    }
  })
  return new Float32Array(out)
}

describe('sculptures manifest', () => {
  it('validates; every slot and source exists; licences are open', () => {
    expect(validate('sculptures', sculptures)).toEqual([])
    const figureIds = new Set([...pediments.west.figures, ...pediments.eastOptions.flatMap((o) => o.figures)].map((f) => f.id))
    const sourceIds = new Set(sources.sources.map((s) => s.id))
    for (const s of sculptures.sculptures) {
      if ('figureId' in s.slot && s.slot.figureId) expect(figureIds.has(s.slot.figureId), s.id).toBe(true)
      expect(sourceIds.has(s.source.sourceId), s.id).toBe(true)
    }
    const smk = sources.sources.find((s) => s.id === 'smk-royal-cast-collection')!
    expect(smk.licence).toMatch(/Public Domain Mark 1\.0/)
  })

  it('every scan has both LODs on disk, within the triangle targets and the 1.5 MB high-tier budget', () => {
    let high = 0
    for (const s of sculptures.sculptures) {
      const a = A[s.id]
      expect(a, s.id).toBeDefined()
      for (const lod of ['high', 'low'] as const) {
        const f = a.lods[lod]
        expect(statSync(`public/sculptures/${f.file}`).size).toBe(f.bytes)
        expect(f.triangles).toBeLessThanOrEqual(sculptures.lodTriangles[lod] * 1.01)
      }
      high += a.lods.high.bytes
    }
    expect(high).toBeLessThan(1.5 * 1024 * 1024)
  })
})

describe('slot fitting with the real scan vertices', () => {
  it('every pediment scan sits on the cornice, in front of the tympanum, under the raking soffit and inside the field', async () => {
    const slots = new Map(temple.figureSlots.map((f) => [f.id, f]))
    for (const s of sculptures.sculptures) {
      if (!('figureId' in s.slot) || !s.slot.figureId) continue
      const slot = slots.get(s.slot.figureId)!
      const p = await glbPositions(A[s.id].lods.low.file)
      const plinth = Math.min(A[s.id].plinthM, SCAN_CONVENTIONS.maxPlinth)
      const fit = fitScan(p, plinth, slot.side, slot.z, field, slot.spacing * SCAN_CONVENTIONS.shiftFraction)
      expect(fit.scale, s.id).toBeGreaterThan(0.35)
      expect(fit.scale, s.id).toBeLessThanOrEqual(1)
      const c = Math.cos(fit.rotY), sn = Math.sin(fit.rotY)
      for (let i = 0; i < p.length; i += 3) {
        const x = fit.position[0] + (c * p[i] + sn * p[i + 2]) * fit.scale
        const y = fit.position[1] + p[i + 1] * fit.scale
        const z = fit.position[2] + (-sn * p[i] + c * p[i + 2]) * fit.scale
        expect(Math.abs(z), s.id).toBeLessThan(field.halfZ)
        expect(Math.abs(x), s.id).toBeGreaterThan(field.faceX)
        expect(Math.abs(x), s.id).toBeLessThanOrEqual(field.outerX + SCAN_CONVENTIONS.overhang + 1e-6)
        if (y > field.baseY) expect(y, s.id).toBeLessThanOrEqual(field.baseY + (field.apexY - field.baseY) * (1 - Math.abs(z) / field.halfZ) + 1e-6)
      }
    }
  }, 60_000)

  it('the cult statue base sits on the naos floor at two thirds of the cella from the door, with a walk collider', () => {
    const c = temple.cultSlot
    const L = r.cella.eastWallX[0] - r.cella.westWallX[1]
    expect((r.cella.eastWallX[0] - c.x) / L).toBeCloseTo(2 / 3, 6)
    expect([c.halfX * 2, c.halfZ * 2]).toEqual([1.12, 0.92])
    expect(temple.colliders.some((k) => k.name === 'cult-statue-base')).toBe(true)
  })
})

describe('About credits', () => {
  it('carries the Thorvaldsen note, the cult-statue label and per-figure SMK credits', () => {
    const text = aboutText(buildAboutContent({ site: { bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, displayLabel: '', features: [], terrainMismatches: [], attribution: [], demLoadMs: 0 }, log: [] }))
    expect(text).toContain(THORVALDSEN_NOTE)
    expect(text).toContain(CULT_STATUE_LABEL)
    for (const s of sculptures.sculptures) expect(text).toContain(`SMK ${s.source.objectNumber}`)
    expect(text).toContain('Public Domain Mark 1.0')
  })
})
