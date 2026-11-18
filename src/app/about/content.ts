// About & Sources content, generated from the data files and the Worker's TempleMeta. Pure (no DOM, no
// three) so unit tests can check that every required quote and attribution is present.
import dimensions from '../../data/dimensions.json'
import palette from '../../data/palette.json'
import pediments from '../../data/pediments.json'
import sanctuary from '../../data/sanctuary.json'
import sources from '../../data/sources.json'
import deviations from '../../../measurements/approved-deviations.json'
import scanReport from '../../../measurements/scan-report.json'
import type { TempleMeta } from '../../geometry/protocol'

export interface Item {
  text: string
  /** Secondary line: source, confidence, licence. */
  meta?: string
  url?: string
}

export type Block =
  | { kind: 'p'; text: string }
  | { kind: 'quote'; text: string; cite: string; url?: string; licence?: string }
  | { kind: 'list'; items: Item[]; collapsed?: string }

export interface Section {
  id: string
  title: string
  blocks: Block[]
}

/** Required wording whenever k is not used as the absolute scale (plan Step 2.7; Step 2 handoff). */
export const SCALE_STATEMENT = 'The scan verifies proportions; absolute size is anchored to published values.'
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors, ODbL'

type Source = (typeof sources.sources)[number] & { quote?: string; url?: string; page?: string; quotes?: string[] }
const byId = new Map<string, Source>(sources.sources.map((s) => [s.id, s as Source]))

export function source(id: string): Source {
  const s = byId.get(id)
  if (!s) throw new Error(`unknown source ${id}`)
  return s
}

const cite = (ids: string[]) => ids.map((id) => source(id).citation.split('.')[0]).join('; ')
const flag = (verified: boolean) => (verified ? 'verified' : 'unverified')

interface MeasureLike {
  value: number
  unit: string
  note?: string
  ref?: string
}

function isMeasure(v: unknown): v is MeasureLike {
  return typeof v === 'object' && v !== null && 'value' in v && 'unit' in v
}

/** Sanctuary measures whose note marks them DERIVED or CONJECTURAL. */
export function derivedSanctuaryMeasures(): Item[] {
  const out: Item[] = []
  const walk = (name: string, path: string, v: unknown) => {
    if (isMeasure(v)) {
      if (v.note && /^(DERIVED|CONJECTURAL)/.test(v.note)) out.push({ text: `${name}: ${path} ${v.value} ${v.unit}`, meta: v.note })
      return
    }
    if (Array.isArray(v)) v.forEach((x, i) => walk(name, `${path}[${i}]`, x))
    else if (typeof v === 'object' && v !== null) for (const [k, x] of Object.entries(v)) walk(name, path ? `${path}.${k}` : k, x)
  }
  for (const f of Object.values(sanctuary.features as Record<string, { name: string }>)) walk(f.name, '', f)
  return out
}

