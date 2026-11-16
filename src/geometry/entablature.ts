// Peristyle entablature: architrave + taenia + regulae/guttae, triglyph-and-metope frieze, horizontal
// cornice (geison) with mutules and guttae, and the ceiling over the peristyle and cella.
// Everything comes from resolved.entablature; contact faces are omitted rather than offset.
import type { FriezeSide, Resolved } from '../data/resolveDimensions'
import type { Collector, Face, MeshBuilder, Vec3 } from './mesh'
import type { GeneratorOutput, Tier } from './types'

interface Side {
  name: 'east' | 'west' | 'south' | 'north'
  /** Along-axis is z for the fronts (east/west), x for the flanks. */
  front: boolean
  sign: 1 | -1
  back: Face
  out: Face
  alongNeg: Face
  alongPos: Face
}

const SIDES: Side[] = [
  { name: 'east', front: true, sign: 1, back: '-x', out: '+x', alongNeg: '-z', alongPos: '+z' },
  { name: 'west', front: true, sign: -1, back: '+x', out: '-x', alongNeg: '-z', alongPos: '+z' },
  { name: 'south', front: false, sign: 1, back: '-z', out: '+z', alongNeg: '-x', alongPos: '+x' },
  { name: 'north', front: false, sign: -1, back: '+z', out: '-z', alongNeg: '-x', alongPos: '+x' },
]

/** Box in side coordinates: along [a0,a1], outward offset [o0,o1] from the origin, height [y0,y1]. */
function sideBox(b: MeshBuilder, s: Side, a0: number, a1: number, o0: number, o1: number, y0: number, y1: number, omit: Face[]) {
  const lo = s.sign > 0 ? o0 : -o1
  const hi = s.sign > 0 ? o1 : -o0
  if (s.front) b.box([lo, y0, a0], [hi, y1, a1], omit)
  else b.box([a0, y0, lo], [a1, y1, hi], omit)
}

/** Vertical outward-facing quad on a side's plane at offset o. */
function sideQuad(b: MeshBuilder, s: Side, a0: number, a1: number, o: number, y0: number, y1: number) {
  const p = (a: number, y: number): Vec3 => (s.front ? [s.sign * o, y, a] : [a, y, s.sign * o])
  const dir: Vec3 = s.front ? [s.sign, 0, 0] : [0, 0, s.sign]
  b.polygonFacing([p(a0, y0), p(a1, y0), p(a1, y1), p(a0, y1)], dir)
}

/** Point in side coordinates (along a, outward offset o, height y). */
const sidePoint = (s: Side, a: number, o: number, y: number): Vec3 => (s.front ? [s.sign * o, y, a] : [a, y, s.sign * o])
const alongDir = (s: Side, sign: number): Vec3 => (s.front ? [0, 0, sign] : [sign, 0, 0])
const outDir = (s: Side): Vec3 => (s.front ? [s.sign, 0, 0] : [0, 0, s.sign])

/**
 * Triglyph front at offset o between a0 and a1: a full-width head band above yh and, below it, bars
 * separated by recessed glyph grooves (each [g0, g1] along the side, recessed by depth).
 */
function triglyphFront(b: MeshBuilder, s: Side, a0: number, a1: number, o: number, y0: number, yh: number, y1: number, grooves: [number, number][], depth: number) {
  const P = (a: number, oo: number, y: number) => sidePoint(s, a, oo, y)
  const quadOut = (u0: number, u1: number, oo: number, v0: number, v1: number) =>
    b.polygonFacing([P(u0, oo, v0), P(u1, oo, v0), P(u1, oo, v1), P(u0, oo, v1)], outDir(s))
  quadOut(a0, a1, o, yh, y1)
  let cur = a0
  for (const [g0, g1] of grooves) {
    quadOut(cur, g0, o, y0, yh)
    quadOut(g0, g1, o - depth, y0, yh)
    b.polygonFacing([P(g0, o - depth, y0), P(g0, o, y0), P(g0, o, yh), P(g0, o - depth, yh)], alongDir(s, 1))
    b.polygonFacing([P(g1, o - depth, y0), P(g1, o, y0), P(g1, o, yh), P(g1, o - depth, yh)], alongDir(s, -1))
    b.polygonFacing([P(g0, o - depth, yh), P(g1, o - depth, yh), P(g1, o, yh), P(g0, o, yh)], [0, -1, 0])
    cur = g1
  }
  quadOut(cur, a1, o, y0, yh)
}

