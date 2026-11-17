// The real sanctuary.json (Step 3b): schema, references, phases and decisions, footprints, and the built site.
import { describe, expect, it } from 'vitest'
import dimensions from '../../src/data/dimensions.json'
import palette from '../../src/data/palette.json'
import sources from '../../src/data/sources.json'
import sanctuary from '../../src/data/sanctuary.json'
import { resolveDimensions } from '../../src/data/resolveDimensions'
import { convexOverlap, footprints, partitionByPhase, rotatedRect, sanctuaryRefErrors, type Point2, type SanctuaryDoc } from '../../src/data/sanctuary'
import { pointInPolygon } from '../../src/data/polygon'
import type { Dimensions } from '../../src/data/types'
import { validate } from '../../src/data/validate'
import { buildSite } from '../../src/geometry/sanctuary'
import { buildTemple, triangleCount } from '../../src/geometry/temple'
import { TIERS, mergeOutputs } from '../../src/geometry/types'
import { findCoplanarOverlaps, meshProblems, worldTriangles } from './helpers/triangles'

const doc = sanctuary as unknown as SanctuaryDoc
const sourceIds = new Set(sources.sources.map((s) => s.id))
const dims = dimensions.dimensions as unknown as Dimensions
const resolve = () => resolveDimensions(dims, { eastRamp: true, rampWidth: doc.temple.rampWidth.value, foundationDepth: doc.temple.foundationDepth.value })

describe('sanctuary.json', () => {
  it('validates and every reference resolves', () => {
    expect(validate('sanctuary', doc)).toEqual([])
    expect(sanctuaryRefErrors(doc, sourceIds)).toEqual([])
  })

  it('c. 490 BC: earlier and later structures hidden, the votive column and Südbau shown but flagged uncertain', () => {
    expect(doc.meta.displayYear).toBe(-490)
    const { shown, hidden } = partitionByPhase(doc)
    for (const id of ['old-altar-6th', 'old-propylon', 'old-houses', 'old-peribolos-7th', 'remodelling-4th-c']) expect(hidden).toContain(id)
    for (const id of ['votive-column', 'suedbau-north-wall', 'propylon', 'altar', 'cistern']) expect(shown).toContain(id)
    expect(doc.features['votive-column'].uncertain).toBeTruthy()
    expect(doc.features['suedbau-north-wall'].uncertain).toBeTruthy()
  })

  it('placement is always the plan; the terrain is conjectural; terrace level = base of the lowest step', () => {
    for (const f of Object.values(doc.features)) expect(f.placement.source).toBe('plan')
    expect(doc.terrain.confidence).toBe('conjectural')
    const S = dims.crepidomaStepCount.value * dims.crepidomaStepRise.value
    expect(doc.terrain.terraces['temple-terrace'].level.value).toBeCloseTo(-S, 6)
  })

  it('verified text numbers are used where the text gives them', () => {
    const f = doc.features
    if (f.altar.kind !== 'altar' || f.propylon.kind !== 'building' || f.cistern.kind !== 'cistern' || f['altar-court'].kind !== 'pavement') throw new Error('kinds')
    expect(f.altar.width.value).toBe(13.08)
    expect(f.propylon.crossWalls![0].thickness.value).toBe(0.6)
    expect(f.propylon.steps?.side).toBe('s')
    expect(f.cistern.diameter!.value).toBe(1.2)
    const zs = f['altar-court'].polygon.map((p) => p[1])
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(14.9, 6)
  })

  it('no shown solid overlaps the temple, or another solid outside its complex; solids stand on a terrace', () => {
    const r = resolve()
    const krepis = rotatedRect([0, 0], 2 * r.crepidoma.steps[0].halfX, 2 * r.crepidoma.steps[0].halfZ, 0)
    const { shown } = partitionByPhase(doc)
    const solids = shown.filter((id) => ['building', 'altar', 'base', 'cistern', 'column'].includes(doc.features[id].kind))
    for (const id of shown) {
      if (doc.features[id].kind === 'pavement') continue
      for (const fp of footprints(doc.features[id])) expect(convexOverlap(fp, krepis), id).toBe(false)
    }
    for (const a of solids)
      for (const b of solids) {
        if (a >= b) continue
        const ca = doc.features[a].complex
        if (ca && ca === doc.features[b].complex) continue
        for (const fa of footprints(doc.features[a])) for (const fb of footprints(doc.features[b])) expect(convexOverlap(fa, fb), `${a} x ${b}`).toBe(false)
      }
    const ts = Object.values(doc.terrain.terraces).map((t) => t.polygon)
    for (const id of solids) {
      const c = (doc.features[id] as { center: Point2 }).center
      expect(ts.some((t) => pointInPolygon(t, c)), id).toBe(true)
    }
  })
})

describe.each(TIERS)('built site (%s)', (tier) => {
  const r = resolve()
  const temple = buildTemple(r, tier, palette.colors, { ground: false })
  const site = buildSite(doc, r.stylobate.top, tier, palette.colors)
  const all = mergeOutputs([temple, site.sanctuary.output, site.terrain])

  it('clean meshes', () => {
    expect(meshProblems(all.groups)).toEqual([])
  })

  it('no coplanar overlaps across temple, sanctuary and terrain', () => {
    const hits = findCoplanarOverlaps(worldTriangles(all))
    expect(hits.map((h) => `${h.a} x ${h.b} @ ${h.at.map((v) => v.toFixed(2))} (${(h.area * 1e4).toFixed(1)} cm2)`)).toEqual([])
  }, 180_000)

  it('the krepis rests on the temple terrace; its foundation skirt reaches below the terrain around it', () => {
    const terrace = all.levels.find((l) => l.name === 'terrace-temple-terrace')!
    expect(terrace.y).toBeCloseTo(0, 6) // base of the lowest step
    expect(r.crepidoma.steps[0].y0).toBeCloseTo(-doc.temple.foundationDepth.value, 6)
  })

  it('walk-mode data: terrace levels, terrain heightfield, colliders for buildings, altar and column', () => {
    const names = all.levels.map((l) => l.name)
    for (const n of ['terrace-temple-terrace', 'terrace-outer-terrace', 'terrace-suedbau-terrace', 'terrain', 'stylobate']) expect(names).toContain(n)
    const c = all.colliders.map((x) => x.name)
    for (const n of ['altar-altar', 'votive-column-column', 'cistern-cistern']) expect(c).toContain(n)
    expect(c.some((n) => n.startsWith('propylon-'))).toBe(true)
  })

  it('triangle budget (temple + sanctuary + terrain)', () => {
    const n = triangleCount(all)
    expect(n).toBeLessThan(tier === 'low' ? 300_000 : 1_500_000)
  })
})
