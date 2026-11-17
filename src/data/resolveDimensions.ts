// Pure resolver: primary values (dimensions.json) -> every derived value the generators need.
// No `three`. Generators consume only the Resolved output; they hold no measurements of their own.
//
// Frame: x = east-west (east, the entrance front, is +x), y = up, z = north-south (south is +z).
// Origin: stylobate centre at ground level; the krepis rests on y = 0.
import type { DimensionKey, Dimensions } from './types'

/**
 * Proportional conventions for values dimensions.json does not (yet) hold. Every entry is a ratio or a
 * count, not a measurement, and is logged when used. Candidates to promote to primary keys are marked
 * PROMOTE (the research notes give values for some of them).
 */
export const CONVENTIONS = {
  /** Spec AC1: 6 x 12 peristyle. */
  columnsFront: 6,
  columnsFlank: 12,
  /** Corner-column thickening (instance scale in x/z). 1 = none until sourced. PROMOTE */
  cornerColumnScale: 1,
  /** Entasis: max outward offset from the straight taper, as a fraction of the lower diameter. */
  entasisRatio: 0.012,
  /** Height (fraction of shaft) of the entasis maximum. */
  entasisPeak: 0.4,
  /** Neck rings incised in the shaft below the echinus (fluteCount note, p. 26: "three deep neck rings"). */
  neckRings: 3,
  /** Neck-ring groove height, pitch, top offset below the shaft top, and depth, as fractions of the lower diameter. */
  neckRingHeightRatio: 0.012,
  neckRingPitchRatio: 0.03,
  neckRingTopRatio: 0.1,
  neckRingDepthRatio: 0.01,
  /** Triglyph head band / frieze height (friezeHeight note, p. 28: band 0.11 m). Two glyph grooves below it. */
  triglyphHeadRatio: 0.125,
  /** Glyph groove width / triglyph width, and depth / triglyph projection. */
  glyphWidthRatio: 1 / 6,
  glyphDepthRatio: 0.6,
  /** Interior colonnade step: rise / pronaos step rise; width = interior lower abacus width (centred on the axes). */
  interiorStepRiseRatio: 0.5,
  /** Flute sagitta as a fraction of the flute chord. */
  fluteDepthRatio: 0.14,
  /** Echinus top radius as a fraction of the abacus half-width. */
  echinusTopRatio: 0.96,
  /** Architrave/frieze face offset from the column axis, as a fraction of the upper radius (1 = plumb with the upper shaft). */
  entablatureFaceRatio: 1,
  /** Taenia height / architrave height, and its projection / taenia height. */
  taeniaRatio: 0.1,
  taeniaProjectionRatio: 0.6,
  /** Regula height / architrave height; guttae per regula and per mutule row. */
  regulaRatio: 0.06,
  guttaePerRow: 6,
  mutuleGuttaeRows: 3,
  /** Triglyph width as a fraction of the half front interaxial (metope:triglyph = 3:2). PROMOTE (research: not read as numbers). */
  triglyphFraction: 0.4,
  /** Triglyph projection in front of the metope plane, as a fraction of the triglyph width. */
  triglyphProjectionRatio: 0.1,
  /** Cornice overhang beyond the stylobate edge, as a fraction of the cornice height. */
  corniceOverhangRatio: 0.5,
  /** Mutule thickness / cornice height; clear gap at the cornice edge / cornice projection. */
  mutuleThicknessRatio: 0.18,
  mutuleEdgeGapRatio: 0.12,
  /** Roof tiles: one cover-tile column per half triglyph+metope unit; tile length / tile pitch. */
  tilesPerFriezeUnit: 2,
  tileLengthRatio: 1.6,
  /** Cover tile width / tile pitch. */
  coverTileRatio: 0.28,
  /** Pronaos and opisthodomos inner depth as a fraction of the cella outer length. PROMOTE */
  porchDepthRatio: 0.16,
  /** Anta depth along the wall / anta face width. (antaProjection is not modelled yet: its reference face is ambiguous.) */
  antaDepthRatio: 1,
  /** Pronaos double step: tread of each of the two steps / anta depth. */
  porchStepTreadRatio: 0.5,
  /** Door clear height / cella wall height. PROMOTE (research: opening height uncertain). */
  doorHeightRatio: 0.6,
  /** Interior epistyle height / the diameter of the storey it rests on (mid epistyle: lower diameter; upper epistyle: upper diameter). */
  interiorEpistyleRatio: 0.55,
  /** Minimum stylobate-edge-to-column-face margin before the resolver grows the stylobate (m). */
  minMargin: 0.005,
  /** East ramp top: the second step from the bottom (dimensions.json eastRampSlope note, p. 25). */
  rampTopStep: 2,
} as const

