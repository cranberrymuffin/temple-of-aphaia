// Step 3b prep: sanctuary schema/types and the pure generators, on a SYNTHETIC fixture and terrain.
import { describe, expect, it } from 'vitest'
import dimensions from '../../src/data/dimensions.json'
import palette from '../../src/data/palette.json'
import sources from '../../src/data/sources.json'
import { resolveDimensions } from '../../src/data/resolveDimensions'
import {
  convexOverlap,
  footprints,
  isShown,
  partitionByPhase,
  rotatedRect,
  sanctuaryRefErrors,
  type Point2,
  type SanctuaryDoc,
} from '../../src/data/sanctuary'
import type { Dimensions } from '../../src/data/types'
import { validate } from '../../src/data/validate'
import { buildSanctuary, buildTerrain, groundFromHeightfield, terrainCuts } from '../../src/geometry/sanctuary'
import { insideConvex, offsetPolyline } from '../../src/geometry/sanctuary/common'
import { decodeHeightfield, encodeHeightfield, sampleHeight, subtractConvex } from '../../src/geometry/sanctuary/terrain'
import { TIERS, mergeOutputs, type Heightfield } from '../../src/geometry/types'
import fixture from '../fixtures/sanctuary.synthetic.json'
import { findCoplanarOverlaps, meshProblems, worldTriangles } from './helpers/triangles'

const doc = fixture as unknown as SanctuaryDoc
const sourceIds = new Set(sources.sources.map((s) => s.id))
const clone = <T>(v: T): T => structuredClone(v)

/** Synthetic terrain: gentle slope + undulation, 0.5 m grid over 90 x 80 m, with a no-data patch. */
function synthTerrain(): Heightfield {
  const nx = 181
  const nz = 161
  const hf: Heightfield = { nx, nz, cell: 0.5, originX: -45, originZ: -40, heights: new Float32Array(nx * nz) }
  for (let iz = 0; iz < nz; iz++)
    for (let ix = 0; ix < nx; ix++) {
      const x = hf.originX + ix * hf.cell
      const z = hf.originZ + iz * hf.cell
      hf.heights[iz * nx + ix] = 0.02 * x + 0.03 * z + 0.3 * Math.sin(x / 7) * Math.cos(z / 9)
    }
  for (let iz = 4; iz < 8; iz++) for (let ix = 4; ix < 8; ix++) hf.heights[iz * nx + ix] = NaN
  return hf
}
const hf = synthTerrain()
const ground = groundFromHeightfield(hf)

describe('sanctuary schema and references', () => {
  it('the synthetic fixture validates and its references resolve', () => {
    expect(validate('sanctuary', doc)).toEqual([])
    expect(sanctuaryRefErrors(doc, sourceIds)).toEqual([])
  })

  it('rejects scan placement without a frame-bound pick, and pages on unverified values', () => {
    const d = clone(doc)
    d.features['altar-a'].placement = { source: 'scan', ref: 'furtwangler-1906', verified: false }
    expect(validate('sanctuary', d).length).toBeGreaterThan(0)
    const e = clone(doc)
    e.features['altar-a'].placement = { source: 'scan', ref: 'furtwangler-1906', verified: false, pickId: 'altar', frameHash: 'a'.repeat(64) }
    expect(validate('sanctuary', e)).toEqual([])
    const p = clone(doc) as unknown as { features: Record<string, { length: Record<string, unknown> }> }
    p.features['altar-a'].length.page = '25'
    expect(validate('sanctuary', p).length).toBeGreaterThan(0)
  })

  it('rejects kind-specific omissions and unknown fields', () => {
    const d = clone(doc) as unknown as { features: Record<string, Record<string, unknown>> }
    delete d.features['cistern-a'].length
    expect(validate('sanctuary', d).length).toBeGreaterThan(0)
    const e = clone(doc) as unknown as { features: Record<string, Record<string, unknown>> }
    e.features['house-a'].roofPitch = 12
    expect(validate('sanctuary', e).length).toBeGreaterThan(0)
    const s = clone(doc) as unknown as { features: Record<string, { kind: string }> }
    s.features['house-a'].kind = 'temple'
    expect(validate('sanctuary', s).length).toBeGreaterThan(0)
  })

  it('reference checks catch unknown sources, dangling channels and doors that do not fit', () => {
    const d = clone(doc)
    d.features['house-a'].sourceIds = ['nope']
    const ch = d.features['channel-a']
    if (ch.kind === 'channel') ch.feeds = 'house-a'
    const h = d.features['house-a']
    if (h.kind === 'building') h.doors[0].width.value = 20
    const errs = sanctuaryRefErrors(d, sourceIds)
    expect(errs.some((e) => e.includes('unknown source nope'))).toBe(true)
    expect(errs.some((e) => e.includes('not a cistern'))).toBe(true)
    expect(errs.some((e) => e.includes('does not fit'))).toBe(true)
  })

  it('phase tags: only features spanning the display year are shown', () => {
    expect(isShown({ label: 'x', fromYear: null, toYear: null, confidence: 'conjectural', sourceIds: ['a'] }, -500)).toBe(true)
    expect(isShown({ label: 'x', fromYear: -480, toYear: null, confidence: 'conjectural', sourceIds: ['a'] }, -500)).toBe(false)
    expect(isShown({ label: 'x', fromYear: null, toYear: -510, confidence: 'conjectural', sourceIds: ['a'] }, -500)).toBe(false)
    const { shown, hidden } = partitionByPhase(doc)
    expect(hidden).toEqual(['stoa-late'])
    expect(shown).toHaveLength(Object.keys(doc.features).length - 1)
  })
})

