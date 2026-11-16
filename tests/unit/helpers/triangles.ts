// World-space triangle soup from a GeneratorOutput (instances expanded) + a coplanar-overlap finder.
import type { GeneratorOutput } from '../../../src/geometry/types'
import { transformPoint, type Vec3 } from '../../../src/geometry/mesh'

export interface Tri {
  a: Vec3
  b: Vec3
  c: Vec3
  n: Vec3
  area: number
  group: string
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

export function worldTriangles(out: GeneratorOutput): Tri[] {
  const tris: Tri[] = []
  const push = (a: Vec3, b: Vec3, c: Vec3, group: string) => {
    const cr = cross(sub(b, a), sub(c, a))
    const l = Math.hypot(...cr)
    tris.push({ a, b, c, n: l > 0 ? [cr[0] / l, cr[1] / l, cr[2] / l] : [0, 0, 0], area: l / 2, group })
  }
  for (const g of out.groups) {
    const p = g.positions
    const v = (i: number): Vec3 => [p[3 * i], p[3 * i + 1], p[3 * i + 2]]
    for (let i = 0; i < g.indices.length; i += 3) push(v(g.indices[i]), v(g.indices[i + 1]), v(g.indices[i + 2]), g.name)
  }
  for (const s of out.instances) {
    const g = s.geometry
    const p = g.positions
    for (let k = 0; k < s.matrices.length / 16; k++) {
      const m = s.matrices.subarray(k * 16, k * 16 + 16)
      const v = (i: number): Vec3 => transformPoint(m, [p[3 * i], p[3 * i + 1], p[3 * i + 2]])
      for (let i = 0; i < g.indices.length; i += 3)
        push(v(g.indices[i]), v(g.indices[i + 1]), v(g.indices[i + 2]), `${s.name}[${s.labels[k]}]`)
    }
  }
  return tris
}

/** Area of the intersection of two triangles lying (nearly) in the plane of `t` with normal n. */
function overlapArea(t: Tri, u: Tri): number {
  const n = t.n
  const ax: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const e1 = cross(n, ax)
  const l1 = Math.hypot(...e1)
  const U: Vec3 = [e1[0] / l1, e1[1] / l1, e1[2] / l1]
  const V = cross(n, U)
  const P = (p: Vec3): [number, number] => [dot(p, U), dot(p, V)]
  let clip: [number, number][] = [P(u.a), P(u.b), P(u.c)]
  let subj = [P(t.a), P(t.b), P(t.c)]
  const signed = (q: [number, number][]) => {
    let s = 0
    for (let i = 0; i < q.length; i++) {
      const [x0, y0] = q[i]
      const [x1, y1] = q[(i + 1) % q.length]
      s += x0 * y1 - x1 * y0
    }
    return s / 2
  }
  if (signed(subj) < 0) subj = subj.reverse()
  if (signed(clip) < 0) clip = clip.reverse()
  let poly = clip
  for (let i = 0; i < 3 && poly.length; i++) {
    const [ax0, ay0] = subj[i]
    const [bx0, by0] = subj[(i + 1) % 3]
    const inside = (p: [number, number]) => (bx0 - ax0) * (p[1] - ay0) - (by0 - ay0) * (p[0] - ax0) >= 0
    const inter = (p: [number, number], q: [number, number]): [number, number] => {
      const d1 = (bx0 - ax0) * (p[1] - ay0) - (by0 - ay0) * (p[0] - ax0)
      const d2 = (bx0 - ax0) * (q[1] - ay0) - (by0 - ay0) * (q[0] - ax0)
      const s = d1 / (d1 - d2)
      return [p[0] + s * (q[0] - p[0]), p[1] + s * (q[1] - p[1])]
    }
    const next: [number, number][] = []
    for (let j = 0; j < poly.length; j++) {
      const p = poly[j]
      const q = poly[(j + 1) % poly.length]
      const pi = inside(p)
      const qi = inside(q)
      if (pi) next.push(p)
      if (pi !== qi) next.push(inter(p, q))
    }
    poly = next
  }
  return poly.length >= 3 ? Math.abs(signed(poly)) : 0
}

export interface CoplanarHit {
  a: string
  b: string
  area: number
  at: Vec3
}

/**
 * Pairs with |n1.n2| > 0.9999, plane distance < 0.5 mm and overlap area > minArea (1 mm^2 absorbs
 * float noise along shared edges). Plane-and-cell hashing keeps it near linear.
 */
export function findCoplanarOverlaps(tris: Tri[], minArea = 1e-6, limit = 20): CoplanarHit[] {
  const NB = 0.03 // normal bin (covers |dn| < 0.015 with the near-side neighbour)
  const DB = 0.0012 // plane-offset bin (covers 0.5 mm)
  const CELL = 1.0
  const ref: Vec3 = [0.8017, 0.5345, 0.2673]
  const live = tris.map((t, i) => [t, i] as const).filter(([t]) => t.area > 1e-12)
  const keyOf = new Map<string, number[]>()
  const canon = (t: Tri): [Vec3, number] => {
    const s = dot(t.n, ref) < 0 ? -1 : 1
    const n: Vec3 = [t.n[0] * s, t.n[1] * s, t.n[2] * s]
    return [n, dot(n, t.a)]
  }
  const cells = (t: Tri) => {
    const lo = [0, 1, 2].map((k) => Math.floor(Math.min(t.a[k], t.b[k], t.c[k]) / CELL))
    const hi = [0, 1, 2].map((k) => Math.floor(Math.max(t.a[k], t.b[k], t.c[k]) / CELL))
    const out: string[] = []
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) out.push(`${x},${y},${z}`)
    return out
  }
  const planeKeys = (n: Vec3, d: number, all: boolean) => {
    const v = [n[0] / NB, n[1] / NB, n[2] / NB, d / DB]
    const opts = v.map((x) => {
      const f = Math.floor(x)
      if (!all) return [f]
      return x - f < 0.5 ? [f, f - 1] : [f, f + 1]
    })
    const keys: string[] = []
    for (const a of opts[0]) for (const b of opts[1]) for (const c of opts[2]) for (const e of opts[3]) keys.push(`${a},${b},${c},${e}`)
    return keys
  }
  const info = live.map(([t, i]) => ({ t, i, pc: canon(t), cells: cells(t) }))
  for (const x of info) {
    const pk = planeKeys(x.pc[0], x.pc[1], false)[0]
    for (const c of x.cells) {
      const k = `${pk}|${c}`
      let arr = keyOf.get(k)
      if (!arr) keyOf.set(k, (arr = []))
      arr.push(x.i)
    }
  }
  const hits: CoplanarHit[] = []
  for (const x of info) {
    const seen = new Set<number>()
    for (const pk of planeKeys(x.pc[0], x.pc[1], true))
      for (const c of x.cells) {
        const arr = keyOf.get(`${pk}|${c}`)
        if (!arr) continue
        for (const j of arr) {
          if (j <= x.i || seen.has(j)) continue
          seen.add(j)
          const u = tris[j]
          const t = x.t
          if (Math.abs(dot(t.n, u.n)) <= 0.9999) continue
          const dist = Math.max(...[u.a, u.b, u.c].map((p) => Math.abs(dot(t.n, sub(p, t.a)))))
          if (dist >= 0.0005) continue
          const area = overlapArea(t, u)
          if (area > minArea) {
            hits.push({ a: t.group, b: u.group, area, at: t.a })
            if (hits.length >= limit) return hits
          }
        }
      }
  }
  return hits
}

