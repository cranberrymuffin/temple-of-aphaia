// Step 4: polychrome traceability, ornament materials, pediment stand-ins and the About & Sources content.
import { describe, expect, it } from 'vitest'
import dimensions from '../../src/data/dimensions.json'
import palette from '../../src/data/palette.json'
import pediments from '../../src/data/pediments.json'
import sanctuary from '../../src/data/sanctuary.json'
import sources from '../../src/data/sources.json'
import landscape from '../../measurements/landscape.json'
import georef from '../../measurements/georef.json'
import { resolveDimensions } from '../../src/data/resolveDimensions'
import type { SanctuaryDoc } from '../../src/data/sanctuary'
import type { Dimensions } from '../../src/data/types'
import { ELEMENT_PALETTE } from '../../src/geometry/mesh'
import { buildSite } from '../../src/geometry/sanctuary'
import { buildTemple } from '../../src/geometry/temple'
import { mergeOutputs, TIERS, type GeneratorOutput } from '../../src/geometry/types'
import { createMaterials } from '../../src/app/materials'
import { PATTERN_IDS, patternSvg, type PatternColors } from '../../src/app/materials/patterns'
import { aboutText, buildAboutContent, OSM_ATTRIBUTION, SCALE_STATEMENT, source } from '../../src/app/about/content'

const doc = sanctuary as unknown as SanctuaryDoc
const r = resolveDimensions(dimensions.dimensions as unknown as Dimensions, {
  eastRamp: true,
  rampWidth: doc.temple.rampWidth.value,
  foundationDepth: doc.temple.foundationDepth.value,
})
const colors = palette.colors as Record<string, { color: string; pattern: string }>
const build = (tier: (typeof TIERS)[number]) => {
  const temple = buildTemple(r, tier, colors)
  const site = buildSite(doc, r.stylobate.top, tier, colors, {})
  return { out: mergeOutputs([temple, site.sanctuary.output, site.terrain]) as GeneratorOutput, report: site.sanctuary.report }
}
const high = build('high')
const sourceIds = new Set(sources.sources.map((s) => s.id))
const groupsNamed = (out: GeneratorOutput, ...names: string[]) => out.groups.filter((g) => names.includes(g.name))

describe('palette traceability', () => {
  it('every element maps to an existing palette entry, and every pattern entry has tile colours', () => {
    for (const [el, id] of Object.entries(ELEMENT_PALETTE)) if (id) expect(colors[id], `${el} -> ${id}`).toBeDefined()
    const patterns = palette.patterns as Record<string, PatternColors & { sourceIds: string[] }>
    for (const [id, c] of Object.entries(colors)) {
      if (c.pattern === 'plain') continue
      expect(PATTERN_IDS, id).toContain(c.pattern)
      expect(patterns[c.pattern], `patterns.${c.pattern}`).toBeDefined()
    }
    for (const [id, p] of Object.entries(patterns)) {
      expect(PATTERN_IDS).toContain(id)
      for (const s of p.sourceIds) expect(sourceIds.has(s), `${id} -> ${s}`).toBe(true)
      expect(patternSvg(id as (typeof PATTERN_IDS)[number], p).svg).toMatch(/^<svg /)
    }
  })

  it('Aphaia-observed colours: black triglyphs and mutules, red taenia and soffit, white corona and guttae, blue tympanum', () => {
    const expectPaint = (el: string, id: string, conf: string) => {
      expect(ELEMENT_PALETTE[el]).toBe(id)
      expect((palette.colors as Record<string, { confidence: string; sourceIds: string[] }>)[id].confidence).toBe(conf)
    }
    expectPaint('triglyphs', 'triglyph-black', 'attested')
    expectPaint('mutules', 'mutule-black', 'attested')
    expectPaint('taenia', 'taenia-red', 'attested')
    expectPaint('cornice', 'corona-white', 'attested')
    expectPaint('guttae', 'guttae-white', 'attested')
    expectPaint('tympanum', 'tympanum-blue', 'attested')
    expectPaint('cella-floor', 'cella-floor-red', 'conjectural')
  })
})

describe('materials resolve for everything built', () => {
  it.each(TIERS)('%s tier: every group resolves to a known material, within the draw-call budget', (tier) => {
    const { out } = tier === 'high' ? high : build(tier)
    const mats = createMaterials({ tier, paint: true, site: { bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 } } })
    const keys = new Set<string>()
    for (const g of out.groups) {
      if (g.paletteId) expect(colors[g.paletteId], g.name).toBeDefined()
      const key = mats.canonical(g.name === 'terrain' ? 'ground' : g.name === 'sea' ? 'sea' : g.material)
      expect(['plain', 'ground', 'sea', ...PATTERN_IDS], `${g.name}: ${key}`).toContain(key)
      keys.add(key)
    }
    for (const s of out.instances) keys.add(mats.canonical(s.geometry.material))
    // Merged meshes + one InstancedMesh per instance set; terrain + sea included. Budget <= 10.
    expect(keys.size + out.instances.length).toBeLessThanOrEqual(10)
    if (tier === 'low') expect([...keys].filter((k) => (PATTERN_IDS as readonly string[]).includes(k))).toEqual([])
    else for (const p of ['hawksbeak', 'palmette', 'meander']) expect(keys, p).toContain(p)
  })

  it('ornament bands carry band UVs (v spans 0..1 across the band)', () => {
    for (const g of groupsNamed(high.out, 'cymatium', 'raking-cymatium', 'sima', 'interior-crown')) {
      let vmin = Infinity
      let vmax = -Infinity
      // Front faces are the first 4 vertices of each band; check the first one.
      for (let i = 1; i < 8; i += 2) {
        vmin = Math.min(vmin, g.uvs[i])
        vmax = Math.max(vmax, g.uvs[i])
      }
      expect([vmin, vmax], g.name).toEqual([0, 1])
    }
  })
})

