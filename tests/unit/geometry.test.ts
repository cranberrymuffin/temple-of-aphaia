// Generator output checks against the resolved dimensions (no magic numbers).
import { describe, expect, it } from 'vitest'
import dimensions from '../../src/data/dimensions.json'
import palette from '../../src/data/palette.json'
import { resolveDimensions } from '../../src/data/resolveDimensions'
import type { Dimensions } from '../../src/data/types'
import { arrisRadius } from '../../src/geometry/column'
import { ELEMENT_PALETTE, NO_PALETTE } from '../../src/geometry/mesh'
import { buildTemple, triangleCount } from '../../src/geometry/temple'
import { TIERS, type GeometryGroup, type Tier } from '../../src/geometry/types'

const dims = dimensions.dimensions as unknown as Dimensions
const r = resolveDimensions(dims, { eastRamp: true })
const outs = Object.fromEntries(TIERS.map((t) => [t, buildTemple(r, t, palette.colors)])) as Record<Tier, ReturnType<typeof buildTemple>>
const paletteIds = Object.keys(palette.colors)

const group = (t: Tier, name: string) => {
  const g = outs[t].groups.find((x) => x.name === name)
  if (!g) throw new Error(`group ${name} missing`)
  return g
}
const bbox = (g: GeometryGroup) => {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < g.positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], g.positions[i + k])
      max[k] = Math.max(max[k], g.positions[i + k])
    }
  return { min, max }
}
const allGroups = (t: Tier) => [...outs[t].groups, ...outs[t].instances.map((s) => s.geometry)]

