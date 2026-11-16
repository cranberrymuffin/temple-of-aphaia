// Doric constraints of resolveDimensions(). Every expectation is derived from dimensions.json or from the
// constraint itself, so the tests stay meaningful when the values are replaced.
import { describe, expect, it } from 'vitest'
import dimensions from '../../src/data/dimensions.json'
import { CONVENTIONS, ResolveError, resolveDimensions, type FriezeSide, type Resolved } from '../../src/data/resolveDimensions'
import type { Dimensions } from '../../src/data/types'

const base = dimensions.dimensions as unknown as Dimensions
const withValue = (patch: Partial<Record<keyof Dimensions, number>>): Dimensions => {
  const d = structuredClone(base)
  for (const [k, v] of Object.entries(patch)) d[k as keyof Dimensions].value = v as number
  return d
}
const r = resolveDimensions(base)
const MM = 0.001

const sides: Array<[string, FriezeSide]> = [
  ['front', r.entablature.frieze.front],
  ['flank', r.entablature.frieze.flank],
]

describe('column grid', () => {
  it('6 x 12 with the corner contraction from dimensions.json', () => {
    expect(r.grid.z).toHaveLength(6)
    expect(r.grid.x).toHaveLength(12)
    expect(r.peristyle).toHaveLength(32)
    const gx = r.grid.x
    const gz = r.grid.z
    expect(gx[1] - gx[0]).toBeCloseTo(base.interaxialFlank.value - base.cornerContractionFlank.value, 9)
    expect(gx[6] - gx[5]).toBeCloseTo(base.interaxialFlank.value, 9)
    expect(gz[1] - gz[0]).toBeCloseTo(base.interaxialFront.value - base.cornerContractionFront.value, 9)
    expect(gz[3] - gz[2]).toBeCloseTo(base.interaxialFront.value, 9)
    expect(gx[0] + gx[11]).toBeCloseTo(0, 9)
    expect(gz[0] + gz[5]).toBeCloseTo(0, 9)
  })
})

describe('frieze', () => {
  it.each(sides)('%s: closes within 1 mm (sum of triglyph + metope widths = frieze length)', (_, s) => {
    const sum = s.elements.reduce((a, e) => a + (e.end - e.start), 0)
    expect(Math.abs(sum - s.length)).toBeLessThan(MM)
    for (let i = 1; i < s.elements.length; i++) expect(Math.abs(s.elements[i].start - s.elements[i - 1].end)).toBeLessThan(1e-9)
  })

  it.each(sides)('%s: 2 triglyphs + 2 metopes per interaxial, alternating', (_, s) => {
    const bays = s.axes.length - 1
    expect(s.triglyphs).toBe(2 * bays + 1)
    expect(s.metopes).toBe(2 * bays)
    s.elements.forEach((e, i) => expect(e.kind).toBe(i % 2 === 0 ? 'triglyph' : 'metope'))
    for (const e of s.elements) expect(e.end - e.start).toBeGreaterThan(0)
  })

  it.each(sides)('%s: a triglyph centred on every non-corner column axis within 1 mm', (_, s) => {
    const tc = s.elements.filter((e) => e.kind === 'triglyph').map((e) => e.center)
    for (const a of s.axes.slice(1, -1)) expect(Math.min(...tc.map((c) => Math.abs(c - a)))).toBeLessThan(MM)
  })

  it.each(sides)('%s: corner triglyphs flush with the frieze corners; corner metopes adjusted and logged', (_, s) => {
    const first = s.elements[0]
    const last = s.elements[s.elements.length - 1]
    expect(first.kind).toBe('triglyph')
    expect(last.kind).toBe('triglyph')
    expect(Math.abs(first.start + s.length / 2)).toBeLessThan(MM)
    expect(Math.abs(last.end - s.length / 2)).toBeLessThan(MM)
    // The corner triglyph is off its axis (the corner conflict), by the face offset minus half a triglyph.
    const t = r.entablature.frieze.triglyphWidth
    expect(first.center - s.axes[0]).toBeCloseTo(-(s.length / 2 + s.axes[0]) + t / 2, 9)
    // Element 1 is the corner-bay metope; element 5 the first metope of the second (normal) bay.
    const w = (i: number) => s.elements[i].end - s.elements[i].start
    const interaxial = s.axes[2] - s.axes[1]
    expect(w(5)).toBeCloseTo(interaxial / 2 - t, 9)
    expect(w(1) - w(5)).toBeCloseTo(s.cornerMetopeDelta, 9)
    expect(r.log.some((l) => l.kind === 'frieze' && Math.abs((l.value ?? NaN) - s.cornerMetopeDelta) < 1e-12)).toBe(true)
  })

  it('frieze length equals the column-axis span plus the face offset on both ends', () => {
    const E = r.entablature
    expect(E.frieze.front.length).toBeCloseTo(2 * E.faceZ, 9)
    expect(E.frieze.flank.length).toBeCloseTo(2 * E.faceX, 9)
  })
})

