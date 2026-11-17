// Pure 2D polygon utilities in the plan (x, z). Polygons are simple, either winding, no repeated closing point.
export type P2 = [number, number]

/** Signed area; positive = counter-clockwise in (x, z) axes (clockwise seen from above, since z points south). */
export function signedArea(p: P2[]): number {
  let s = 0
  for (let i = 0; i < p.length; i++) {
    const a = p[i]
    const b = p[(i + 1) % p.length]
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s / 2
}

export function pointInPolygon(p: P2[], q: P2): boolean {
  let inside = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i]
    const [xj, zj] = p[j]
    if (zi > q[1] !== zj > q[1] && q[0] < ((xj - xi) * (q[1] - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

export function distanceToSegment(q: P2, a: P2, b: P2): number {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const l2 = dx * dx + dz * dz
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / l2)) : 0
  return Math.hypot(q[0] - (a[0] + t * dx), q[1] - (a[1] + t * dz))
}

/** Distance from q to the polygon boundary (0 on the boundary). */
export function distanceToPolygon(p: P2[], q: P2): number {
  let d = Infinity
  for (let i = 0; i < p.length; i++) d = Math.min(d, distanceToSegment(q, p[i], p[(i + 1) % p.length]))
  return d
}

function segmentsCross(a: P2, b: P2, c: P2, d: P2): boolean {
  const o = (p: P2, q: P2, r: P2) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0
}

/** True when no two non-adjacent edges cross and the polygon has area. */
export function isSimple(p: P2[]): boolean {
  if (p.length < 3 || Math.abs(signedArea(p)) < 1e-9) return false
  const n = p.length
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue
      if (segmentsCross(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) return false
    }
  return true
}

/**
 * Offset a polyline by +-w/2 with mitred joints (left = +90 deg from the direction of travel seen from
 * above with x east and z south). Shared by wall footprints (data) and wall geometry.
 */
export function offsetPolyline(pts: P2[], w: number, closed = false): { left: P2[]; right: P2[] } {
  const n = pts.length
  const dir = (i: number): P2 => {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
  }
  const left: P2[] = []
  const right: P2[] = []
  for (let i = 0; i < n; i++) {
    const hasPrev = closed || i > 0
    const hasNext = closed || i < n - 1
    const dPrev = hasPrev ? dir((i - 1 + n) % n) : dir(i)
    const dNext = hasNext ? dir(i) : dPrev
    const n0: P2 = [dPrev[1], -dPrev[0]]
    const n1: P2 = [dNext[1], -dNext[0]]
    let mx = n0[0] + n1[0]
    let mz = n0[1] + n1[1]
    const ml = Math.hypot(mx, mz)
    mx /= ml
    mz /= ml
    const scale = w / 2 / Math.max(0.25, mx * n1[0] + mz * n1[1])
    const p = pts[i]
    left.push([p[0] + mx * scale, p[1] + mz * scale])
    right.push([p[0] - mx * scale, p[1] - mz * scale])
  }
  return { left, right }
}

/** Ear-clipping triangulation; triangles keep the counter-clockwise (x, z) orientation. */
export function triangulate(poly: P2[]): P2[][] {
  const p = signedArea(poly) < 0 ? [...poly].reverse() : [...poly]
  const idx = p.map((_, i) => i)
  const tris: P2[][] = []
  const cross = (a: P2, b: P2, c: P2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  let guard = 0
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false
    for (let k = 0; k < idx.length; k++) {
      const a = p[idx[(k - 1 + idx.length) % idx.length]]
      const b = p[idx[k]]
      const c = p[idx[(k + 1) % idx.length]]
      if (cross(a, b, c) <= 1e-12) continue // reflex or collinear
      const contains = idx.some((m) => {
        const q = p[m]
        if (q === a || q === b || q === c) return false
        return cross(a, b, q) >= 0 && cross(b, c, q) >= 0 && cross(c, a, q) >= 0
      })
      if (contains) continue
      tris.push([a, b, c])
      idx.splice(k, 1)
      clipped = true
      break
    }
    if (!clipped) {
      // Only collinear vertices left as candidates: drop one (it adds no area).
      const k = idx.findIndex((_, k) => Math.abs(cross(p[idx[(k - 1 + idx.length) % idx.length]], p[idx[k]], p[idx[(k + 1) % idx.length]])) <= 1e-12)
      if (k < 0) throw new Error('triangulate: polygon is not simple')
      idx.splice(k, 1)
    }
  }
  if (idx.length === 3) tris.push(idx.map((i) => p[i]))
  return tris
}