export interface LogEntry {
  kind: 'convention' | 'margin' | 'adjust' | 'frieze' | 'check'
  message: string
  value?: number
}

export interface Box2 {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface ColumnSpec {
  height: number
  shaftHeight: number
  lowerRadius: number
  upperRadius: number
  /** Max outward offset of the profile from the straight taper (m). */
  entasis: number
  entasisPeak: number
  flutes: number
  fluteDepthRatio: number
  /** Incised neck-ring grooves: distance of the groove top below the shaft top, and groove height. */
  neckRings: { top: number; height: number }[]
  neckRingDepth: number
  echinusHeight: number
  echinusTopRadius: number
  abacusHeight: number
  abacusWidth: number
}

export interface PeristyleColumn {
  row: number
  col: number
  x: number
  z: number
  corner: boolean
  /** Rotation about y so the instance's local +z faces outward. */
  rotY: number
  scale: number
}

export interface FriezeElement {
  kind: 'triglyph' | 'metope'
  start: number
  end: number
  center: number
}

export interface FriezeSide {
  /** Column axis positions along the side (sorted). */
  axes: number[]
  length: number
  elements: FriezeElement[]
  triglyphs: number
  metopes: number
  /** Corner-bay metope width minus the normal metope width (positive = widened). */
  cornerMetopeDelta: number
}

export interface Resolved {
  counts: { front: number; flank: number }
  stylobate: { length: number; width: number; halfX: number; halfZ: number; top: number }
  crepidoma: { steps: { halfX: number; halfZ: number; y0: number; y1: number }[]; rise: number; tread: number }
  grid: { x: number[]; z: number[] }
  peristyle: PeristyleColumn[]
  column: ColumnSpec
  margins: { east: number; west: number; north: number; south: number }
  entablature: {
    /** Metope plane (architrave and frieze face) half extents. */
    faceX: number
    faceZ: number
    /** Inner faces of the entablature ring. */
    innerX: number
    innerZ: number
    architrave: { y0: number; y1: number }
    taenia: { height: number; projection: number }
    regula: { height: number; projection: number; guttae: number }
    frieze: {
      y0: number
      y1: number
      triglyphWidth: number
      metopeWidth: number
      triglyphProjection: number
      /** Bottom of the triglyph head band; glyph grooves run from the frieze bottom up to it. */
      headY: number
      glyphWidth: number
      glyphDepth: number
      front: FriezeSide
      flank: FriezeSide
    }
    cornice: { y0: number; y1: number; halfX: number; halfZ: number; overhang: number; projectionX: number; projectionZ: number }
    mutules: { thickness: number; depthX: number; depthZ: number; front: number[]; flank: number[]; width: number; guttaeRows: number; guttaePerRow: number }
  }
  pediment: { pitch: number; tympanumX: number; baseY: number; halfZ: number; apexY: number }
  roof: {
    halfX: number
    halfZ: number
    eaveY: number
    /** Vertical thickness of the roof slab = raking geison height. */
    thickness: number
    ridgeY: number
    tilePitch: number
    tileColumns: number
    tileRows: number
    tileLength: number
    coverTileWidth: number
  }
  ceilingY: number
  cella: {
    centerX: number
    halfX: number
    halfZ: number
    wall: number
    wallTop: number
    anta: { width: number; depth: number }
    porchDepth: number
    /** Inner faces of the east (door) and west cross walls. */
    eastWallX: [number, number]
    westWallX: [number, number]
    door: { width: number; height: number }
    /** Pronaos, opisthodomos and naos floor level (top of the pronaos double step). */
    floorY: number
    /** Top of the east door threshold sill. */
    thresholdY: number
    /** Each of the two pronaos/opisthodomos front steps. */
    porchStep: { rise: number; tread: number }
    porchColumn: ColumnSpec
    porchColumnsZ: number[]
    porchEntablature: { y0: number; y1: number }
  }
  interior: {
    lower: ColumnSpec
    upper: ColumnSpec
    xs: number[]
    zs: number[]
    floorY: number
    /** Interior steps under the colonnades (one per row, centred on zs). */
    step: { y0: number; y1: number; width: number }
    epistyle: { y0: number; y1: number; width: number }
    /** Upper epistyle on the upper columns; its top is the ceiling. */
    upperEpistyle: { y0: number; y1: number; width: number }
  }
  /** Wedge from minX (top, at the lowest step face) down to maxX; `fills` close the gap over the lower treads up to the ramp top. */
  ramp: null | { minX: number; maxX: number; halfZ: number; topY: number; fills: { minX: number; maxX: number; y0: number }[] }
  levels: { name: string; y: number; box: Box2 }[]
  log: LogEntry[]
}

export interface ResolveOptions {
  /** Build the east ramp. Pass true only when sources.json carries `choices['east-ramp']`. */
  eastRamp?: boolean
  /** Ramp width (m), e.g. from sanctuary.json temple.rampWidth; otherwise the central three intercolumniations. */
  rampWidth?: number
  /** Krepis foundation skirt below the lowest step's base (m), e.g. sanctuary.json temple.foundationDepth. */
  foundationDepth?: number
}

export class ResolveError extends Error {}

/** Accepts the dimensions.json document or its `dimensions` record. */
export function resolveDimensions(
  input: Dimensions | { dimensions: Dimensions },
  opts: ResolveOptions = {},
): Resolved {
  const dims: Dimensions = 'dimensions' in input ? (input as { dimensions: Dimensions }).dimensions : input
  const v = (k: DimensionKey): number => {
    const e = dims[k]
    if (!e || !(e.value > 0)) throw new ResolveError(`dimension ${k} missing or not positive`)
    return e.value
  }
  const C = CONVENTIONS
  const log: LogEntry[] = []
  const conv = (message: string, value?: number) => log.push({ kind: 'convention', message, value })

  const nFront = C.columnsFront
  const nFlank = C.columnsFlank

  // ---- column grid -------------------------------------------------------------------------
  const axes = (n: number, normal: number, corner: number): number[] => {
    const spans = [corner, ...Array(n - 3).fill(normal), corner]
    const total = spans.reduce((a, b) => a + b, 0)
    const out = [-total / 2]
    for (const s of spans) out.push(out[out.length - 1] + s)
    return out
  }
  const gx = axes(nFlank, v('interaxialFlank'), v('interaxialFlank') - v('cornerContractionFlank'))
  const gz = axes(nFront, v('interaxialFront'), v('interaxialFront') - v('cornerContractionFront'))

  // ---- column ------------------------------------------------------------------------------
  const Dl = v('lowerDiameter')
  const Du = v('upperDiameter')
  if (Du >= Dl) throw new ResolveError('upperDiameter must be smaller than lowerDiameter')
  const colH = v('columnHeight')
  const flutes = v('fluteCount')
  const makeColumn = (height: number, lowerD: number, nFlutes: number): ColumnSpec => {
    const k = lowerD / Dl
    const echinusHeight = v('echinusHeight') * k
    const abacusHeight = v('abacusHeight') * k
    const abacusWidth = v('abacusWidth') * k
    const shaftHeight = height - echinusHeight - abacusHeight
    if (shaftHeight <= 0) throw new ResolveError('capital taller than column')
    return {
      height,
      shaftHeight,
      lowerRadius: lowerD / 2,
      upperRadius: (Du * k) / 2,
      entasis: C.entasisRatio * lowerD,
      entasisPeak: C.entasisPeak,
      flutes: nFlutes,
      fluteDepthRatio: C.fluteDepthRatio,
      neckRings: Array.from({ length: C.neckRings }, (_, i) => ({
        top: (C.neckRingTopRatio + i * C.neckRingPitchRatio) * lowerD,
        height: C.neckRingHeightRatio * lowerD,
      })),
      neckRingDepth: C.neckRingDepthRatio * lowerD,
      echinusHeight,
      echinusTopRadius: (C.echinusTopRatio * abacusWidth) / 2,
      abacusHeight,
      abacusWidth,
    }
  }
  const column = makeColumn(colH, Dl, flutes)
  conv(`entasis = ${C.entasisRatio} x lowerDiameter`, column.entasis)

  // ---- stylobate and margins (grid and diameter win; the margin absorbs the remainder) ------
  const cornerR = column.lowerRadius * C.cornerColumnScale
  let halfX = v('stylobateLength') / 2
  let halfZ = v('stylobateWidth') / 2
  const fixMargin = (axisName: 'length' | 'width', half: number, axis: number[]): number => {
    const m = Math.min(half - (axis[axis.length - 1] + cornerR), half + (axis[0] - cornerR))
    if (m >= C.minMargin) return half
    const grown = half + (C.minMargin - m)
    log.push({
      kind: 'adjust',
      message: `stylobate ${axisName} grown from ${(2 * half).toFixed(4)} to ${(2 * grown).toFixed(4)} m so the edge-to-column-face margin stays >= ${C.minMargin} m (grid and diameter take precedence)`,
      value: 2 * (grown - half),
    })
    return grown
  }
  halfX = fixMargin('length', halfX, gx)
  halfZ = fixMargin('width', halfZ, gz)
  const margins = {
    east: halfX - (gx[gx.length - 1] + cornerR),
    west: gx[0] - cornerR + halfX,
    south: halfZ - (gz[gz.length - 1] + cornerR),
    north: gz[0] - cornerR + halfZ,
  }
  for (const [side, m] of Object.entries(margins))
    log.push({ kind: 'margin', message: `margin ${side} (stylobate edge to corner-column face) = ${m.toFixed(4)} m (absorbs the remainder)`, value: m })
  if (Math.abs(margins.east - margins.west) > 0.01 || Math.abs(margins.north - margins.south) > 0.01)
    throw new ResolveError('margins not symmetric within 1 cm')

  // ---- crepidoma ---------------------------------------------------------------------------
  const nSteps = v('crepidomaStepCount')
  const rise = v('crepidomaStepRise')
  // Treads from the lowest-step and stylobate sizes (kept if the margin check grows the stylobate).
  const treadX = (v('lowestStepLength') - v('stylobateLength')) / 2 / Math.max(1, nSteps - 1)
  const treadZ = (v('lowestStepWidth') - v('stylobateWidth')) / 2 / Math.max(1, nSteps - 1)
  if (!(treadX > 0 && treadZ > 0)) throw new ResolveError('lowest step must be larger than the stylobate')
  log.push({ kind: 'check', message: `crepidoma treads ${treadX.toFixed(4)} m (E-W), ${treadZ.toFixed(4)} m (N-S)` })
  const tread = (treadX + treadZ) / 2
  const foundation = opts.foundationDepth ?? 0
  if (foundation > 0) log.push({ kind: 'check', message: `krepis foundation skirt ${foundation} m below the lowest step`, value: foundation })
  const steps = Array.from({ length: nSteps }, (_, k) => ({
    halfX: halfX + (nSteps - 1 - k) * treadX,
    halfZ: halfZ + (nSteps - 1 - k) * treadZ,
    y0: k === 0 ? -foundation : k * rise,
    y1: (k + 1) * rise,
  }))
  const S = nSteps * rise

  const peristyle: PeristyleColumn[] = []
  for (let row = 0; row < nFront; row++)
    for (let col = 0; col < nFlank; col++) {
      const edgeRow = row === 0 || row === nFront - 1
      const edgeCol = col === 0 || col === nFlank - 1
      if (!edgeRow && !edgeCol) continue
      const corner = edgeRow && edgeCol
      // Outward direction: flank rows face +-z, front columns face +-x.
      const rotY = edgeRow ? (row === 0 ? Math.PI : 0) : col === 0 ? -Math.PI / 2 : Math.PI / 2
      peristyle.push({ row, col, x: gx[col], z: gz[row], corner, rotY, scale: corner ? C.cornerColumnScale : 1 })
    }

  // ---- entablature ---------------------------------------------------------------------------
  const e = C.entablatureFaceRatio * column.upperRadius
  const faceX = gx[gx.length - 1] + e
  const faceZ = gz[gz.length - 1] + e
  const innerX = gx[gx.length - 1] - column.abacusWidth / 2
  const innerZ = gz[gz.length - 1] - column.abacusWidth / 2
  // The total is verified; a provisional split that disagrees is scaled to it.
  let ha = v('architraveHeight')
  let hf = v('friezeHeight')
  let hc = v('corniceHeight')
  const entTotal = v('entablatureHeight')
  if (Math.abs(ha + hf + hc - entTotal) > 0.001) {
    const k = entTotal / (ha + hf + hc)
    log.push({ kind: 'adjust', message: `architrave/frieze/cornice scaled by ${k.toFixed(4)} to the entablature total ${entTotal} m`, value: k })
    ha *= k
    hf *= k
    hc *= k
  }
  const a0 = S + colH
  const a1 = a0 + ha
  const f1 = a1 + hf
  const c1 = f1 + hc
  const taeniaH = C.taeniaRatio * ha
  const taeniaP = C.taeniaProjectionRatio * taeniaH

  const t = (C.triglyphFraction * v('interaxialFront')) / 2
  const m = v('interaxialFront') / 2 - t
  const tp = Math.min(C.triglyphProjectionRatio * t, taeniaP)
  conv(`triglyph width = ${C.triglyphFraction} x half front interaxial`, t)
  const friezeSide = (axis: number[], name: string): FriezeSide => {
    const n = axis.length
    const L = axis[n - 1] - axis[0] + 2 * e
    const lo = axis[0] - e
    const hi = axis[n - 1] + e
    // Triglyph centres: flush at the corners, on the axis elsewhere.
    const tc = axis.map((a, i) => (i === 0 ? lo + t / 2 : i === n - 1 ? hi - t / 2 : a))
    const els: FriezeElement[] = []
    const push = (kind: FriezeElement['kind'], s: number, w: number) =>
      els.push({ kind, start: s, end: s + w, center: s + w / 2 })
    push('triglyph', tc[0] - t / 2, t)
    let normalM = m
    let cornerM = m
    for (let i = 0; i < n - 1; i++) {
      const span = tc[i + 1] - tc[i]
      const mi = (span - 2 * t) / 2
      if (mi <= 0) throw new ResolveError(`${name} frieze: metope width ${mi} <= 0`)
      if (i === 0) cornerM = mi
      else if (i < n - 2) normalM = mi
      const s0 = tc[i] + t / 2
      push('metope', s0, mi)
      push('triglyph', s0 + mi, t)
      push('metope', s0 + mi + t, mi)
      push('triglyph', tc[i + 1] - t / 2, t)
    }
    const delta = cornerM - normalM
    log.push({
      kind: 'frieze',
      message: `${name} frieze: corner metopes ${delta >= 0 ? 'widened' : 'narrowed'} by ${Math.abs(delta).toFixed(4)} m (corner contraction resolves the corner triglyph)`,
      value: delta,
    })
    return {
      axes: axis,
      length: L,
      elements: els,
      triglyphs: els.filter((x) => x.kind === 'triglyph').length,
      metopes: els.filter((x) => x.kind === 'metope').length,
      cornerMetopeDelta: delta,
    }
  }
  const front = friezeSide(gz, 'front')
  const flank = friezeSide(gx, 'flank')

  const overhang = C.corniceOverhangRatio * hc
  const corHalfX = halfX + overhang
  const corHalfZ = halfZ + overhang
  conv(`cornice overhang beyond stylobate = ${C.corniceOverhangRatio} x corniceHeight`, overhang)
  // Abacus tops are omitted under the architrave; the cornice must overhang their projecting edges so
  // the omitted strips can never be seen from above.
  const abacusOuterX = gx[gx.length - 1] + (column.abacusWidth / 2) * C.cornerColumnScale
  const abacusOuterZ = gz[gz.length - 1] + (column.abacusWidth / 2) * C.cornerColumnScale
  if (corHalfX <= abacusOuterX || corHalfZ <= abacusOuterZ) throw new ResolveError('cornice does not overhang the abacus edges')
  const projX = corHalfX - faceX
  const projZ = corHalfZ - faceZ
  const mutuleT = C.mutuleThicknessRatio * hc
  const mutDepthX = projX - tp - C.mutuleEdgeGapRatio * projX
  const mutDepthZ = projZ - tp - C.mutuleEdgeGapRatio * projZ
  if (mutDepthX <= 0 || mutDepthZ <= 0) throw new ResolveError('cornice projection too small for mutules')

  // ---- pediment and roof -------------------------------------------------------------------
  const pitch = (v('pedimentPitch') * Math.PI) / 180
  const roofThickness = hc / Math.cos(pitch)
  const ridgeY = c1 + roofThickness + corHalfZ * Math.tan(pitch)
  const pitchTarget = (t + m) / C.tilesPerFriezeUnit
  const tileColumns = Math.max(2, Math.round((2 * corHalfX) / pitchTarget))
  const tilePitch = (2 * corHalfX) / tileColumns
  const slopeLen = corHalfZ / Math.cos(pitch)
  const tileRows = Math.max(1, Math.round(slopeLen / (C.tileLengthRatio * tilePitch)))
  conv(`roof tile grid ${tileColumns} x ${tileRows} per slope from cornice length`, tilePitch)

  // ---- cella ---------------------------------------------------------------------------------
  const cHalfX = v('cellaOuterLength') / 2
  const cHalfZ = v('cellaOuterWidth') / 2
  const wall = v('cellaWallThickness')
  // East/west placement from the two peristasis depths (measured from the stylobate slabs' inner edges,
  // so only their difference positions the cella; the implied slab widths are logged as a check).
  const pE = v('peristasisDepthEast')
  const pW = v('peristasisDepthWestFlank')
  const cx = -(pE - pW) / 2
  log.push({
    kind: 'check',
    message: `cella centre x = ${cx.toFixed(4)} m; implied stylobate slab width ${((v('stylobateLength') - 2 * cHalfX - pE - pW) / 2).toFixed(3)} m (E-W), ${((v('stylobateWidth') - 2 * cHalfZ - 2 * pW) / 2).toFixed(3)} m (N-S)`,
    value: cx,
  })
  if (cHalfZ >= gz[gz.length - 1] - column.lowerRadius || Math.abs(cx) + cHalfX >= gx[gx.length - 1] - column.lowerRadius)
    throw new ResolveError('cella does not fit inside the peristyle')
  // Antae are modelled as wall-thick piers at the wall ends (face width = wall thickness); antaWidth sets their depth.
  const antaW = wall
  const antaD = C.antaDepthRatio * v('antaWidth')
  conv('anta face width = cella wall thickness; anta depth = antaWidth (antaProjection not modelled)', antaD)
  const porchDepth = C.porchDepthRatio * v('cellaOuterLength')
  const eastWallX: [number, number] = [cx + cHalfX - porchDepth - wall, cx + cHalfX - porchDepth]
  const westWallX: [number, number] = [cx - cHalfX + porchDepth, cx - cHalfX + porchDepth + wall]
  const wallTop = c1
  const doorW = v('doorWidth')
  if (doorW >= 2 * (cHalfZ - wall)) throw new ResolveError('door wider than the cella')
  const door = { width: doorW, height: C.doorHeightRatio * (wallTop - S) }
  const porchRise = v('pronaosStepRise')
  const floorY = S + porchRise
  const thresholdY = S + v('doorThresholdRise')
  conv('naos floor at the pronaos floor level (pronaos double step); threshold sill above it', floorY)
  const porchColumn = makeColumn(colH - porchRise, v('pronaosLowerDiameter'), flutes)
  // The porch abacus must sit fully under the porch entablature beam (beam depth = anta depth).
  if (porchColumn.abacusWidth > antaD) {
    porchColumn.abacusWidth = antaD
    porchColumn.echinusTopRadius = Math.min(porchColumn.echinusTopRadius, (C.echinusTopRatio * antaD) / 2)
    conv('porch abacus width clipped to the anta depth', antaD)
  }
  const antaInner = cHalfZ - antaW
  const nPorch = v('pronaosColumnsInAntis')
  const porchColumnsZ = Array.from({ length: nPorch }, (_, k) => -antaInner + ((k + 1) * 2 * antaInner) / (nPorch + 1))
  conv(`porch depth = ${C.porchDepthRatio} x cellaOuterLength`, porchDepth)

  // ---- interior two-tier colonnade ----------------------------------------------------------
  const nInt = v('interiorColumnsPerSide')
  // The lower columns stand on the interior step; their height is still cella floor to abacus top.
  const intStepRise = C.interiorStepRiseRatio * v('pronaosStepRise')
  const lowerInt = makeColumn(v('interiorLowerColumnHeight') - intStepRise, v('interiorLowerDiameter'), flutes)
  // Upper storey: height derived below so its epistyle meets the ceiling (interiorUpperColumnHeight is only a cross-check).
  const naosMid = (eastWallX[0] + westWallX[1]) / 2
  const spacing = v('interiorAxialSpacing')
  const xs = Array.from({ length: nInt }, (_, i) => naosMid + (i - (nInt - 1) / 2) * spacing)
  if (xs[nInt - 1] + lowerInt.abacusWidth / 2 >= eastWallX[0] || xs[0] - lowerInt.abacusWidth / 2 <= westWallX[1])
    throw new ResolveError('interior colonnade longer than the naos')
  const innerHalfW = cHalfZ - wall
  // Column axes centred on the interior steps, whose inner edges bound the centre aisle.
  const zRow = v('interiorCentreAisleWidth') / 2 + lowerInt.abacusWidth / 2
  conv(`interior step width = lower abacus width, rise = ${C.interiorStepRiseRatio} x pronaosStepRise`, intStepRise)
  if (zRow + lowerInt.abacusWidth / 2 >= innerHalfW) throw new ResolveError('interior colonnade hits the cella wall')
  const epH = C.interiorEpistyleRatio * v('interiorLowerDiameter')
  // Lower storey: columns stand on the step and carry the mid epistyle directly (no gap).
  const ep0 = floorY + intStepRise + lowerInt.height
  const upEpH = C.interiorEpistyleRatio * v('interiorUpperDiameter')
  conv(`interior upper epistyle = ${C.interiorEpistyleRatio} x interiorUpperDiameter, top at the ceiling`, upEpH)
  const upperH = c1 - upEpH - (ep0 + epH)
  if (upperH <= 0) throw new ResolveError('no room for the upper interior storey under the ceiling')
  const upperInt = makeColumn(upperH, v('interiorUpperDiameter'), v('interiorUpperFluteCount'))
  log.push({
    kind: 'check',
    message: `interior upper column height derived ${upperH.toFixed(3)} m (H/D ${(upperH / v('interiorUpperDiameter')).toFixed(2)}); dimensions.json interiorUpperColumnHeight ${v('interiorUpperColumnHeight')} m differs by ${(upperH - v('interiorUpperColumnHeight')).toFixed(3)} m (superseded)`,
    value: upperH,
  })
  if (zRow - lowerInt.abacusWidth / 2 <= 0) throw new ResolveError('interior colonnades overlap')

  // ---- east ramp (source-gated) ---------------------------------------------------------------
  let ramp: Resolved['ramp'] = null
  if (opts.eastRamp && dims.eastRampSlope) {
    const topStep = Math.min(C.rampTopStep, nSteps) - 1
    const topY = steps[topStep].y1
    const base = steps[0]
    ramp = {
      minX: base.halfX,
      maxX: base.halfX + topY / v('eastRampSlope'),
      halfZ: opts.rampWidth !== undefined ? opts.rampWidth / 2 : gz[nFront - 2],
      topY,
      fills: steps.slice(0, topStep).map((st, i) => ({ minX: steps[i + 1].halfX, maxX: st.halfX, y0: st.y1 })),
    }
    conv('east ramp built (sources.json choices.east-ramp)', topY)
  }

  const levels: Resolved['levels'] = [
    ...steps.map((s, i) => ({
      name: i === nSteps - 1 ? 'stylobate' : `step-${i}`,
      y: s.y1,
      box: { minX: -s.halfX, maxX: s.halfX, minZ: -s.halfZ, maxZ: s.halfZ },
    })),
    {
      name: 'pronaos-floor',
      y: floorY,
      box: { minX: eastWallX[1], maxX: cx + cHalfX, minZ: -innerHalfW, maxZ: innerHalfW },
    },
    {
      name: 'opisthodomos-floor',
      y: floorY,
      box: { minX: cx - cHalfX, maxX: westWallX[0], minZ: -innerHalfW, maxZ: innerHalfW },
    },
    {
      name: 'threshold',
      y: thresholdY,
      box: { minX: eastWallX[0], maxX: eastWallX[1], minZ: -doorW / 2, maxZ: doorW / 2 },
    },
    ...[-zRow, zRow].map((z, i) => ({
      name: `interior-step-${i === 0 ? 'n' : 's'}`,
      y: floorY + intStepRise,
      box: { minX: westWallX[1], maxX: eastWallX[0], minZ: z - lowerInt.abacusWidth / 2, maxZ: z + lowerInt.abacusWidth / 2 },
    })),
    {
      name: 'naos-floor',
      y: floorY,
      box: { minX: westWallX[1], maxX: eastWallX[0], minZ: -innerHalfW, maxZ: innerHalfW },
    },
  ]

  log.push({ kind: 'check', message: `entablature top ${c1.toFixed(3)} m, ridge ${ridgeY.toFixed(3)} m` })

  return {
    counts: { front: nFront, flank: nFlank },
    stylobate: { length: 2 * halfX, width: 2 * halfZ, halfX, halfZ, top: S },
    crepidoma: { steps, rise, tread },
    grid: { x: gx, z: gz },
    peristyle,
    column,
    margins,
    entablature: {
      faceX,
      faceZ,
      innerX,
      innerZ,
      architrave: { y0: a0, y1: a1 },
      taenia: { height: taeniaH, projection: taeniaP },
      regula: { height: C.regulaRatio * ha, projection: taeniaP, guttae: C.guttaePerRow },
      frieze: {
        y0: a1,
        y1: f1,
        triglyphWidth: t,
        metopeWidth: m,
        triglyphProjection: tp,
        headY: f1 - C.triglyphHeadRatio * hf,
        glyphWidth: C.glyphWidthRatio * t,
        glyphDepth: C.glyphDepthRatio * tp,
        front,
        flank,
      },
      cornice: { y0: f1, y1: c1, halfX: corHalfX, halfZ: corHalfZ, overhang, projectionX: projX, projectionZ: projZ },
      mutules: {
        thickness: mutuleT,
        depthX: mutDepthX,
        depthZ: mutDepthZ,
        front: front.elements.map((x) => x.center),
        flank: flank.elements.map((x) => x.center),
        width: t,
        guttaeRows: C.mutuleGuttaeRows,
        guttaePerRow: C.guttaePerRow,
      },
    },
    pediment: { pitch, tympanumX: faceX, baseY: c1, halfZ: corHalfZ, apexY: c1 + corHalfZ * Math.tan(pitch) },
    roof: {
      halfX: corHalfX,
      halfZ: corHalfZ,
      eaveY: c1,
      thickness: roofThickness,
      ridgeY,
      tilePitch,
      tileColumns,
      tileRows,
      tileLength: slopeLen / tileRows,
      coverTileWidth: C.coverTileRatio * tilePitch,
    },
    ceilingY: c1,
    cella: {
      centerX: cx,
      halfX: cHalfX,
      halfZ: cHalfZ,
      wall,
      wallTop,
      anta: { width: antaW, depth: antaD },
      porchDepth,
      eastWallX,
      westWallX,
      door,
      floorY,
      thresholdY,
      porchStep: { rise: porchRise / 2, tread: C.porchStepTreadRatio * antaD },
      porchColumn,
      porchColumnsZ,
      porchEntablature: { y0: a0, y1: c1 },
    },
    interior: {
      lower: lowerInt,
      upper: upperInt,
      xs,
      zs: [-zRow, zRow],
      floorY,
      step: { y0: floorY, y1: floorY + intStepRise, width: lowerInt.abacusWidth },
      epistyle: { y0: ep0, y1: ep0 + epH, width: lowerInt.abacusWidth },
      upperEpistyle: { y0: c1 - upEpH, y1: c1, width: upperInt.abacusWidth },
    },
    ramp,
    levels,
    log,
  }
}