describe('mutules and cornice', () => {
  it('one mutule over every triglyph and metope', () => {
    const M = r.entablature.mutules
    expect(M.front).toHaveLength(r.entablature.frieze.front.triglyphs + r.entablature.frieze.front.metopes)
    expect(M.flank).toHaveLength(r.entablature.frieze.flank.triglyphs + r.entablature.frieze.flank.metopes)
    expect(M.depthX).toBeGreaterThan(0)
    expect(M.depthZ).toBeGreaterThan(0)
  })

  it('cornice outline contains the stylobate (plus the computed overhang)', () => {
    const c = r.entablature.cornice
    expect(c.halfX).toBeGreaterThan(r.stylobate.halfX)
    expect(c.halfZ).toBeGreaterThan(r.stylobate.halfZ)
    expect(c.halfX - r.stylobate.halfX).toBeCloseTo(c.overhang, 9)
    expect(c.halfZ - r.stylobate.halfZ).toBeCloseTo(c.overhang, 9)
  })

  it('entablature heights add up to the verified entablature total', () => {
    const E = r.entablature
    expect(E.cornice.y1 - E.architrave.y0).toBeCloseTo(base.entablatureHeight.value, 6)
  })

  it('a disagreeing provisional split is scaled to the total and logged', () => {
    const rr = resolveDimensions(withValue({ friezeHeight: base.friezeHeight.value + 0.2 }))
    expect(rr.entablature.cornice.y1 - rr.entablature.architrave.y0).toBeCloseTo(base.entablatureHeight.value, 6)
    expect(rr.log.some((l) => l.kind === 'adjust' && l.message.includes('entablature'))).toBe(true)
  })

  it('pediment and roof follow the pitch and the cornice width', () => {
    const p = r.pediment
    expect((p.apexY - p.baseY) / p.halfZ).toBeCloseTo(Math.tan((base.pedimentPitch.value * Math.PI) / 180), 9)
    expect(r.roof.tileColumns * r.roof.tilePitch).toBeCloseTo(2 * r.entablature.cornice.halfX, 9)
  })
})

describe('stylobate margin (edge to outer column face)', () => {
  const margins = (x: Resolved) => x.margins
  const check = (x: Resolved) => {
    const m = margins(x)
    for (const v of Object.values(m)) expect(v).toBeGreaterThan(0)
    expect(Math.abs(m.east - m.west)).toBeLessThan(0.01)
    expect(Math.abs(m.north - m.south)).toBeLessThan(0.01)
  }

  it('is positive on all 4 sides and symmetric within 1 cm', () => check(r))

  it('is measured from the actual column positions and the stylobate edges', () => {
    const R = r.column.lowerRadius
    const xs = r.peristyle.map((p) => p.x)
    const zs = r.peristyle.map((p) => p.z)
    expect(r.margins.east).toBeCloseTo(r.stylobate.halfX - (Math.max(...xs) + R), 9)
    expect(r.margins.west).toBeCloseTo(r.stylobate.halfX + (Math.min(...xs) - R), 9)
    expect(r.margins.south).toBeCloseTo(r.stylobate.halfZ - (Math.max(...zs) + R), 9)
    expect(r.margins.north).toBeCloseTo(r.stylobate.halfZ + (Math.min(...zs) - R), 9)
    for (const side of ['east', 'west', 'north', 'south'])
      expect(r.log.some((l) => l.kind === 'margin' && l.message.includes(`margin ${side}`))).toBe(true)
  })

  it('perturbed input (lower diameter +3%) still resolves; the margin absorbs it and it is logged', () => {
    const D = base.lowerDiameter.value * 1.03
    const p = resolveDimensions(withValue({ lowerDiameter: D }))
    check(p)
    const dr = (D - base.lowerDiameter.value) / 2
    // Grid and diameter win: the columns did not move.
    expect(p.grid.x).toEqual(r.grid.x)
    expect(p.column.lowerRadius).toBeCloseTo(D / 2, 12)
    for (const side of ['east', 'south'] as const) {
      const expected = r.margins[side] - dr
      if (expected >= CONVENTIONS.minMargin) {
        expect(p.margins[side]).toBeCloseTo(expected, 9)
      } else {
        // Remainder exhausted: the stylobate grows and the adjustment is logged.
        expect(p.margins[side]).toBeCloseTo(CONVENTIONS.minMargin, 9)
        const axis = side === 'east' ? 'length' : 'width'
        expect(p.log.some((l) => l.kind === 'adjust' && l.message.includes(`stylobate ${axis}`))).toBe(true)
      }
      expect(p.log.some((l) => l.kind === 'margin' && l.message.includes(`margin ${side}`) && Math.abs((l.value ?? NaN) - p.margins[side]) < 1e-12)).toBe(true)
    }
  })

  it('a diameter that would push the columns past the stylobate edge grows the stylobate and logs it', () => {
    const D = 2 * (r.column.lowerRadius + Math.max(r.margins.east, r.margins.south) + 0.05)
    const p = resolveDimensions(withValue({ lowerDiameter: D, upperDiameter: D * 0.7 }))
    check(p)
    expect(p.stylobate.length).toBeGreaterThan(base.stylobateLength.value)
    expect(p.stylobate.width).toBeGreaterThan(base.stylobateWidth.value)
    expect(p.log.filter((l) => l.kind === 'adjust' && l.message.startsWith('stylobate'))).toHaveLength(2)
  })
})