/** Small downward-hanging guttae (frusta) below y, centred at (x, z). Top caps omitted. */
function gutta(b: MeshBuilder, x: number, z: number, y: number, r: number, h: number, sides: number) {
  const ring = (rr: number, yy: number): Vec3[] =>
    Array.from({ length: sides }, (_, i) => {
      const a = (2 * Math.PI * i) / sides
      return [x + rr * Math.cos(a), yy, z + rr * Math.sin(a)]
    })
  const top = ring(r, y)
  const bot = ring(r * 0.8, y - h)
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    const mid: Vec3 = [(top[i][0] + top[j][0]) / 2 - x, 0, (top[i][2] + top[j][2]) / 2 - z]
    b.polygonFacing([top[i], top[j], bot[j], bot[i]], mid)
  }
  b.polygonFacing(bot, [0, -1, 0])
}

const GUTTA_SIDES: Record<Tier, number> = { low: 0, med: 6, high: 8 }

/** Rectangular ring of 4 abutting boxes (fronts span the full width; flanks fit between them). */
function ring(b: MeshBuilder, ox: number, oz: number, ix: number, iz: number, y0: number, y1: number, omit: Face[], omitInner = false, omitOuter = false) {
  const f = (cond: boolean, ...faces: Face[]): Face[] => (cond ? faces : [])
  // East/west beams: their +-z ends are part of the flank outer faces near the corners.
  b.box([ix, y0, -oz], [ox, y1, oz], [...omit, ...f(omitInner, '-x'), ...f(omitOuter, '+x', '+z', '-z')])
  b.box([-ox, y0, -oz], [-ix, y1, oz], [...omit, ...f(omitInner, '+x'), ...f(omitOuter, '-x', '+z', '-z')])
  b.box([-ix, y0, iz], [ix, y1, oz], [...omit, '+x', '-x', ...f(omitInner, '-z'), ...f(omitOuter, '+z')])
  b.box([-ix, y0, -oz], [ix, y1, -iz], [...omit, '+x', '-x', ...f(omitInner, '+z'), ...f(omitOuter, '-z')])
}

