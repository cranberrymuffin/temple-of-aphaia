// Geometry tier, chosen once at startup. `?tier=low|med|high` overrides; otherwise a coarse device
// heuristic. Step 6 (quality.ts) replaces the heuristic with detect-gpu.
import { TIERS, type Tier } from '../geometry/types'

export function pickTier(search = location.search): Tier {
  const q = new URLSearchParams(search).get('tier')
  if (q && (TIERS as readonly string[]).includes(q)) return q as Tier
  const cores = navigator.hardwareConcurrency ?? 4
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4
  if (cores <= 4 || mem <= 3) return 'low'
  if (cores >= 8 && mem >= 8) return 'high'
  return 'med'
}
