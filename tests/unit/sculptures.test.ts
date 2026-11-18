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
import { layoutPediment, SCAN_CONVENTIONS } from '../../src/geometry/figures'
import { buildSite } from '../../src/geometry/sanctuary'
import { mirrorScan } from '../../src/app/sculptures'
import { buildTemple } from '../../src/geometry/temple'
import { THORVALDSEN_NOTE, CULT_STATUE_LABEL, aboutText, buildAboutContent } from '../../src/app/about/content'

type Asset = { plinthM: number; lods: Record<string, { file: string; triangles: number; bytes: number }> }
const A = assets as Record<string, Asset>
const doc = sanctuary as unknown as SanctuaryDoc
const r = resolveDimensions(dimensions.dimensions as unknown as Dimensions, { eastRamp: true, rampWidth: doc.temple.rampWidth.value, foundationDepth: doc.temple.foundationDepth.value })
const temple = buildTemple(r, 'low', palette.colors as Record<string, { color: string; pattern: string }>)
const field = { faceX: r.pediment.tympanumX, outerX: r.roof.halfX, baseY: r.pediment.baseY, halfZ: r.pediment.halfZ, apexY: r.pediment.apexY }

type Entry = (typeof sculptures.sculptures)[number] & { asset?: string; mirror?: boolean }
const entries = sculptures.sculptures as Entry[]
const real = entries.filter((e) => e.kind === 'real')

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
    for (const s of entries) {
      if ('figureId' in s.slot && s.slot.figureId) expect(figureIds.has(s.slot.figureId), s.id).toBe(true)
      const a = entries.find((x) => x.id === (s.asset ?? s.id))!
      expect(a.kind, `${s.id} reuses a real scan`).toBe('real')
      expect(sourceIds.has(a.source!.sourceId), s.id).toBe(true)
      if (s.kind !== 'real') expect(s.from, s.id).toMatch(/^(mirrored|imagined) from /)
    }
    // Every pediment slot has a scan (stand-ins remain only as the loading fallback).
    const filled = new Set(entries.flatMap((e) => ('figureId' in e.slot && e.slot.figureId ? [e.slot.figureId] : [])))
    for (const id of [...pediments.west.figures, ...pediments.eastOptions.find((o) => o.id === pediments.eastDisplayed)!.figures].map((f) => f.id)) expect(filled.has(id), id).toBe(true)
    const sphinx = entries.find((e) => e.id === 'sphinx-aegina')!
    expect(sources.sources.find((x) => x.id === 'sketchfab-marchal-sphinx')!.licence).toMatch(/CC BY-NC-SA 4\.0/)
    expect(sphinx.licence).toMatch(/likewise CC BY-NC-SA/)
    const smk = sources.sources.find((s) => s.id === 'smk-royal-cast-collection')!
    expect(smk.licence).toMatch(/Public Domain Mark 1\.0/)
  })

  it('every scan has both LODs on disk, within the triangle targets and the 1.5 MB high-tier budget', () => {
    let high = 0
    for (const s of real) {
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
  it('height-based layout: every vertex on the cornice, in front of the tympanum, under the soffit, inside the field; no overlaps', async () => {
    const slots = new Map(temple.figureSlots.map((f) => [f.id, f]))
    const scans = new Map<string, Float32Array>()
    for (const e of real) if (A[e.id]) scans.set(e.id, await glbPositions(A[e.id].lods.low.file))
    for (const side of ['west', 'east'] as const) {
      const row = entries
        .filter((e) => 'pediment' in e.slot && e.slot.pediment === side)
        .map((e) => {
          const p = scans.get(e.asset ?? e.id)!
          const pts = e.mirror ? mirrorScan({ positions: p, normals: new Float32Array(p.length), index: new Uint32Array(0) }).positions : p
          return { e, slot: slots.get((e.slot as { figureId: string }).figureId)!, pts }
        })
        .sort((a, b) => (side === 'east' ? b.slot.z - a.slot.z : a.slot.z - b.slot.z))
      const centre = row.findIndex((r) => Math.abs(r.slot.z) < 1e-6)
      const fits = layoutPediment(field, side, row.map((r) => ({ points: r.pts, plinth: Math.min(A[r.e.asset ?? r.e.id].plinthM, SCAN_CONVENTIONS.maxPlinth) })), centre)
      const spans: [number, number, string][] = []
      row.forEach((r, k) => {
        const fit = fits[k]
        const p = r.pts
        expect(fit.scale, r.e.id).toBeGreaterThan(0.45)
        expect(fit.scale, r.e.id).toBeLessThanOrEqual(1)
        const c = Math.cos(fit.rotY), sn = Math.sin(fit.rotY)
        let z0 = Infinity, z1 = -Infinity
        for (let i = 0; i < p.length; i += 3) {
          const x = fit.position[0] + (c * p[i] + sn * p[i + 2]) * fit.scale
          const y = fit.position[1] + p[i + 1] * fit.scale
          const z = fit.position[2] + (-sn * p[i] + c * p[i + 2]) * fit.scale
          z0 = Math.min(z0, z)
          z1 = Math.max(z1, z)
          expect(Math.abs(z), r.e.id).toBeLessThan(field.halfZ)
          expect(Math.abs(x), r.e.id).toBeGreaterThan(field.faceX)
          expect(Math.abs(x), r.e.id).toBeLessThanOrEqual(field.outerX + SCAN_CONVENTIONS.overhang + 1e-6)
          if (y > field.baseY) expect(y, r.e.id).toBeLessThanOrEqual(field.baseY + (field.apexY - field.baseY) * (1 - Math.abs(z) / field.halfZ) + 1e-6)
        }
        spans.push([z0, z1, r.e.id])
      })
      spans.sort((a, b) => a[0] - b[0])
      for (let i = 1; i < spans.length; i++) expect(spans[i][0], `${spans[i - 1][2]} / ${spans[i][2]}`).toBeGreaterThanOrEqual(spans[i - 1][1])
    }
  }, 120_000)

  it('the sphinx slot sits on the votive column capital and its scan fits the crowning height', () => {
    const site = buildSite(doc, r.stylobate.top, 'low', palette.colors as Record<string, { color: string; pattern: string }>, {})
    const sp = site.sanctuary.sphinxSlots[0]
    const f = (sanctuary.features as unknown as Record<string, { center: [number, number]; crowning?: { height: { value: number } } }>)['votive-column']
    expect([sp.x, sp.z]).toEqual(f.center)
    expect(sp.height).toBe(f.crowning!.height.value)
    expect(sp.ranges[0].count).toBeGreaterThan(0)
    expect((assets as Record<string, { size: number[] }>)['sphinx-aegina'].size[1]).toBeCloseTo(sp.height, 3)
  })

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
    for (const s of real.filter((e) => e.source!.sourceId === 'smk-royal-cast-collection')) expect(text).toContain(`SMK ${s.source!.objectNumber}`)
    for (const s of entries.filter((e) => e.kind !== 'real')) expect(text).toContain(s.from!)
    expect(text).toContain('A comparable sphinx (cast of the Sphinx of Aegina, Copenhagen); the Aphaia original is lost')
    expect(text).toContain('Sphinx seated by Geoffrey Marchal is licensed under CC Attribution-NonCommercial-ShareAlike.')
    expect(text).toContain('Public Domain Mark 1.0')
  })
})