describe('footprints', () => {
  const r = resolveDimensions(dimensions.dimensions as unknown as Dimensions, { eastRamp: true })
  const temple: Point2[][] = [
    rotatedRect([0, 0], 2 * r.crepidoma.steps[0].halfX, 2 * r.crepidoma.steps[0].halfZ, 0),
    rotatedRect([(r.ramp!.minX + r.ramp!.maxX) / 2, 0], r.ramp!.maxX - r.ramp!.minX, 2 * r.ramp!.halfZ, 0),
  ]
  const shown = partitionByPhase(doc).shown

  it('separating-axis overlap: overlapping yes, touching or apart no', () => {
    const a = rotatedRect([0, 0], 2, 2, 0)
    expect(convexOverlap(a, rotatedRect([1, 1], 2, 2, 30))).toBe(true)
    expect(convexOverlap(a, rotatedRect([2, 0], 2, 2, 0))).toBe(false)
    expect(convexOverlap(a, rotatedRect([5, 0], 2, 2, 45))).toBe(false)
  })

  it('rotation sense matches the instance matrices (+90 deg turns local x toward north, -z)', () => {
    const p = rotatedRect([0, 0], 4, 0.0001, 90)
    expect(Math.min(...p.map((v) => v[1]))).toBeCloseTo(-2, 3)
  })

  it('no shown feature overlaps the temple (krepis and ramp) or another building', () => {
    for (const id of shown) for (const fp of footprints(doc.features[id])) for (const t of temple) expect(convexOverlap(fp, t), id).toBe(false)
    const solids = shown.filter((id) => ['building', 'altar', 'cistern'].includes(doc.features[id].kind))
    for (const a of solids)
      for (const b of solids)
        if (a < b) for (const fa of footprints(doc.features[a])) for (const fb of footprints(doc.features[b])) expect(convexOverlap(fa, fb), `${a} x ${b}`).toBe(false)
  })

  it('terrain exists under every shown footprint', () => {
    for (const id of shown)
      for (const fp of footprints(doc.features[id])) for (const p of fp) expect(Number.isFinite(sampleHeight(hf, p[0], p[1])), id).toBe(true)
  })

  it('altar steps footprint sits on the step side only', () => {
    const a = doc.features['altar-a']
    const [body, steps] = footprints(a)
    expect(steps).toBeDefined()
    expect(Math.max(...steps.map((p) => p[0]))).toBeCloseTo(Math.min(...body.map((p) => p[0])), 9)
  })
})

