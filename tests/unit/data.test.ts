import { describe, expect, it } from 'vitest'
import { validate } from '../../src/data/validate'
import dimensions from '../../src/data/dimensions.json'
import palette from '../../src/data/palette.json'
import sources from '../../src/data/sources.json'
import pediments from '../../src/data/pediments.json'
import deviations from '../../measurements/approved-deviations.json'
import confidenceSchema from '../../src/data/schemas/confidence.schema.json'

const clone = <T>(v: T): T => structuredClone(v)
const sourceIds = new Set(sources.sources.map((s) => s.id))

type Sourced = { sourceIds: string[] }
const allFigures = [pediments.west, ...pediments.eastOptions].flatMap(
  (c) => c.figures as Array<Sourced & { id: string }>,
)
const sourcedEntries: Array<[string, Sourced]> = [
  ...Object.entries(palette.colors).map(([k, v]) => [`palette.${k}`, v] as [string, Sourced]),
  ...Object.entries(sources.names).map(([k, v]) => [`names.${k}`, v] as [string, Sourced]),
  ...Object.entries(sources.choices).map(([k, v]) => [`choices.${k}`, v] as [string, Sourced]),
  ['pediments.west', pediments.west],
  ...pediments.eastOptions.map((c) => [`pediments.${c.id}`, c] as [string, Sourced]),
  ...allFigures.map((f) => [`figure.${f.id}`, f] as [string, Sourced]),
]

describe('schemas', () => {
  it.each([
    ['dimensions', dimensions],
    ['palette', palette],
    ['sources', sources],
    ['pediments', pediments],
    ['approved-deviations', deviations],
  ] as const)('%s.json passes its schema', (name, data) => {
    expect(validate(name, data)).toEqual([])
  })

  it('confidence enum is the shared four-value set', () => {
    expect(confidenceSchema.enum).toEqual(['attested', 'analogy', 'conjectural', 'interpretive'])
  })
})

describe('schemas reject bad data', () => {
  it('unverified dimension with a page number', () => {
    const d = clone(dimensions) as { dimensions: Record<string, Record<string, unknown>> }
    d.dimensions.echinusHeight.page = '12'
    expect(validate('dimensions', d)).not.toEqual([])
  })

  it('provisional dimension marked verified', () => {
    const d = clone(dimensions) as { dimensions: Record<string, Record<string, unknown>> }
    d.dimensions.echinusHeight.verified = true
    expect(validate('dimensions', d)).not.toEqual([])
  })

  it('missing primary key, unknown key, and scan value without residual', () => {
    const missing = clone(dimensions) as { dimensions: Record<string, unknown> }
    delete missing.dimensions.stylobateLength
    expect(validate('dimensions', missing)).not.toEqual([])

    const scan = clone(dimensions) as { dimensions: Record<string, Record<string, unknown>> }
    Object.assign(scan.dimensions.stylobateWidth, { source: 'scan', provisional: false })
    expect(validate('dimensions', scan)).not.toEqual([])
  })

  it('unknown confidence value and empty sourceIds', () => {
    const p = clone(palette) as { colors: Record<string, Record<string, unknown>> }
    p.colors.marble.confidence = 'certain'
    expect(validate('palette', p)).not.toEqual([])
    const q = clone(palette) as { colors: Record<string, Record<string, unknown>> }
    q.colors.marble.sourceIds = []
    expect(validate('palette', q)).not.toEqual([])
  })

  it('unverified source with a page number', () => {
    const s = clone(sources) as { sources: Array<Record<string, unknown>> }
    const unverified = s.sources.find((x) => x.verified === false)
    expect(unverified).toBeDefined()
    unverified!.page = 'p. 1'
    expect(validate('sources', s)).not.toEqual([])
  })

  it('deviation signed without a date', () => {
    const bad = [{ key: 'k', reason: 'r', scanScaled: 1, usedValue: 1, approvedBy: 'X', date: null }]
    expect(validate('approved-deviations', bad)).not.toEqual([])
    const pending = [{ key: 'k', reason: 'r', scanScaled: 1, usedValue: 1, approvedBy: null, date: null }]
    expect(validate('approved-deviations', pending)).toEqual([])
  })
})

describe('referential integrity', () => {
  it('source ids are unique', () => {
    expect(sourceIds.size).toBe(sources.sources.length)
  })

  it('every dimensions.json ref resolves in sources.json', () => {
    const bad = Object.entries(dimensions.dimensions).filter(([, e]) => !sourceIds.has(e.ref))
    expect(bad.map(([k]) => k)).toEqual([])
  })

  it('every palette entry, name, choice, pediment and figure has >=1 resolving source', () => {
    for (const [label, entry] of sourcedEntries) {
      expect(entry.sourceIds.length, label).toBeGreaterThan(0)
      for (const id of entry.sourceIds) expect(sourceIds.has(id), `${label} -> ${id}`).toBe(true)
    }
  })

  it('eastDisplayed is one of eastOptions', () => {
    expect(pediments.eastOptions.map((c) => c.id)).toContain(pediments.eastDisplayed)
  })
})

describe('verification flags', () => {
  it('every verified:false entry has no page number', () => {
    const entries: Array<[string, { verified: boolean; page?: string }]> = [
      ...Object.entries(dimensions.dimensions).map(([k, v]) => [`dimensions.${k}`, v] as [string, { verified: boolean }]),
      ...sources.sources.map((s) => [`sources.${s.id}`, s] as [string, { verified: boolean }]),
    ]
    const bad = entries.filter(([, e]) => !e.verified && 'page' in e).map(([k]) => k)
    expect(bad).toEqual([])
  })

  it('provisional dimensions are never verified', () => {
    const bad = Object.entries(dimensions.dimensions)
      .filter(([, e]) => 'provisional' in e && e.provisional && e.verified)
      .map(([k]) => k)
    expect(bad).toEqual([])
  })
})

describe('merged published values', () => {
  it('verified published dimensions cite a page and url, or explain why the page is not pinned', () => {
    const bad = Object.entries(dimensions.dimensions)
      .filter(([, e]) => e.verified && e.source === 'published')
      .filter(([, e]) => !('url' in e) || (!('page' in e) && !/page not pinned/.test(e.note ?? '')))
      .map(([k]) => k)
    expect(bad).toEqual([])
  })

  it('provisional entablature split sums to the verified entablature height', () => {
    const d = dimensions.dimensions
    const sum = d.architraveHeight.value + d.friezeHeight.value + d.corniceHeight.value
    expect(sum).toBeCloseTo(d.entablatureHeight.value, 6)
  })
})