describe('pediment stand-ins', () => {
  const P = r.pediment
  const figs = groupsNamed(high.out, 'pediment-figures')

  it('west 13 and the displayed later east composition 11 figures, Athena central in both, the archer present', () => {
    expect(pediments.west.figures).toHaveLength(13)
    const east = pediments.eastOptions.find((o) => o.id === pediments.eastDisplayed)!
    expect(east.id).toBe('east-later')
    expect(east.figures).toHaveLength(11)
    for (const c of [pediments.west, east]) {
      const athena = c.figures.find((f) => 'nameId' in f && f.nameId === 'athena')!
      expect(Math.abs(athena.x)).toBeLessThan(0.01)
      for (const f of c.figures) expect(f.confidence).toBe('interpretive')
    }
    expect(pediments.west.figures.some((f) => 'nameId' in f && f.nameId === 'trojan-archer')).toBe(true)
    expect(groupsNamed(high.out, 'archer-costume')).toHaveLength(0) // plain marble like the rest (user decision 2026-11-21)
  })

  it('every figure vertex sits on the cornice, in front of the tympanum and under the raking soffit', () => {
    expect(figs.length).toBe(1)
    let n = 0
    for (const g of figs)
      for (let i = 0; i < g.positions.length; i += 3) {
        const [x, y, z] = [g.positions[i], g.positions[i + 1], g.positions[i + 2]]
        expect(Math.abs(x)).toBeGreaterThan(P.tympanumX)
        expect(Math.abs(x)).toBeLessThan(r.roof.halfX)
        expect(y).toBeGreaterThanOrEqual(P.baseY - 1e-6)
        expect(y).toBeLessThanOrEqual(P.baseY + (P.apexY - P.baseY) * (1 - Math.abs(z) / P.halfZ) + 1e-6)
        n++
      }
    expect(n).toBeGreaterThan(1000)
  })

  it('both pediments are filled: figures on both gables', () => {
    const g = groupsNamed(high.out, 'pediment-figures')[0]
    let east = 0
    let west = 0
    for (let i = 0; i < g.positions.length; i += 3) {
      if (g.positions[i] > 0) east++
      else west++
    }
    expect(east).toBeGreaterThan(200)
    expect(west).toBeGreaterThan(200)
  })
})

describe('About & Sources content', () => {
  const meta = {
    site: {
      bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
      displayLabel: doc.meta.displayLabel,
      features: high.report,
      terrainMismatches: [],
      attribution: [landscape.attribution, landscape.liability],
      demLoadMs: 0,
    },
    log: r.log,
  }
  const sections = buildAboutContent(meta)
  const text = aboutText(sections)

  it('quotes the Ministry (Odysseus) and Pausanias 2.30.3 (Jones & Ormerod 1918) with citations and licences', () => {
    expect(text).toContain(source('moc-odysseus-aphaia').quote!)
    expect(text).toContain('odysseus.culture.gr')
    expect(text).toContain(source('pausanias-2-30-3').quote!)
    expect(text).toContain('Her surname among the Aeginetans is Aphaea')
    expect(text).toMatch(/Jones and H\. A\. Ormerod/)
    expect(text).toContain('Creative Commons Attribution-ShareAlike 3.0 United States License')
  })

  it('carries the required credits verbatim: Copernicus attribution and liability, OSM, Wikimedia plan, Ministry boards', () => {
    expect(text).toContain(georef.attribution)
    expect(text).toContain(landscape.liability)
    expect(text).toContain(OSM_ATTRIBUTION)
    expect(text).toContain('Bibi Saint-Pol')
    expect(text).toMatch(/Public domain/)
    expect(text).toMatch(/On-site information boards .* reference only/)
  })

  it('states the scale anchoring and lists Gods in Color and Furtwängler references', () => {
    expect(text).toContain(SCALE_STATEMENT)
    expect(text).toContain(source('gods-in-color').citation)
    expect(text).toContain(source('furtwangler-1906').citation)
    expect(text).toContain('Trojan archer (identified as Paris by some)')
  })

  it('generates the unverified, conjectural, derived and hidden lists from the data (incl. the Südbau)', () => {
    const ids = sections.map((s) => s.id)
    for (const id of ['ministry', 'ancient', 'names', 'polychrome', 'pediments', 'choices', 'measurement', 'sanctuary', 'unverified', 'conjectural', 'sources', 'credits'])
      expect(ids).toContain(id)
    const unverifiedDims = Object.entries(dimensions.dimensions).filter(([, d]) => !d.verified)
    for (const [k] of unverifiedDims) expect(text).toContain(k)
    expect(text).toMatch(/Hidden features \(\d+\)/)
    expect(text).toMatch(/Südbau/)
    expect(text).toMatch(/not depicted in the Ministry reconstruction/i)
    expect(text).toMatch(/Derived proportions in the temple model \([1-9]\d*\)/)
    expect(text).toMatch(/Derived sanctuary measures \([1-9]\d*\)/)
  })
})