export function buildAboutContent(meta: Pick<TempleMeta, 'site' | 'log'>): Section[] {
  const moc = source('moc-odysseus-aphaia')
  const mocHist = source('moc-odysseus-aphaia-history')
  const paus = source('pausanias-2-30-3')
  const copernicus = source('copernicus-dem-glo30')
  const scale = scanReport.scale
  const dims = Object.entries(dimensions.dimensions) as [string, { value: number; unit: string; verified: boolean; provisional?: boolean; note?: string; definition: string }][]
  const features = meta.site.features

  const sections: Section[] = [
    {
      id: 'about',
      title: 'About this reconstruction',
      blocks: [
        {
          kind: 'p',
          text: `The Temple of Aphaia on Aegina and its sanctuary (${sanctuary.meta.displayLabel}). The temple is generated from published dimensions (Furtwängler et al. 1906) checked against a photogrammetric scan of the ruins; the colours follow what the 1906 excavators saw on the building, with sculpture after the Gods in Color research. Uncertain and conjectural parts are listed below.`,
        },
      ],
    },
    {
      id: 'ministry',
      title: 'Hellenic Ministry of Culture and Sports',
      blocks: [
        { kind: 'quote', text: moc.quote!, cite: moc.citation, url: moc.url, licence: moc.licence },
        { kind: 'quote', text: mocHist.quote!, cite: mocHist.citation, url: mocHist.url, licence: mocHist.licence },
      ],
    },
    {
      id: 'ancient',
      title: 'Ancient sources',
      blocks: [
        { kind: 'quote', text: paus.quote!, cite: paus.citation, url: paus.url, licence: paus.licence },
        ...(paus.quotes ?? []).map((q): Block => ({ kind: 'quote', text: q, cite: paus.citation, url: paus.url, licence: paus.licence })),
        {
          kind: 'p',
          text: 'Pausanias also tells how Britomartis, daughter of Zeus and Carme, fled from Minos into fishermen\'s nets and was made a goddess by Artemis; the Aeginetans say she shows herself on their island. Antoninus Liberalis (Metamorphoses 40) tells the same flight ending on Aegina, where she vanished into a grove and was called Aphaia (paraphrase). Pindar composed an ode for Aphaia; its text is lost.',
        },
      ],
    },
    {
      id: 'names',
      title: 'Names',
      blocks: [
        {
          kind: 'list',
          items: Object.values(sources.names).map((n) => ({
            text: n.term,
            meta: [('confidence' in n ? n.confidence : undefined), 'note' in n ? n.note : undefined, cite(n.sourceIds)].filter(Boolean).join(' · '),
          })),
        },
      ],
    },
    {
      id: 'polychrome',
      title: 'Colours',
      blocks: [
        {
          kind: 'p',
          text: 'Architectural colours come first from the excavators\' observations on Aphaia itself (Furtwängler et al. 1906, pp. 46-49): black triglyphs and mutules, red taenia and cornice soffit, white stucco corona and guttae, red and blue leaf mouldings, a strongly blue tympanum and a red pronaos floor. The painted archer of the west pediment follows the Gods in Color reconstructions (Brinkmann and Koch-Brinkmann). Hex values are rendering choices; the confidence describes the evidence for the colour.',
        },
        {
          kind: 'list',
          collapsed: `Palette (${Object.keys(palette.colors).length} entries)`,
          items: Object.entries(palette.colors).map(([id, c]) => ({
            text: `${id} ${c.color}${c.pattern !== 'plain' ? ` (${c.pattern})` : ''}`,
            meta: `${c.confidence} · ${flag(c.verified)} · ${cite(c.sourceIds)}${'note' in c && c.note ? ` · ${c.note}` : ''}`,
          })),
        },
        {
          kind: 'list',
          collapsed: 'Ornament patterns',
          items: Object.entries(palette.patterns).map(([id, p]) => ({ text: id, meta: `${p.confidence} · ${cite(p.sourceIds)} · ${p.note}` })),
        },
      ],
    },
    {
      id: 'pediments',
      title: 'Pediment figures (simplified stand-ins)',
      blocks: [
        {
          kind: 'list',
          items: [pediments.west, ...pediments.eastOptions].map((c) => ({
            text: `${c.label}${c.id === pediments.eastDisplayed ? ' (shown)' : c.id === 'west' ? ' (shown)' : ' (not shown)'}`,
            meta: `${c.confidence} · ${c.figures.length} figures · ${cite(c.sourceIds)}${c.note ? ` · ${c.note}` : ''}`,
          })),
        },
        {
          kind: 'p',
          text: 'The figures are blocky stand-ins. Their left-to-right order is inferred from Furtwängler\'s group descriptions (interpretive). The west-pediment archer is labelled "Trojan archer (identified as Paris by some)": Furtwängler rejected the name Paris, the Gods in Color curators consider it probable. Which side Herakles kneels on is unverified.',
        },
      ],
    },
    {
      id: 'choices',
      title: 'Reconstruction choices',
      blocks: [
        {
          kind: 'list',
          items: Object.values(sources.choices).map((c) => ({
            text: c.description,
            meta: `${c.confidence} · ${cite(c.sourceIds)}${'note' in c && c.note ? ` · ${c.note}` : ''}`,
          })),
        },
      ],
    },
    {
      id: 'measurement',
      title: 'Measurement provenance',
      blocks: [
        { kind: 'p', text: SCALE_STATEMENT },
        {
          kind: 'p',
          text: `A scale factor k = ${scale.k.toFixed(3)} (95% CI ${scale.ci[0].toFixed(3)}-${scale.ci[1].toFixed(3)}) was fitted on the long distances (${scale.fittedOn.join(', ')}). The scan is non-rigidly distorted, so where scan and published values disagree the published value is used, and each such deviation awaits the user's sign-off.`,
        },
        {
          kind: 'list',
          collapsed: `Deviations (${deviations.length})`,
          items: (deviations as { key: string; reason: string; usedValue: number | null; approvedBy: string | null; date: string | null }[]).map((d) => ({
            text: `${d.key}: uses ${d.usedValue ?? 'n/a'}`,
            meta: `${d.reason} · ${d.approvedBy ? `signed by ${d.approvedBy}, ${d.date}` : 'pending signature'}`,
          })),
        },
      ],
    },
    {
      id: 'sanctuary',
      title: `Sanctuary (${sanctuary.meta.displayLabel})`,
      blocks: [
        {
          kind: 'list',
          collapsed: `Shown features (${features.filter((f) => f.shown).length})`,
          items: features
            .filter((f) => f.shown)
            .map((f) => ({ text: f.name, meta: [f.phase, f.uncertain ? `uncertain: ${f.uncertain}` : '', f.note ?? ''].filter(Boolean).join(' · ') })),
        },
        {
          kind: 'list',
          collapsed: `Hidden features (${features.filter((f) => !f.shown).length})`,
          items: features.filter((f) => !f.shown).map((f) => ({ text: f.name, meta: [f.phase, f.hiddenReason ?? '', f.note ?? ''].filter(Boolean).join(' · ') })),
        },
      ],
    },
    {
      id: 'unverified',
      title: 'Unverified values',
      blocks: [
        {
          kind: 'list',
          collapsed: `Provisional dimensions (${dims.filter(([, d]) => !d.verified).length})`,
          items: dims.filter(([, d]) => !d.verified).map(([k, d]) => ({ text: `${k} = ${d.value} ${d.unit}`, meta: d.note ?? d.definition })),
        },
        {
          kind: 'list',
          collapsed: `Unverified sources (${sources.sources.filter((s) => !s.verified).length})`,
          items: sources.sources.filter((s) => !s.verified).map((s) => ({ text: s.citation, meta: 'note' in s ? s.note : undefined, url: (s as Source).url })),
        },
      ],
    },
    {
      id: 'conjectural',
      title: 'Conjectural and derived',
      blocks: [
        {
          kind: 'list',
          collapsed: `Conjectural or interpretive colours and choices (${
            Object.values(palette.colors).filter((c) => c.confidence === 'conjectural').length +
            Object.values(sources.choices).filter((c) => c.confidence === 'conjectural' || c.confidence === 'interpretive').length
          })`,
          items: [
            ...Object.entries(palette.colors)
              .filter(([, c]) => c.confidence === 'conjectural')
              .map(([id, c]) => ({ text: `Colour: ${id}`, meta: 'note' in c ? c.note : undefined })),
            ...Object.values(sources.choices)
              .filter((c) => c.confidence === 'conjectural' || c.confidence === 'interpretive')
              .map((c) => ({ text: `Choice (${c.confidence}): ${c.description}` })),
          ],
        },
        {
          kind: 'list',
          collapsed: `Derived proportions in the temple model (${meta.log.filter((l) => l.kind === 'convention').length})`,
          items: meta.log.filter((l) => l.kind === 'convention').map((l) => ({ text: l.message })),
        },
        { kind: 'list', collapsed: `Derived sanctuary measures (${derivedSanctuaryMeasures().length})`, items: derivedSanctuaryMeasures() },
      ],
    },
    {
      id: 'sources',
      title: 'Sources',
      blocks: [
        {
          kind: 'list',
          items: sources.sources.map((s) => ({
            text: s.citation,
            meta: `${s.type} · ${flag(s.verified)} · ${s.licence}`,
            url: (s as Source).url,
          })),
        },
      ],
    },
    {
      id: 'credits',
      title: 'Map, terrain and plan credits',
      blocks: [
        {
          kind: 'p',
          text: `Terrain outside the ancient terraces: ${meta.site.attribution[0] ?? copernicus.citation.slice(copernicus.citation.indexOf('produced using'))}`,
        },
        { kind: 'p', text: meta.site.attribution[1] ?? copernicus.quote! },
        { kind: 'p', text: `Temple position and orientation: OpenStreetMap way 613801136. ${OSM_ATTRIBUTION}.` },
        {
          kind: 'p',
          text: `Sanctuary plan: ${source('wikimedia-plan-aphaia-sanctuary').citation} ${source('wikimedia-plan-aphaia-sanctuary').licence}`,
        },
        {
          kind: 'p',
          text: `On-site information boards of the Ministry of Culture and Sports (Ephorate of Antiquities of Piraeus and Islands) were consulted for reference only; they are copyrighted and are not reproduced here.`,
        },
      ],
    },
  ]
  return sections
}

/** Flattened text of every section (tests and search). */
export function aboutText(sections: Section[]): string {
  const parts: string[] = []
  for (const s of sections) {
    parts.push(s.title)
    for (const b of s.blocks) {
      if (b.kind === 'p') parts.push(b.text)
      else if (b.kind === 'quote') parts.push(b.text, b.cite, b.url ?? '', b.licence ?? '')
      else {
        if (b.collapsed) parts.push(b.collapsed)
        for (const i of b.items) parts.push(i.text, i.meta ?? '', i.url ?? '')
      }
    }
  }
  return parts.join('\n')
}
