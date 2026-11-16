// Type view of the data contracts in src/data/*.json (schemas in src/data/schemas/). Pure: no `three`.
import type dimensionsJson from './dimensions.json'

export type Confidence = 'attested' | 'analogy' | 'conjectural' | 'interpretive'

export type DimensionKey = keyof (typeof dimensionsJson)['dimensions']

export interface DimensionEntry {
  value: number
  unit: 'm' | 'deg' | 'count' | 'ratio'
  source: 'scan' | 'published'
  ref: string
  page?: string
  url?: string
  verified: boolean
  provisional?: boolean
  residual?: number
  residualType?: 'edge_rms' | 'flute_fit_rms' | 'slice_sigma' | 'grid_rms' | 'envelope_rms'
  uncertainty?: number
  n?: number
  definition: string
  note?: string
}

export type Dimensions = Record<DimensionKey, DimensionEntry>

export interface Deviation {
  key: string
  reason: string
  scanScaled: number | null
  usedValue: number | null
  approvedBy: string | null
  date: string | null
}