describe.each(TIERS)('%s tier', (tier) => {
  const out = outs[tier]

  it('32 peristyle instances at the resolved positions within 0.5 mm', () => {
    const inst = out.instances.find((s) => s.name === 'peristyle')!
    expect(inst.matrices.length / 16).toBe(32)
    expect(new Set(inst.labels).size).toBe(32)
    r.peristyle.forEach((p, i) => {
      const m = inst.matrices.subarray(i * 16, i * 16 + 16)
      expect(Math.abs(m[12] - p.x)).toBeLessThan(5e-4)
      expect(Math.abs(m[13] - r.stylobate.top)).toBeLessThan(5e-4)
      expect(Math.abs(m[14] - p.z)).toBeLessThan(5e-4)
    })
    // 6 x 12 perimeter: 12 on each flank row, 6 on each front.
    const rows = r.peristyle.reduce<Record<number, number>>((a, p) => ((a[p.row] = (a[p.row] ?? 0) + 1), a), {})
    expect(rows[0]).toBe(12)
    expect(rows[5]).toBe(12)
    const cols = r.peristyle.reduce<Record<number, number>>((a, p) => ((a[p.col] = (a[p.col] ?? 0) + 1), a), {})
    expect(cols[0]).toBe(6)
    expect(cols[11]).toBe(6)
  })

  it('stylobate bbox matches dimensions.json within 0.5%', () => {
    const b = bbox(group(tier, 'stylobate'))
    expect(Math.abs((b.max[0] - b.min[0]) / dims.stylobateLength.value - 1)).toBeLessThan(0.005)
    expect(Math.abs((b.max[2] - b.min[2]) / dims.stylobateWidth.value - 1)).toBeLessThan(0.005)
    expect(b.max[1]).toBeCloseTo(r.stylobate.top, 5)
  })

  it('peristyle column: fluteCount flutes, entasis > 0, height to the abacus top', () => {
    const g = out.instances[0].geometry
    const shaft = g.parts!.find((p) => p.name === 'column-shaft')!
    const verts = new Set<number>()
    for (let i = shaft.start; i < shaft.start + shaft.count; i++) verts.add(g.indices[i])
    const R0 = arrisRadius(r.column, 0)
    const arrisAngles = new Set<string>()
    const byY = new Map<string, number>()
    for (const v of verts) {
      const x = g.positions[3 * v]
      const y = g.positions[3 * v + 1]
      const z = g.positions[3 * v + 2]
      const rad = Math.hypot(x, z)
      if (Math.abs(y) < 1e-6 && Math.abs(rad - R0) < 1e-5) arrisAngles.add((((Math.atan2(z, x) + 2 * Math.PI) % (2 * Math.PI)) * 1e4).toFixed(0))
      const k = y.toFixed(5)
      byY.set(k, Math.max(byY.get(k) ?? 0, rad))
    }
    expect(arrisAngles.size).toBe(dims.fluteCount.value)
    // Incised neck rings: one up-facing ledge height per groove, all below the echinus.
    const ledges = new Set<string>()
    for (const v of verts) if (g.normals[3 * v + 1] > 0.99) ledges.add(g.positions[3 * v + 1].toFixed(5))
    expect(ledges.size).toBe(r.column.neckRings.length)
    for (const y of ledges) expect(Number(y)).toBeLessThan(r.column.shaftHeight)
    // Entasis: the arris envelope bulges beyond the straight line from base to top.
    const ys = [...byY.keys()].map(Number).sort((a, b) => a - b)
    const h = ys[ys.length - 1]
    const r0 = byY.get(ys[0].toFixed(5))!
    const r1 = byY.get(h.toFixed(5))!
    const bulge = Math.max(...ys.map((y) => byY.get(y.toFixed(5))! - (r0 + ((r1 - r0) * y) / h)))
    expect(bulge).toBeGreaterThan(0)
    expect(r0).toBeCloseTo(dims.lowerDiameter.value / 2, 6)
    expect(r1).toBeCloseTo(dims.upperDiameter.value / 2, 6)
    expect(bbox(g).max[1]).toBeCloseTo(dims.columnHeight.value, 6)
  })

  it('named groups for every AC3 element', () => {
    const names = new Set(out.groups.map((g) => g.name))
    const parts = new Set(out.instances[0].geometry.parts!.map((p) => p.name))
    for (const p of ['column-shaft', 'echinus', 'abacus']) expect(parts).toContain(p)
    for (const n of [
      'crepidoma', 'stylobate', 'architrave', 'taenia', 'regulae', 'triglyphs', 'metopes', 'cornice', 'mutules',
      'tympanum', 'raking-geison', 'roof', 'roof-tiles', 'cella-walls', 'antae', 'porch-columns', 'porch-entablature',
      'threshold', 'cella-floor', 'interior-columns-lower', 'interior-epistyle', 'interior-columns-upper', 'ramp',
    ])
      expect(names, n).toContain(n)
    if (tier !== 'low') expect(names).toContain('guttae')
    expect(names).toContain('interior-step')
  })

  it('triglyphs carry two glyph grooves each (downward groove tops)', () => {
    const g = group(tier, 'triglyphs')
    const F = r.entablature.frieze
    let down = 0
    for (let i = 0; i < g.indices.length; i += 3) if (g.normals[3 * g.indices[i] + 1] < -0.99) down++
    const n = 2 * (F.front.triglyphs + F.flank.triglyphs)
    expect(down).toBe(n * 2 * 2) // 2 grooves x 2 triangles per triglyph
  })

  it('no NaN, no degenerate triangles, winding agrees with the normals', () => {
    const problems: string[] = []
    for (const g of allGroups(tier)) {
      if (!g.positions.every(Number.isFinite) || !g.normals.every(Number.isFinite)) problems.push(`${g.name}: NaN`)
      if (g.positions.length / 3 !== g.uvs.length / 2 || g.color.length !== g.positions.length) problems.push(`${g.name}: attribute sizes`)
      let degenerate = 0
      let flipped = 0
      const P = g.positions
      const N = g.normals
      for (let i = 0; i < g.indices.length; i += 3) {
        const a = g.indices[i]
        const b = g.indices[i + 1]
        const c = g.indices[i + 2]
        const e1x = P[3 * b] - P[3 * a], e1y = P[3 * b + 1] - P[3 * a + 1], e1z = P[3 * b + 2] - P[3 * a + 2]
        const e2x = P[3 * c] - P[3 * a], e2y = P[3 * c + 1] - P[3 * a + 1], e2z = P[3 * c + 2] - P[3 * a + 2]
        const nx = e1y * e2z - e1z * e2y
        const ny = e1z * e2x - e1x * e2z
        const nz = e1x * e2y - e1y * e2x
        if (Math.hypot(nx, ny, nz) / 2 <= 1e-10) degenerate++
        for (const k of [a, b, c]) if (nx * N[3 * k] + ny * N[3 * k + 1] + nz * N[3 * k + 2] <= 0) flipped++
      }
      if (degenerate) problems.push(`${g.name}: ${degenerate} degenerate triangles`)
      if (flipped) problems.push(`${g.name}: ${flipped} vertex normals opposite to the winding`)
    }
    expect(problems).toEqual([])
  })

  it('normals point outward (no inverted faces)', () => {
    // Column shafts and echini: outward from the axis.
    const g = out.instances[0].geometry
    for (const name of ['column-shaft', 'echinus']) {
      const part = g.parts!.find((p) => p.name === name)!
      for (let i = part.start; i < part.start + part.count; i++) {
        const v = g.indices[i]
        const x = g.positions[3 * v]
        const z = g.positions[3 * v + 2]
        const radial = x * g.normals[3 * v] + z * g.normals[3 * v + 2]
        const ny = g.normals[3 * v + 1]
        // The flute cover and the neck-ring ledges are horizontal; everything else faces away from the axis.
        if (!(Math.abs(ny) > 0.99)) expect(radial, name).toBeGreaterThan(0)
      }
    }
    // Box-like elements: area-weighted normals point away from the group centroid.
    for (const name of ['crepidoma', 'stylobate', 'architrave', 'taenia', 'regulae', 'triglyphs', 'cornice', 'mutules', 'cella-walls', 'antae', 'porch-entablature', 'interior-epistyle', 'threshold']) {
      const gg = group(tier, name)
      const b = bbox(gg)
      const c = [0, 1, 2].map((k) => (b.min[k] + b.max[k]) / 2)
      let s = 0
      for (let i = 0; i < gg.indices.length; i++) {
        const v = gg.indices[i]
        for (let k = 0; k < 3; k++) s += gg.normals[3 * v + k] * (gg.positions[3 * v + k] - c[k])
      }
      expect(s, name).toBeGreaterThan(0)
    }
    const allY = (name: string, pred: (ny: number) => boolean) => {
      const gg = group(tier, name)
      for (let i = 1; i < gg.normals.length; i += 3) expect(pred(gg.normals[i]), name).toBe(true)
    }
    allY('ground', (y) => y > 0.99)
    allY('ceiling', (y) => y < -0.99)
    allY('cella-floor', (y) => y > -1e-9)
    allY('roof', (y) => y > -1e-9)
    const ty = group(tier, 'tympanum')
    for (let v = 0; v < ty.positions.length / 3; v++) expect(Math.sign(ty.positions[3 * v]) * ty.normals[3 * v]).toBeGreaterThan(0.99)
  })

  it('every vertex colour traces to a palette entry (ground excepted)', () => {
    for (const g of allGroups(tier)) {
      expect(g.colorIdx).toBeDefined()
      for (const i of new Set(g.colorIdx)) {
        if (g.name === 'ground') expect(i).toBe(NO_PALETTE)
        else expect(paletteIds[i], g.name).toBeDefined()
      }
      expect(g.material).toBe(g.paletteId ? palette.colors[g.paletteId as keyof typeof palette.colors].pattern : 'plain')
    }
    for (const id of Object.values(ELEMENT_PALETTE)) if (id) expect(paletteIds).toContain(id)
  })

  it('colliders and levels: every column, wall and the threshold', () => {
    const circles = out.colliders.filter((c) => c.kind === 'circle')
    expect(circles.filter((c) => c.name.startsWith('column-'))).toHaveLength(32)
    expect(circles.filter((c) => c.name === 'porch-column')).toHaveLength(2 * dims.pronaosColumnsInAntis.value)
    expect(circles.filter((c) => c.name === 'interior-column')).toHaveLength(2 * dims.interiorColumnsPerSide.value)
    expect(out.colliders.some((c) => c.kind === 'box' && c.name === 'door-lintel' && c.y0 > r.cella.thresholdY + 1.6)).toBe(true)
    const names = out.levels.map((l) => l.name)
    for (const n of ['ground', 'step-0', 'stylobate', 'threshold', 'naos-floor', 'pronaos-floor', 'ramp']) expect(names).toContain(n)
    expect(out.levels.find((l) => l.name === 'threshold')!.y).toBeCloseTo(r.cella.thresholdY, 9)
  })

  it('triangle budget', () => {
    expect(triangleCount(out)).toBeLessThan(tier === 'low' ? 300_000 : 1_500_000)
  })
})

describe('tiers', () => {
  it('low keeps 20 flutes with fewer segments; more triangles at higher tiers', () => {
    expect(triangleCount(outs.low)).toBeLessThan(triangleCount(outs.med))
    expect(triangleCount(outs.med)).toBeLessThan(triangleCount(outs.high))
  })
  it('the ramp is omitted without the source-gated option', () => {
    const plain = buildTemple(resolveDimensions(dims), 'low', palette.colors)
    expect(plain.groups.some((g) => g.name === 'ramp')).toBe(false)
  })
  it('colorIdx can be stripped for production', () => {
    const p = buildTemple(r, 'low', palette.colors, { colorIdx: false })
    for (const g of [...p.groups, ...p.instances.map((s) => s.geometry)]) expect(g.colorIdx).toBeUndefined()
  })
})