describe('crepidoma, cella, ramp, errors', () => {
  it('lowest step matches dimensions.json and the stylobate top is the step count x rise', () => {
    const s = r.crepidoma.steps
    expect(s).toHaveLength(base.crepidomaStepCount.value)
    expect(2 * s[0].halfX).toBeCloseTo(base.lowestStepLength.value, 9)
    expect(2 * s[0].halfZ).toBeCloseTo(base.lowestStepWidth.value, 9)
    expect(2 * s[s.length - 1].halfX).toBeCloseTo(base.stylobateLength.value, 9)
    expect(r.stylobate.top).toBeCloseTo(base.crepidomaStepCount.value * base.crepidomaStepRise.value, 9)
  })

  it('cella placed by the peristasis depths, threshold and floors from dimensions.json', () => {
    const c = r.cella
    expect(c.centerX).toBeCloseTo(-(base.peristasisDepthEast.value - base.peristasisDepthWestFlank.value) / 2, 9)
    expect(2 * c.halfX).toBeCloseTo(base.cellaOuterLength.value, 9)
    expect(c.thresholdY - r.stylobate.top).toBeCloseTo(base.doorThresholdRise.value, 9)
    expect(c.floorY - r.stylobate.top).toBeCloseTo(base.pronaosStepRise.value, 9)
    expect(c.porchColumnsZ).toHaveLength(base.pronaosColumnsInAntis.value)
    expect(c.porchColumn.lowerRadius * 2).toBeCloseTo(base.pronaosLowerDiameter.value, 9)
    // Porch column tops align with the peristyle architrave soffit.
    expect(c.floorY + c.porchColumn.height).toBeCloseTo(r.entablature.architrave.y0, 9)
    expect(r.levels.find((l) => l.name === 'threshold')?.y).toBeCloseTo(c.thresholdY, 9)
  })

  it('interior colonnade: two rows, sourced spacing, centre aisle, two storeys under the ceiling', () => {
    const I = r.interior
    expect(I.xs).toHaveLength(base.interiorColumnsPerSide.value)
    expect(I.xs[1] - I.xs[0]).toBeCloseTo(base.interiorAxialSpacing.value, 9)
    expect(2 * (I.zs[1] - I.lower.lowerRadius)).toBeCloseTo(base.interiorCentreAisleWidth.value, 9)
    expect(I.upper.flutes).toBe(base.interiorUpperFluteCount.value)
    expect(I.epistyle.y1 + I.upper.height).toBeLessThan(r.ceilingY)
  })

  it('east ramp only when requested; slope from dimensions.json', () => {
    expect(r.ramp).toBeNull()
    const rr = resolveDimensions(base, { eastRamp: true })
    expect(rr.ramp).not.toBeNull()
    const rp = rr.ramp!
    expect(rp.topY / (rp.maxX - rp.minX)).toBeCloseTo(base.eastRampSlope.value, 9)
    expect(rp.minX).toBeCloseTo(rr.crepidoma.steps[0].halfX, 9)
  })

  it('rejects missing or impossible input', () => {
    const d = structuredClone(base) as Partial<Dimensions>
    delete d.columnHeight
    expect(() => resolveDimensions(d as Dimensions)).toThrow(ResolveError)
    expect(() => resolveDimensions(withValue({ upperDiameter: base.lowerDiameter.value * 1.1 }))).toThrow(ResolveError)
  })
})
