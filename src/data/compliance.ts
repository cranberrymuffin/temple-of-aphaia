// Scan compliance (plan Step 3, AC1/AC2): every key measured in scan-report.json, whatever its merge
// decision, is compared with dimensions.json at +-2% of the key's `compareTo` value. Anything outside
// needs an approved-deviations.json entry; only user-signed entries (approvedBy + date) pass. Pure.
import type { Deviation } from './types'

export const COMPLIANCE_TOLERANCE = 0.02

export interface ScanReportKey {
  raw: number
  scaled: number
  compareTo: 'raw' | 'scaled'
  decision?: 'scan' | 'published'
  label?: string
}

export interface ScanReport {
  keys: Record<string, ScanReportKey>
}

export type ComplianceState = 'pass' | 'pending signature' | 'fail'

export interface ComplianceRow {
  key: string
  used: number | null
  compare: number
  diffPct: number | null
  within: boolean
  consistentByConstruction: boolean
  deviation: 'signed' | 'unsigned' | 'missing' | 'not needed'
}

export interface ComplianceResult {
  state: ComplianceState
  rows: ComplianceRow[]
  problems: string[]
}

export function checkCompliance(
  report: ScanReport,
  dims: Record<string, { value: number }>,
  deviations: Deviation[],
): ComplianceResult {
  const rows: ComplianceRow[] = []
  const problems: string[] = []
  let pending = false
  const devFor = (key: string) => deviations.filter((d) => d.key === key)
  const status = (key: string): ComplianceRow['deviation'] => {
    const ds = devFor(key)
    if (!ds.length) return 'missing'
    return ds.some((d) => d.approvedBy && d.date) ? 'signed' : 'unsigned'
  }
  for (const [key, k] of Object.entries(report.keys)) {
    const compare = k[k.compareTo]
    const used = dims[key]?.value ?? null
    const diff = used === null ? null : used / compare - 1
    const within = diff !== null && Math.abs(diff) <= COMPLIANCE_TOLERANCE
    const row: ComplianceRow = {
      key,
      used,
      compare,
      diffPct: diff === null ? null : 100 * diff,
      within,
      consistentByConstruction: k.label === 'consistent by construction',
      deviation: 'not needed',
    }
    if (used === null) problems.push(`${key}: measured but missing from dimensions.json`)
    if (!within || k.decision === 'published') {
      row.deviation = status(key)
      if (row.deviation === 'missing')
        problems.push(
          !within
            ? `${key}: ${row.diffPct?.toFixed(2)}% from the scan (${k.compareTo}) with no approved-deviations entry`
            : `${key}: downgraded to the published value with no approved-deviations entry`,
        )
      // A downgrade inside the tolerance still needs its entry recorded, but no signature to pass.
      if (row.deviation === 'unsigned' && !within) pending = true
    }
    rows.push(row)
  }
  const state: ComplianceState = problems.length ? 'fail' : pending ? 'pending signature' : 'pass'
  return { state, rows, problems }
}