describe('terrain', () => {
  it('bilinear sampling is exact on a planar field and skips missing samples', () => {
    const plane: Heightfield = { nx: 3, nz: 3, cell: 2, originX: 0, originZ: 0, heights: new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]) }
    expect(sampleHeight(plane, 1, 1)).toBeCloseTo(2, 6) // 0.5*x + 1.5*z at (1, 1)
    expect(sampleHeight(plane, 3.2, 2.6)).toBeCloseTo(0.5 * 3.2 + 1.5 * 2.6, 5)
    expect(sampleHeight(plane, -1, 0)).toBeNaN()
    plane.heights[4] = NaN
    expect(Number.isFinite(sampleHeight(plane, 1, 1))).toBe(true)
  })

  it('LOD: full grid at high, fewer triangles at lower tiers, missing cells dropped', () => {
    const full = buildTerrain(hf, 'high', palette.colors, [])
    const tris = full.groups[0].indices.length / 3
    const missingCells = 5 * 5 // a 4 x 4 block of NaN samples removes the 5 x 5 cells touching it
    expect(tris).toBe(2 * ((hf.nx - 1) * (hf.nz - 1) - missingCells))
    const low = buildTerrain(hf, 'low', palette.colors, [])
    expect(low.groups[0].indices.length / 3).toBeLessThan(tris / 10)
    expect(meshProblems([...full.groups, ...low.groups])).toEqual([])
    const lvl = full.levels[0]
    expect(lvl.heightfield).toBe(hf)
  })

  it('convex subtraction leaves only the outside, with the right area', () => {
    const tri: Point2[] = [[0, 0], [0, 4], [4, 4]]
    const hole = rotatedRect([2, 3], 1, 1, 0)
    const pieces = subtractConvex(tri, hole)
    const area = (p: Point2[]) => Math.abs(p.reduce((s, v, i) => s + v[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * v[1], 0)) / 2
    expect(pieces.reduce((s, p) => s + area(p), 0)).toBeCloseTo(8 - 1, 9)
    for (const p of pieces) expect(insideConvex(hole, [p.reduce((s, v) => s + v[0], 0) / p.length, p.reduce((s, v) => s + v[1], 0) / p.length])).toBe(false)
  })

  it('cuts: no terrain inside any cut, and the cut area is removed', () => {
    const cuts = partitionByPhase(doc).shown.flatMap((id) => terrainCuts(doc.features[id], 'high'))
    const t = buildTerrain(hf, 'high', palette.colors, cuts)
    const g = t.groups[0]
    let area = 0
    for (let i = 0; i < g.indices.length; i += 3) {
      const v = [0, 1, 2].map((k) => g.indices[i + k])
      const c: Point2 = [v.reduce((s, k) => s + g.positions[3 * k], 0) / 3, v.reduce((s, k) => s + g.positions[3 * k + 2], 0) / 3]
      // Strictly inside (cut shrunk by 0.1%): slivers touching a cut edge are allowed.
      for (const cut of cuts) {
        const m = cut.reduce((acc, p) => [acc[0] + p[0] / cut.length, acc[1] + p[1] / cut.length], [0, 0])
        expect(insideConvex(cut.map((p) => [m[0] + 0.999 * (p[0] - m[0]), m[1] + 0.999 * (p[1] - m[1])] as Point2), c)).toBe(false)
      }
      const [a, b, d] = v.map((k) => [g.positions[3 * k], g.positions[3 * k + 2]])
      area += Math.abs((b[0] - a[0]) * (d[1] - a[1]) - (d[0] - a[0]) * (b[1] - a[1])) / 2
    }
    expect(meshProblems(t.groups)).toEqual([])
    expect(area).toBeLessThan(90 * 80)
  })

  it('16-bit binary round trip within half a quantum, NaN preserved, 2 bytes per sample', () => {
    const buf = encodeHeightfield(hf)
    expect(buf.byteLength).toBe(40 + 2 * hf.nx * hf.nz)
    const back = decodeHeightfield(buf)
    expect([back.nx, back.nz, back.cell, back.originX, back.originZ]).toEqual([hf.nx, hf.nz, hf.cell, hf.originX, hf.originZ])
    const finite = [...hf.heights].filter(Number.isFinite)
    const q = (Math.max(...finite) - Math.min(...finite)) / 65534
    for (let i = 0; i < hf.heights.length; i++) {
      if (Number.isNaN(hf.heights[i])) expect(back.heights[i]).toBeNaN()
      else expect(Math.abs(back.heights[i] - hf.heights[i])).toBeLessThanOrEqual(q / 2 + 1e-6)
    }
  })
})

