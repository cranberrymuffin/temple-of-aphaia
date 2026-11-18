// Canonical orientation for the sculpture pipeline: rotate a scan so `up` becomes +Y and the figure's
// front faces +Z (after a turn of `facingDeg` about +Y), then rest it on y = 0, centred in x/z.
export function orientPositions(p, up, facingDeg) {
  const map = {
    '+y': (x, y, z) => [x, y, z],
    '-y': (x, y, z) => [x, -y, -z],
    '+z': (x, y, z) => [x, z, -y],
    '-z': (x, y, z) => [x, -z, y],
    '+x': (x, y, z) => [-y, x, z],
    '-x': (x, y, z) => [y, -x, z],
  }[up]
  if (!map) throw new Error(`bad up axis ${up}`)
  const a = (facingDeg * Math.PI) / 180
  const c = Math.cos(a), s = Math.sin(a)
  const out = new Float32Array(p.length)
  for (let i = 0; i < p.length; i += 3) {
    const [x, y, z] = map(p[i], p[i + 1], p[i + 2])
    out[i] = c * x + s * z
    out[i + 1] = y
    out[i + 2] = -s * x + c * z
  }
  let minY = Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i < out.length; i += 3) {
    minY = Math.min(minY, out[i + 1]); minX = Math.min(minX, out[i]); maxX = Math.max(maxX, out[i]); minZ = Math.min(minZ, out[i + 2]); maxZ = Math.max(maxZ, out[i + 2])
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2
  for (let i = 0; i < out.length; i += 3) { out[i] -= cx; out[i + 1] -= minY; out[i + 2] -= cz }
  return out
}
