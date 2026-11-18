// The real sanctuary.json (Step 3b): schema, references, phases and decisions, footprints, and the built site.
import { describe, expect, it } from 'vitest'
import dimensions from '../../src/data/dimensions.json'
import palette from '../../src/data/palette.json'
import sources from '../../src/data/sources.json'
import sanctuary from '../../src/data/sanctuary.json'
import { resolveDimensions } from '../../src/data/resolveDimensions'
import { convexOverlap, footprints, partitionByPhase, rotatedRect, sanctuaryRefErrors, type Point2, type SanctuaryDoc } from '../../src/data/sanctuary'
import { offsetPolyline, pointInPolygon } from '../../src/data/polygon'
import type { Dimensions } from '../../src/data/types'
import { validate } from '../../src/data/validate'
import { buildSite, siteGround } from '../../src/geometry/sanctuary'
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

  it('c. 490 BC: earlier and later structures hidden; the sphinx column shown and attested; the Südbau kept but hidden', () => {
    expect(doc.meta.displayYear).toBe(-490)
    const { shown, hidden } = partitionByPhase(doc)
    for (const id of ['old-altar-6th', 'old-propylon', 'old-houses', 'old-peribolos-7th', 'remodelling-4th-c']) expect(hidden).toContain(id)
    for (const id of ['votive-column', 'propylon', 'altar', 'cistern']) expect(shown).toContain(id)
    const col = doc.features['votive-column']
    expect(col.uncertain).toBeUndefined()
    expect(col.confidence).toBe('attested')
    expect(col.sourceIds).toContain('ministry-onsite-boards')
    for (const id of ['suedbau-north-wall', 'suedbau-south-wall', 'suedbau-cross-wall-1', 'suedbau-cross-wall-2']) {
      expect(hidden).toContain(id)
      expect(doc.features[id].hiddenReason).toMatch(/not depicted in the Ministry reconstruction; shape unknown/i)
    }
    expect(doc.terrain.terraces['suedbau-terrace'].hiddenReason).toBeTruthy()
  })

  it('Ministry board findings: enclosure parapet, NE ashlar coping, older east stretch, priests\' houses, altar court, cistern well-head', () => {
    const f = doc.features
    const nws = f['terrace-wall-nws']
    const se = f['terrace-wall-se']
    const e = f['terrace-wall-e']
    if (nws.kind !== 'wall' || se.kind !== 'wall' || e.kind !== 'wall') throw new Error('kinds')
    const p = nws.parapets![0]
    expect(p.segments).toEqual([0, 1, 2])
    expect(p.socle.value + p.mudbrick.value + p.coping.value).toBeCloseTo(1.8, 6)
    expect(p.mudbrick.value).toBeGreaterThan(0)
    expect(se.masonry).toEqual(['rubble', 'rubble', 'ashlar'])
    expect(e.masonry).toBe('older')
    for (const id of ['se-rooms-ii-iv', 'se-room-a', 'se-room-b', 'se-room-i7']) {
      const h = f[id]
      if (h.kind !== 'building') throw new Error(id)
      expect(h.roof?.form, id).toBe('hipped')
    }
    const front = f['se-rooms-ii-iv']
    const rear = f['se-room-a']
    const wing = f['se-forecourt']
    if (front.kind !== 'building' || rear.kind !== 'building' || wing.kind !== 'building') throw new Error('kinds')
    expect(rear.wallHeight.value).toBeGreaterThan(front.wallHeight.value) // taller block behind
    expect(front.columns?.positions.length).toBeGreaterThan(1) // columned porch
    expect(front.openSides).toContain('w') // facing the gate side
    expect(wing.roof?.form).toBe('pent')
    expect(wing.wallHeight.value).toBeLessThan(front.wallHeight.value)
    const altar = f.altar
    if (altar.kind !== 'altar') throw new Error('altar')
    expect(altar.backScreen).toBeTruthy()
    const court = Object.keys(f).filter((id) => id.startsWith('court-base-'))
    expect(court.length).toBeGreaterThanOrEqual(4)
    for (const id of [...court, 'statue-base-front']) {
      const b = f[id]
      if (b.kind !== 'base') throw new Error(id)
      expect(b.figure, id).toBeTruthy()
    }
    const front6 = f['statue-base-front']
    if (front6.kind !== 'base') throw new Error('base')
    expect(front6.height.value).toBeGreaterThan(1.5) // the tall base (legend 6)
    const cis = f.cistern
    const ch = f['water-channel']
    if (cis.kind !== 'cistern' || ch.kind !== 'channel') throw new Error('kinds')
    expect(cis.rimHeight.value).toBeGreaterThanOrEqual(0.5) // a well-head
    expect(ch.sunk).toBe(true)
    const prop = f.propylon
    if (prop.kind !== 'building') throw new Error('propylon')
    expect(prop.roofOrnament).toBeTruthy()
    expect(sources.choices['propylon-stairs-south'].note).toMatch(/RESOLVED by the Ministry/)
    const ministry = sources.sources.find((x) => x.id === 'ministry-onsite-boards')
    expect(ministry?.licence).toMatch(/Reference only/)
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
    for (const n of ['terrace-temple-terrace', 'terrace-outer-terrace', 'terrace-se-houses-terrace', 'terrain', 'stylobate']) expect(names).toContain(n)
    expect(names).not.toContain('terrace-suedbau-terrace') // hidden (user decision 2026-11-18)
    const c = all.colliders.map((x) => x.name)
    for (const n of ['altar-altar', 'votive-column-column', 'cistern-cistern']) expect(c).toContain(n)
    expect(c.some((n) => n.startsWith('propylon-'))).toBe(true)
  })

  it('triangle budget (temple + sanctuary + terrain)', () => {
    const n = triangleCount(all)
    expect(n).toBeLessThan(tier === 'low' ? 300_000 : 1_500_000)
  })
})