export function entablature(r: Resolved, tier: Tier, col: Collector): Omit<GeneratorOutput, 'groups'> {
  const E = r.entablature
  const { faceX, faceZ, innerX, innerZ } = E
  const { y0: a0, y1: a1 } = E.architrave
  const { y0: f0, y1: f1 } = E.frieze
  const { y1: c1 } = E.cornice
  const t = E.frieze.triglyphWidth
  const tp = E.frieze.triglyphProjection
  const th = E.taenia.height
  const P = E.taenia.projection
  const guttaSides = GUTTA_SIDES[tier]

  // Architrave (top under the frieze), taenia band on its face.
  ring(col.get('architrave'), faceX, faceZ, innerX, innerZ, a0, a1, ['+y'])
  ring(col.get('taenia'), faceX + P, faceZ + P, faceX, faceZ, a1 - th, a1, [], true)
  // Frieze backing: inner faces only; the outer face is the metope panels (holes behind the triglyphs).
  ring(col.get('frieze'), faceX, faceZ, innerX, innerZ, f0, f1, ['+y', '-y'], false, true)
  // Cornice (geison).
  ring(col.get('cornice'), E.cornice.halfX, E.cornice.halfZ, innerX, innerZ, f1, c1, [])

  const triglyphs = col.get('triglyphs')
  const metopes = col.get('metopes')
  const regulae = col.get('regulae')
  const guttae = col.get('guttae')
  const mutules = col.get('mutules')
  const rh = E.regula.height
  const mt = E.mutules.thickness

  for (const s of SIDES) {
    const fs: FriezeSide = s.front ? E.frieze.front : E.frieze.flank
    const face = s.front ? faceX : faceZ
    const mutDepth = s.front ? E.mutules.depthX : E.mutules.depthZ
    const last = fs.elements.length - 1
    fs.elements.forEach((el, i) => {
      const isCorner = i === 0 || i === last
      if (el.kind === 'metope') {
        sideQuad(metopes, s, el.start, el.end, face, f0, f1)
      } else {
        // Corner triglyphs: the fronts' blocks wrap the corner; the flanks' end faces abut them.
        let a0t = el.start
        let a1t = el.end
        const omit: Face[] = [s.back, s.out, '+y', '-y']
        const omitReg: Face[] = [s.back, '+y']
        if (isCorner && s.front) {
          if (i === 0) a0t -= tp
          else a1t += tp
        }
        if (isCorner && !s.front) {
          omit.push(i === 0 ? s.alongNeg : s.alongPos)
          omitReg.push(i === 0 ? s.alongNeg : s.alongPos)
        }
        sideBox(triglyphs, s, a0t, a1t, face, face + tp, f0, f1, omit)
        const gw = E.frieze.glyphWidth
        const grooves: [number, number][] = [1, 2].map((k) => [el.start + (k * t) / 3 - gw / 2, el.start + (k * t) / 3 + gw / 2])
        triglyphFront(triglyphs, s, a0t, a1t, face + tp, f0, E.frieze.headY, f1, grooves, E.frieze.glyphDepth)
        // Regula under the taenia, below the triglyph.
        let r0 = el.start
        let r1 = el.end
        if (isCorner && s.front) {
          if (i === 0) r0 -= P
          else r1 += P
        }
        sideBox(regulae, s, r0, r1, face, face + P, a1 - th - rh, a1 - th, omitReg)
        if (guttaSides) {
          const n = E.regula.guttae
          const gr = (0.35 * t) / n
          for (let g = 0; g < n; g++) {
            const a = el.start + ((g + 0.5) * t) / n
            const o = face + P / 2
            const [x, z] = s.front ? [s.sign * o, a] : [a, s.sign * o]
            gutta(guttae, x, z, a1 - th - rh, Math.min(gr, P * 0.4), rh * 0.7, guttaSides)
          }
        }
      }
      // Mutule under the cornice soffit over every triglyph and metope.
      const m0 = el.center - E.mutules.width / 2
      const m1 = el.center + E.mutules.width / 2
      const mo0 = face + tp
      const mOmit: Face[] = ['+y']
      if (el.kind === 'triglyph') mOmit.push(s.back)
      sideBox(mutules, s, m0, m1, mo0, mo0 + mutDepth, f1 - mt, f1, mOmit)
      if (guttaSides) {
        const rows = E.mutules.guttaeRows
        const per = E.mutules.guttaePerRow
        const gr = Math.min((0.35 * E.mutules.width) / per, (0.35 * mutDepth) / rows)
        for (let q = 0; q < rows; q++)
          for (let g = 0; g < per; g++) {
            const a = m0 + ((g + 0.5) * E.mutules.width) / per
            const o = mo0 + ((q + 0.5) * mutDepth) / rows
            const [x, z] = s.front ? [s.sign * o, a] : [a, s.sign * o]
            gutta(guttae, x, z, f1 - mt, gr, mt * 0.6, guttaSides)
          }
      }
    })
  }

  // Ceiling over everything inside the entablature ring (faces down; wall and beam tops are omitted under it).
  col.get('ceiling').polygonFacing(
    [
      [-innerX, c1, -innerZ],
      [innerX, c1, -innerZ],
      [innerX, c1, innerZ],
      [-innerX, c1, innerZ],
    ],
    [0, -1, 0],
  )
  return { instances: [], colliders: [], levels: [] }
}