describe.each(TIERS)('sanctuary generators on synthetic terrain (%s)', (tier) => {
  const s = buildSanctuary(doc, tier, palette.colors, ground)
  const t = buildTerrain(hf, tier, palette.colors, s.cuts)

  it('builds every shown feature and reports placement for all of them', () => {
    const names = new Set(s.output.groups.map((g) => g.name))
    for (const n of ['altar', 'sanctuary-building', 'sanctuary-floor', 'sanctuary-wall', 'cistern', 'channel']) expect(names, n).toContain(n)
    expect(s.report).toHaveLength(Object.keys(doc.features).length)
    expect(s.report.find((x) => x.id === 'stoa-late')).toMatchObject({ shown: false, placement: 'plan' })
    expect(s.output.colliders.some((c) => c.name.startsWith('stoa-late'))).toBe(false)
  })

  it('clean meshes (no NaN, degenerate or inverted triangles)', () => {
    expect(meshProblems([...s.output.groups, ...t.groups])).toEqual([])
  })

  it('no coplanar overlaps between features and the cut terrain', () => {
    const hits = findCoplanarOverlaps(worldTriangles(mergeOutputs([s.output, t])))
    expect(hits.map((h) => `${h.a} x ${h.b} ${h.at.map((v) => v.toFixed(2))}`)).toEqual([])
  }, 60_000)

  it('features sit on the terrain: skirts below the lowest ground, floors above the highest', () => {
    for (const id of ['house-a', 'propylon-a']) {
      const f = doc.features[id]
      const fp = footprints(f)[0]
      const lv = s.output.levels.find((l) => l.name === `${id}-floor`)!
      for (const p of fp) expect(lv.y).toBeGreaterThan(ground(p[0], p[1]))
      const walls = s.output.colliders.filter((c) => c.name.startsWith(`${id}-`) && c.name.includes('wall'))
      expect(walls.length).toBeGreaterThan(0)
      for (const w of walls) for (const p of fp) expect(w.y0).toBeLessThan(ground(p[0], p[1]))
    }
  })

  it('colliders and levels for walk mode: walls, door gaps, altar, cistern', () => {
    const house = doc.features['house-a']
    if (house.kind !== 'building') throw new Error('fixture')
    const floor = s.output.levels.find((l) => l.name === 'house-a-floor')!
    const lintels = s.output.colliders.filter((c) => c.name.startsWith('house-a-') && c.name.includes('lintel'))
    expect(lintels).toHaveLength(house.doors.length)
    for (const l of lintels) expect(l.y0).toBeGreaterThanOrEqual(floor.y + Math.min(...house.doors.map((d) => d.height.value)) - 1e-9)
    // Propylon: open sides have no wall colliders.
    expect(s.output.colliders.filter((c) => c.name.startsWith('propylon-a-e-') || c.name.startsWith('propylon-a-w-'))).toEqual([])
    expect(s.output.colliders.some((c) => c.name === 'altar-a-altar')).toBe(true)
    expect(s.output.levels.filter((l) => l.name.startsWith('altar-a-step-'))).toHaveLength(3)
    expect(s.output.colliders.find((c) => c.name === 'cistern-b-cistern')?.kind).toBe('circle')
    const walls = s.output.colliders.filter((c) => c.name.startsWith('terrace-a-') || c.name.startsWith('peribolos-a-'))
    expect(walls).toHaveLength(2 + 4)
  })

  it('triangle budget (sanctuary + terrain)', () => {
    const n = [...s.output.groups, ...t.groups].reduce((a, g) => a + g.indices.length / 3, 0)
    expect(n).toBeLessThan(tier === 'low' ? 30_000 : 150_000)
  })
})

describe('polyline offsets', () => {
  it('mitred offsets keep the wall thickness on straight runs and at right angles', () => {
    const { left, right } = offsetPolyline([[0, 0], [10, 0], [10, 10]], 1)
    expect(left[0]).toEqual([0, -0.5])
    expect(right[0]).toEqual([0, 0.5])
    expect(left[1][0]).toBeCloseTo(10.5, 9)
    expect(left[1][1]).toBeCloseTo(-0.5, 9)
    expect(right[1][0]).toBeCloseTo(9.5, 9)
    expect(right[1][1]).toBeCloseTo(0.5, 9)
  })
})
