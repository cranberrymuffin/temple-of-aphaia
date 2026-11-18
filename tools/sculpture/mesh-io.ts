// Mesh I/O for the sculpture pipeline: binary/ASCII STL reader with vertex welding, normals, a minimal GLB
// writer (positions, normals, indices) and a depth-shaded preview PNG renderer. Node only, no deps.
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

/** Reads an STL file into welded { positions: Float32Array, indices: Uint32Array }. `weld` in file units. */
export function readStl(path, weld = 1e-4) {
  const buf = readFileSync(path)
  const isAscii = buf.subarray(0, 5).toString() === 'solid' && buf.indexOf('facet', 0, 'latin1') !== -1 && buf.length !== 84 + buf.readUInt32LE(80) * 50
  const raw = []
  if (isAscii) {
    const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g
    const s = buf.toString('latin1')
    let m
    while ((m = re.exec(s))) raw.push(+m[1], +m[2], +m[3])
  } else {
    const n = buf.readUInt32LE(80)
    for (let i = 0; i < n; i++) {
      const o = 84 + i * 50 + 12
      for (let k = 0; k < 9; k++) raw.push(buf.readFloatLE(o + k * 4))
    }
  }
  const map = new Map()
  const pos = []
  const idx = new Uint32Array(raw.length / 3)
  const inv = 1 / weld
  for (let i = 0; i < raw.length / 3; i++) {
    const x = raw[i * 3], y = raw[i * 3 + 1], z = raw[i * 3 + 2]
    const key = `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`
    let v = map.get(key)
    if (v === undefined) {
      v = pos.length / 3
      map.set(key, v)
      pos.push(x, y, z)
    }
    idx[i] = v
  }
  // Drop degenerate triangles.
  const keep = []
  for (let t = 0; t < idx.length; t += 3) if (idx[t] !== idx[t + 1] && idx[t + 1] !== idx[t + 2] && idx[t] !== idx[t + 2]) keep.push(idx[t], idx[t + 1], idx[t + 2])
  return { positions: new Float32Array(pos), indices: new Uint32Array(keep) }
}

export function bounds(p) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
    if (p[i + k] < min[k]) min[k] = p[i + k]
    if (p[i + k] > max[k]) max[k] = p[i + k]
  }
  return { min, max, size: max.map((v, k) => v - min[k]) }
}

export function vertexNormals(p, idx) {
  const n = new Float32Array(p.length)
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    for (const v of [a, b, c]) { n[v] += nx; n[v + 1] += ny; n[v + 2] += nz }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l
  }
  return n
}

/** Removes unreferenced vertices. */
export function compact(p, idx) {
  const remap = new Int32Array(p.length / 3).fill(-1)
  const out = []
  const ni = new Uint32Array(idx.length)
  for (let i = 0; i < idx.length; i++) {
    let r = remap[idx[i]]
    if (r < 0) {
      r = remap[idx[i]] = out.length / 3
      out.push(p[idx[i] * 3], p[idx[i] * 3 + 1], p[idx[i] * 3 + 2])
    }
    ni[i] = r
  }
  return { positions: new Float32Array(out), indices: ni }
}

/** Minimal GLB: one mesh, one primitive (POSITION, NORMAL, indices), one node, optional extras. */
export function writeGlb(path, { positions, normals, indices }, extras = {}) {
  const pad4 = (n) => (n + 3) & ~3
  const b = bounds(positions)
  const posBytes = positions.byteLength, norBytes = normals.byteLength, idxBytes = indices.byteLength
  const bin = Buffer.alloc(pad4(posBytes) + pad4(norBytes) + pad4(idxBytes))
  Buffer.from(positions.buffer, positions.byteOffset, posBytes).copy(bin, 0)
  Buffer.from(normals.buffer, normals.byteOffset, norBytes).copy(bin, pad4(posBytes))
  Buffer.from(indices.buffer, indices.byteOffset, idxBytes).copy(bin, pad4(posBytes) + pad4(norBytes))
  const json = {
    asset: { version: '2.0', generator: 'temple-of-aphaia tools/sculpture' },
    extras,
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: extras.id ?? 'figure' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 },
      { buffer: 0, byteOffset: pad4(posBytes), byteLength: norBytes, target: 34962 },
      { buffer: 0, byteOffset: pad4(posBytes) + pad4(norBytes), byteLength: idxBytes, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min: b.min, max: b.max },
      { bufferView: 1, componentType: 5126, count: normals.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5125, count: indices.length, type: 'SCALAR' },
    ],
  }
  let jbuf = Buffer.from(JSON.stringify(json))
  jbuf = Buffer.concat([jbuf, Buffer.alloc(pad4(jbuf.length) - jbuf.length, 0x20)])
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jbuf.length + 8 + bin.length, 8)
  const ch = (len, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(len, 0); h.writeUInt32LE(type, 4); return h }
  writeFileSync(path, Buffer.concat([header, ch(jbuf.length, 0x4e4f534a), jbuf, ch(bin.length, 0x004e4942), bin]))
}