describe('built site on the real DEM', async () => {
  const { readFileSync } = await import('node:fs')
  const { resolve: res } = await import('node:path')
  const { loadDem } = await import('../../src/geometry/sanctuary/dem')
  const hilltopMeta = (await import('../../measurements/hilltop.json')).default
  const landscapeMeta = (await import('../../measurements/landscape.json')).default
  const png = (f: string) => new Uint8Array(readFileSync(res(__dirname, '../../measurements', f)))
  const dem = await loadDem(hilltopMeta as never, png('hilltop.png'), landscapeMeta as never, png('landscape.png'))

  it('the enclosure parapet hides the krepis from the approach (derived height check)', () => {
    // Eyes 1.6 m above the ground outside the great wall (DEM beyond the terraces, the outer and SE terraces
    // included); targets along the stylobate's top edge. Every sight line crossing the wall must pass below its top.
    const r = resolve()
    const S = r.stylobate.top
    const ground = siteGround(doc, S, 'high', dem)
    const wall = doc.features['terrace-wall-nws']
    if (wall.kind !== 'wall') throw new Error('wall')
    const p = wall.parapets![0]
    const terraceY = S + doc.terrain.terraces['temple-terrace'].level.value
    const wallTop = terraceY + p.socle.value + p.mudbrick.value + p.coping.value
    const inner = doc.terrain.terraces['temple-terrace'].polygon
    const { halfX: hx, halfZ: hz } = r.stylobate
    const targets: [number, number][] = []
    for (let k = 0; k <= 30; k++) {
      const x = -hx + (2 * hx * k) / 30
      const z = -hz + (2 * hz * k) / 30
      targets.push([x, hz], [x, -hz], [-hx, z], [hx, z])
    }
    const segs = wall.polyline.slice(1).map((b, i) => [wall.polyline[i], b] as const)
    let worst = -Infinity
    let lines = 0
    for (let ex = -80; ex <= 60; ex += 2)
      for (let ez = -70; ez <= 70; ez += 2) {
        if (pointInPolygon(inner, [ex, ez]) || pointInPolygon(doc.terrain.terraces['ne-knoll'].polygon, [ex, ez])) continue
        const ey = ground(ex, ez) + 1.6
        for (const [tx, tz] of targets)
          for (const [a, b] of segs) {
            const dx = tx - ex
            const dz = tz - ez
            const wx = b[0] - a[0]
            const wz = b[1] - a[1]
            const den = dx * wz - dz * wx
            if (Math.abs(den) < 1e-9) continue
            const s = ((a[0] - ex) * wz - (a[1] - ez) * wx) / den
            const u = ((a[0] - ex) * dz - (a[1] - ez) * dx) / den
            if (s <= 0 || s >= 1 || u < 0 || u > 1) continue
            lines++
            worst = Math.max(worst, ey + (S - ey) * s)
          }
      }
    console.log(`[parapet] wall top ${(wallTop - terraceY).toFixed(2)} m above the terrace; highest crossing sight line ${(worst - terraceY).toFixed(2)} m (${lines} lines)`)
    expect(lines).toBeGreaterThan(1000)
    expect(worst).toBeLessThan(wallTop)
  })

  describe.each(TIERS)('%s tier', (tier) => {
    const r = resolve()
    const temple = buildTemple(r, tier, palette.colors, { ground: false })
    const site = buildSite(doc, r.stylobate.top, tier, palette.colors, { dem })
    const all = mergeOutputs([temple, site.sanctuary.output, site.terrain])

    it('clean meshes, a sea plane at the DEM sea level, mismatches logged', () => {
      expect(meshProblems(all.groups)).toEqual([])
      const sea = site.terrain.groups.find((g) => g.name === 'sea')!
      expect(sea.positions[1]).toBeCloseTo(dem.seaLevelY, 3)
      for (const m of site.mismatches) {
        expect(m.maxAbove).toBeGreaterThan(0)
        expect(m.maxAbove).toBeLessThan(5) // the DEM agrees with the terrace within a few metres (georef.json)
      }
      console.log(`[dem ${tier}] mismatches ${JSON.stringify(site.mismatches.map((m) => ({ ...m, maxAbove: +m.maxAbove.toFixed(2), length: +m.length.toFixed(1) })))}`)
    })

    it('no coplanar overlaps across temple, sanctuary, DEM terrain and sea', () => {
      // Every building and terrace lies inside the hilltop window; beyond it there is only the single,
      // non-overlapping terrain grid, whose one possible coplanar partner is the sea plane (checked below).
      const W = 170
      const inside = (t: { a: number[]; b: number[]; c: number[] }) => [t.a, t.b, t.c].every((p) => Math.abs(p[0]) <= W && Math.abs(p[2]) <= W)
      const tris = worldTriangles(all).filter((t) => t.group === 'sea' || inside(t))
      const terrain = site.terrain.groups.find((g) => g.name === 'terrain')!
      for (let i = 1; i < terrain.positions.length; i += 3) expect(Math.abs(terrain.positions[i] - dem.seaLevelY)).toBeGreaterThan(0.001)
      const hits = findCoplanarOverlaps(tris)
      expect(hits.map((h) => `${h.a} x ${h.b} @ ${h.at.map((v) => v.toFixed(2))} (${(h.area * 1e4).toFixed(1)} cm2)`)).toEqual([])
    }, 240_000)

    it('no bare terrain cliff faces near the site: terrace edges are masonry or rock (rock-face, ashlar, rubble)', () => {
      const names = site.terrain.groups.map((g) => g.name)
      for (const n of ['ashlar-wall', 'rock-face']) expect(names).toContain(n)
      const near = worldTriangles({ ...site.terrain, instances: [] }).filter(
        (t) => t.group === 'terrain' && [t.a, t.b, t.c].every((p) => Math.abs(p[0]) < 120 && Math.abs(p[2]) < 120) && Math.abs(t.n[1]) < 0.2,
      )
      expect(near.map((t) => t.a.map((v) => v.toFixed(1)).join(','))).toEqual([])
    })

    it('outside the walls the (corrected) ground stays at least 1 m below the terrace', () => {
      expect(site.groundCorrection?.maxLowered ?? 0).toBeGreaterThan(0)
      console.log(`[dem ${tier}] ground correction ${JSON.stringify(site.groundCorrection)}`)
      const terraces = Object.values(doc.terrain.terraces).filter((t) => !t.hiddenReason)
      for (const id of ['terrace-wall-nws', 'terrace-wall-se']) {
        const w = doc.features[id]
        if (w.kind !== 'wall') throw new Error(id)
        const { left, right } = offsetPolyline(w.polyline, w.thickness.value + 1.0)
        for (const side of [left, right])
          for (let i = 0; i + 1 < side.length; i++)
            for (let u = 0.05; u < 1; u += 0.05) {
              const p: Point2 = [side[i][0] + (side[i + 1][0] - side[i][0]) * u, side[i][1] + (side[i + 1][1] - side[i][1]) * u]
              if (terraces.some((t) => pointInPolygon(t.polygon, p))) continue
              // The temple terrace is the highest neighbour of these walls.
              const cap = r.stylobate.top + doc.terrain.terraces['temple-terrace'].level.value - 1.0 + 0.05
              expect(site.ground(p[0], p[1]), `${id} @ ${p.map((v) => v.toFixed(1))}`).toBeLessThan(cap)
            }
      }
    })

    it('triangle budget', () => {
      const n = triangleCount(all)
      console.log(`[dem ${tier}] triangles total ${n}, terrain ${site.terrain.groups.reduce((a, g) => a + g.indices.length / 3, 0)}`)
      expect(n).toBeLessThan(tier === 'low' ? 300_000 : 1_500_000)
    })
  })
})
