// Ornament patterns as SVG source, one tile each. Colours come from palette.json `patterns` (sourced, with
// confidence). Tiles are drawn in a 0..W x 0..H viewBox with v = 0 at the bottom of the moulding band, so
// the generator's band UVs (u along in tiles, v 0..1 across the band) map one tile per ornament repeat.
// Pure string building: rasterised at runtime by textures.ts (no KTX2, approved by the user).

export type PatternId = 'hawksbeak' | 'palmette' | 'meander' | 'diamond'
export const PATTERN_IDS: readonly PatternId[] = ['hawksbeak', 'palmette', 'meander', 'diamond']

export interface PatternColors {
  ground: string
  primary: string
  secondary: string
  outline: string
  /** Extra fills (the archer's four-colour diamonds). */
  extra?: string[]
}

export interface PatternSvg {
  svg: string
  /** Tile width / height in the viewBox (the generator stretches it to the band). */
  aspect: number
}

const svg = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`

/**
 * Doric leaf moulding (hawksbeak / Doric cymatium): alternating tongue-shaped leaves hanging from a top
 * fillet. Furtwängler 1906 p. 47: red and blue leaves, outlines lightly incised.
 */
function hawksbeak(c: PatternColors): PatternSvg {
  const leaf = (x: number, fill: string) =>
    `<path d="M${x + 4} 18 C${x + 4} 60 ${x + 20} 100 ${x + 32} 122 C${x + 44} 100 ${x + 60} 60 ${x + 60} 18 Z" fill="${fill}" stroke="${c.outline}" stroke-width="3"/>` +
    `<path d="M${x + 32} 26 L${x + 32} 104" stroke="${c.outline}" stroke-width="2" opacity="0.5"/>`
  return {
    aspect: 1,
    svg: svg(
      128,
      128,
      `<rect width="128" height="128" fill="${c.ground}"/>` +
        `<rect width="128" height="16" fill="${c.secondary}"/>` +
        leaf(0, c.primary) +
        leaf(64, c.secondary),
    ),
  }
}

/** Sima palmette frieze: alternating palmettes on scroll stems (blue-and-red by Athenian analogy, p. 48). */
function palmette(c: PatternColors): PatternSvg {
  const fan = (cx: number, fill: string) => {
    let petals = ''
    for (let i = -3; i <= 3; i++) {
      const a = (i * 22 * Math.PI) / 180
      const tx = cx + Math.sin(a) * 46
      const ty = 92 - Math.cos(a) * 64
      petals += `<path d="M${cx} 96 Q${cx + Math.sin(a) * 30 - 7} ${96 - Math.cos(a) * 30} ${tx.toFixed(1)} ${ty.toFixed(1)} Q${cx + Math.sin(a) * 30 + 7} ${96 - Math.cos(a) * 30} ${cx} 96 Z" fill="${fill}" stroke="${c.outline}" stroke-width="1.5"/>`
    }
    return petals + `<circle cx="${cx}" cy="100" r="8" fill="${c.outline}"/>`
  }
  const scroll = (x: number) =>
    `<path d="M${x} 112 C${x + 18} 128 ${x + 46} 128 ${x + 64} 112" fill="none" stroke="${c.outline}" stroke-width="4"/>`
  return {
    aspect: 1.25,
    svg: svg(
      160,
      128,
      `<rect width="160" height="128" fill="${c.ground}"/>` +
        fan(40, c.primary) +
        fan(120, c.secondary) +
        scroll(8) +
        scroll(88) +
        `<rect y="120" width="160" height="8" fill="${c.primary}"/>`,
    ),
  }
}

/** Running meander (key pattern) between two fillets: the interior crowning band (Blouet, via p. 47). */
function meander(c: PatternColors): PatternSvg {
  const d = 'M0 104 H80 V24 H16 V88 H64 V40 H32 V72 H48 V56'
  return {
    aspect: 1,
    svg: svg(
      128,
      128,
      `<rect width="128" height="128" fill="${c.ground}"/>` +
        `<rect width="128" height="10" fill="${c.primary}"/><rect y="118" width="128" height="10" fill="${c.primary}"/>` +
        `<path d="${d} M80 104 H128" fill="none" stroke="${c.primary}" stroke-width="10" stroke-linecap="square"/>`,
    ),
  }
}

/** Four-colour diamond lattice: the west-pediment archer's shirt and leggings (Harvard Gazette 2007). */
function diamond(c: PatternColors): PatternSvg {
  const fills = [c.primary, c.secondary, ...(c.extra ?? [])]
  const cell = (cx: number, cy: number, i: number) =>
    `<path d="M${cx} ${cy - 32} L${cx + 32} ${cy} L${cx} ${cy + 32} L${cx - 32} ${cy} Z" fill="${fills[i % fills.length]}" stroke="${c.outline}" stroke-width="3"/>`
  // Diamonds on a 64-unit lattice touching at their tips; positions repeat across the tile edges.
  const lattice: [number, number, number][] = [
    [0, 0, 0], [128, 0, 0], [0, 128, 0], [128, 128, 0],
    [64, 0, 1], [64, 128, 1],
    [0, 64, 2], [128, 64, 2],
    [64, 64, 3],
  ]
  return {
    aspect: 1,
    svg: svg(128, 128, `<rect width="128" height="128" fill="${c.ground}"/>` + lattice.map(([x, y, i]) => cell(x, y, i)).join('')),
  }
}

export function patternSvg(id: PatternId, colors: PatternColors): PatternSvg {
  switch (id) {
    case 'hawksbeak':
      return hawksbeak(colors)
    case 'palmette':
      return palmette(colors)
    case 'meander':
      return meander(colors)
    case 'diamond':
      return diamond(colors)
  }
}
