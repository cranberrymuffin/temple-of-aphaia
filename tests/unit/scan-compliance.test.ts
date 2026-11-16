// AC1/AC2 gate: dimensions.json vs every key measured in scan-report.json (+-2% of compareTo), with
// user-signed approved-deviations entries for anything outside. States: pass / pending signature / fail.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import dimensions from '../../src/data/dimensions.json'
import { checkCompliance, type ScanReport } from '../../src/data/compliance'
import type { Deviation } from '../../src/data/types'

const root = resolve(__dirname, '../..')
const dims = { a: { value: 10 }, b: { value: 2 } }
const report = (a: number, b: number, extra: Partial<ScanReport['keys'][string]> = {}): ScanReport => ({
  keys: {
    a: { raw: a, scaled: a * 1.1, compareTo: 'raw', decision: 'scan', ...extra },
    b: { raw: b, scaled: b, compareTo: 'raw', decision: 'scan' },
  },
})
const dev = (key: string, signed: boolean): Deviation => ({
  key,
  reason: 'test',
  scanScaled: null,
  usedValue: null,
  approvedBy: signed ? 'User' : null,
  date: signed ? '2026-11-16' : null,
})

describe('checkCompliance', () => {
  it('pass when every measured key is within 2%', () => {
    expect(checkCompliance(report(10.15, 2.03), dims, []).state).toBe('pass')
  })
  it('uses the compareTo value (scaled when k was applied)', () => {
    const r = report(9, 2, { compareTo: 'scaled' }) // scaled = 9.9, within 2% of 10
    expect(checkCompliance(r, dims, []).state).toBe('pass')
  })
  it('fail on an unrecorded deviation', () => {
    const res = checkCompliance(report(11, 2), dims, [])
    expect(res.state).toBe('fail')
    expect(res.problems[0]).toContain('a:')
  })
  it('pending signature when every failure has an unsigned entry', () => {
    expect(checkCompliance(report(11, 2), dims, [dev('a', false)]).state).toBe('pending signature')
  })
  it('pass once the user signed the entry', () => {
    expect(checkCompliance(report(11, 2), dims, [dev('a', true)]).state).toBe('pass')
  })
  it('fail when a downgraded key has no deviation entry, even inside the tolerance', () => {
    expect(checkCompliance(report(10.1, 2, { decision: 'published' }), dims, []).state).toBe('fail')
    expect(checkCompliance(report(10.1, 2, { decision: 'published' }), dims, [dev('a', false)]).state).toBe('pass')
  })
  it('fail when a measured key is missing from dimensions.json', () => {
    expect(checkCompliance({ keys: { zz: { raw: 1, scaled: 1, compareTo: 'raw' } } }, dims, []).state).toBe('fail')
  })
  it('reports keys consistent by construction', () => {
    const res = checkCompliance(report(10, 2, { label: 'consistent by construction' }), dims, [])
    expect(res.rows.find((r) => r.key === 'a')?.consistentByConstruction).toBe(true)
  })
})

describe('repository measurement outputs', () => {
  const reportPath = resolve(root, 'measurements/scan-report.json')
  // The gate applies to committed measurement outputs (Step 2 commits the report and its deviation
  // entries together); a report still being produced in the working tree is not evaluated yet.
  const committed =
    existsSync(reportPath) &&
    (() => {
      try {
        execFileSync('git', ['ls-files', '--error-unmatch', 'measurements/scan-report.json'], { cwd: root, stdio: 'ignore' })
        return true
      } catch {
        return false
      }
    })()

  it('committed scan-report.json is compliant or pending signature', () => {
    if (!committed) {
      expect(execFileSync('git', ['ls-files', 'measurements/scan-report.json'], { cwd: root }).toString().trim()).toBe('')
      return
    }
    const rep = JSON.parse(readFileSync(reportPath, 'utf8')) as ScanReport
    const devs = JSON.parse(readFileSync(resolve(root, 'measurements/approved-deviations.json'), 'utf8')) as Deviation[]
    const res = checkCompliance(rep, dimensions.dimensions as Record<string, { value: number }>, devs)
    console.log(`[scan-compliance] ${res.state}${res.problems.length ? `\n  ${res.problems.join('\n  ')}` : ''}`)
    expect(res.problems).toEqual([])
    expect(['pass', 'pending signature']).toContain(res.state)
  })
})
