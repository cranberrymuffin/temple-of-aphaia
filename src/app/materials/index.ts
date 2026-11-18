// Materials for build-scene.ts: one MeshStandardMaterial per ornament pattern (plain, hawksbeak,
// palmette, meander, diamond), plus terrain and sea. Plain paint comes from the per-vertex palette colour;
// patterned materials carry their own SVG-rasterised RepeatWrapping tile (colours in palette.json
// `patterns`). The low tier maps every pattern to plain (vertex colour = the palette entry's base colour).
import { MeshStandardMaterial, type Material } from 'three'
import palette from '../../data/palette.json'
import type { Tier } from '../../geometry/types'
import { PATTERN_IDS, type PatternColors, type PatternId } from './patterns'
import { createPatternTexture } from './textures'
import { createSeaMaterial, createTerrainMaterial, type TerrainSite } from './terrain'

export interface MaterialOptions {
  tier: Tier
  /** false = Step 3 unpainted look (architecture in one stone colour); terrain and sea keep their tones. */
  paint: boolean
  site: TerrainSite
  anisotropy?: number
}

export interface MaterialSet {
  /** Material for a build-scene key: a pattern id, 'plain', 'ground' (terrain) or 'sea'. */
  get(key: string): Material
  /** The material key a group key renders with (patterns collapse to 'plain' on the low tier). */
  canonical(key: string): string
  /** Resolves once every ornament tile has been drawn. */
  ready: Promise<void>
  /** Keys created so far (tests: draw-call budget). */
  keys(): string[]
}

export const TILE_PX: Record<Tier, number> = { low: 0, med: 128, high: 256 }

const isPattern = (k: string): k is PatternId => (PATTERN_IDS as readonly string[]).includes(k)

export function createMaterials(opts: MaterialOptions): MaterialSet {
  const cache = new Map<string, Material>()
  const pending: Promise<void>[] = []
  const patterns = palette.patterns as Record<string, PatternColors>

  const plain = () =>
    new MeshStandardMaterial({
      color: opts.paint ? 0xffffff : 0xe8e2d4,
      vertexColors: opts.paint,
      roughness: 0.85,
      metalness: 0,
    })

  const canonical = (key: string): string => {
    if (key === 'ground' || key === 'sea') return key
    return opts.paint && isPattern(key) && TILE_PX[opts.tier] > 0 && patterns[key] ? key : 'plain'
  }

  const make = (key: string): Material => {
    if (key === 'ground') return createTerrainMaterial(opts.site)
    if (key === 'sea') return createSeaMaterial()
    if (isPattern(key)) {
      const t = createPatternTexture(key, patterns[key]!, TILE_PX[opts.tier], opts.anisotropy)
      pending.push(t.ready)
      const m = new MeshStandardMaterial({ map: t.texture, roughness: 0.8, metalness: 0 })
      m.name = key
      return m
    }
    const m = plain()
    m.name = 'plain'
    return m
  }

  return {
    canonical,
    get(key) {
      // Every plain-painted key shares one material (one draw call per pattern, not per element).
      const k = canonical(key)
      let m = cache.get(k)
      if (!m) {
        m = make(k)
        cache.set(k, m)
      }
      return m
    },
    get ready() {
      return Promise.all(pending).then(() => undefined)
    },
    keys: () => [...cache.keys()],
  }
}