/** NaN, attribute-size, degenerate-triangle and winding-vs-normal problems per group ([] when clean). */
export function meshProblems(groups: GeneratorOutput['groups']): string[] {
  const problems: string[] = []
  for (const g of groups) {
    if (!g.positions.every(Number.isFinite) || !g.normals.every(Number.isFinite)) problems.push(`${g.name}: NaN`)
    if (g.positions.length / 3 !== g.uvs.length / 2 || g.color.length !== g.positions.length) problems.push(`${g.name}: attribute sizes`)
    let degenerate = 0
    let flipped = 0
    const P = g.positions
    const N = g.normals
    for (let i = 0; i < g.indices.length; i += 3) {
      const [a, b, c] = [g.indices[i], g.indices[i + 1], g.indices[i + 2]]
      const e1: Vec3 = [P[3 * b] - P[3 * a], P[3 * b + 1] - P[3 * a + 1], P[3 * b + 2] - P[3 * a + 2]]
      const e2: Vec3 = [P[3 * c] - P[3 * a], P[3 * c + 1] - P[3 * a + 1], P[3 * c + 2] - P[3 * a + 2]]
      const n = cross(e1, e2)
      if (Math.hypot(...n) / 2 <= 1e-10) degenerate++
      for (const k of [a, b, c]) if (n[0] * N[3 * k] + n[1] * N[3 * k + 1] + n[2] * N[3 * k + 2] <= 0) flipped++
    }
    if (degenerate) problems.push(`${g.name}: ${degenerate} degenerate triangles`)
    if (flipped) problems.push(`${g.name}: ${flipped} vertex normals opposite to the winding`)
  }
  return problems
}