function png(w, h, rgb) {
  const rows = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    rows[y * (w * 3 + 1)] = 0
    rgb.copy(rows, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3)
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

/** Front (-Z), side (+X) and top (-Y) views in file axes. */
export const PREVIEW_AXES = [
  (x, y, z) => [x, y, -z],
  (x, y, z) => [-z, y, -x],
  (x, y, z) => [x, -z, y],
]
/** Turntable views of a +Y-up mesh: seen from +Z, +X, -Z, -X (the camera looks toward the origin). */
export const TURNTABLE = [
  (x, y, z) => [x, y, z],
  (x, y, z) => [-z, y, x],
  (x, y, z) => [-x, y, -z],
  (x, y, z) => [z, y, -x],
]

/**
 * Orthographic preview strip: views along -Z (front), +X (side) and -Y (top) in mesh axes, each shaded by
 * normal.z of the view, with the axis labels in the caller's file name. Square tiles of `size` px.
 */
export function previewPng(path, { positions: p, indices: idx }, size = 320, views = PREVIEW_AXES) {
  const W = size * views.length
  const rgb = Buffer.alloc(W * size * 3, 40)
  views.forEach((view, vi) => {
    const P = new Float32Array(p.length)
    for (let i = 0; i < p.length; i += 3) P.set(view(p[i], p[i + 1], p[i + 2]), i)
    const b = bounds(P)
    const s = (size * 0.9) / Math.max(b.size[0], b.size[1])
    const ox = vi * size + size / 2 - ((b.min[0] + b.max[0]) / 2) * s
    const oy = size / 2 + ((b.min[1] + b.max[1]) / 2) * s
    const zb = new Float32Array(size * size).fill(-Infinity)
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, bb = idx[t + 1] * 3, c = idx[t + 2] * 3
      const X = [P[a], P[bb], P[c]].map((v) => v * s + ox - vi * size)
      const Y = [P[a + 1], P[bb + 1], P[c + 1]].map((v) => oy - v * s)
      const Z = [P[a + 2], P[bb + 2], P[c + 2]]
      const ux = X[1] - X[0], uy = Y[1] - Y[0], vx = X[2] - X[0], vy = Y[2] - Y[0]
      const area = ux * vy - uy * vx
      if (area >= 0) continue // back-facing (screen y down)
      const nx = (P[bb + 1] - P[a + 1]) * (P[c + 2] - P[a + 2]) - (P[bb + 2] - P[a + 2]) * (P[c + 1] - P[a + 1])
      const ny = (P[bb + 2] - P[a + 2]) * (P[c] - P[a]) - (P[bb] - P[a]) * (P[c + 2] - P[a + 2])
      const nz = (P[bb] - P[a]) * (P[c + 1] - P[a + 1]) - (P[bb + 1] - P[a + 1]) * (P[c] - P[a])
      const shade = Math.max(0.15, Math.abs(nz) / (Math.hypot(nx, ny, nz) || 1))
      const x0 = Math.max(0, Math.floor(Math.min(...X))), x1 = Math.min(size - 1, Math.ceil(Math.max(...X)))
      const y0 = Math.max(0, Math.floor(Math.min(...Y))), y1 = Math.min(size - 1, Math.ceil(Math.max(...Y)))
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const w0 = ((X[1] - x) * (Y[2] - y) - (Y[1] - y) * (X[2] - x)) / area
        const w1 = ((X[2] - x) * (Y[0] - y) - (Y[2] - y) * (X[0] - x)) / area
        const w2 = 1 - w0 - w1
        if (w0 < 0 || w1 < 0 || w2 < 0) continue
        const z = w0 * Z[0] + w1 * Z[1] + w2 * Z[2]
        if (z <= zb[y * size + x]) continue
        zb[y * size + x] = z
        const o = (y * W + vi * size + x) * 3
        const g = Math.round(60 + 190 * shade)
        rgb[o] = g; rgb[o + 1] = Math.round(g * 0.97); rgb[o + 2] = Math.round(g * 0.9)
      }
    }
  })
  writeFileSync(path, png(W, size, rgb))
}
