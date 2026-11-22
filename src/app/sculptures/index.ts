// Scanned sculptures (lazy): after the first interactive view, fetch each processed scan once (high LOD on
// the high tier, the light LOD otherwise; meshopt-compressed GLBs), build every slot from it (real,
// mirrored or imagined from another scan), lay each pediment out by figure height (layoutPediment), place
// the cult statue and the sphinx, merge everything into one marble mesh (plus one mesh for the painted
// Scythian costume) and hide the stand-ins they replace. Until then, and wherever a scan fails, the
// stand-ins stay.
import { BufferAttribute, BufferGeometry, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Vector3, type Group, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import assets from '../../data/sculpture-assets.json'
import palette from '../../data/palette.json'
import sculptures from '../../data/sculptures.json'
import { layoutPediment, SCAN_CONVENTIONS, type GroupRange, type ScanFit } from '../../geometry/figures'
import type { TempleMeta } from '../../geometry/protocol'
import type { Tier } from '../../geometry/types'
import { createPatternTexture } from '../materials/textures'
import type { PatternColors } from '../materials/patterns'
import { TEST_HOOK_ENABLED } from '../test-hook'

export interface SculptureStatus {
  state: 'idle' | 'loading' | 'done' | 'error'
  loaded: string[]
  failed: string[]
  bytes: number
  ms: number
}

type Asset = { plinthM: number; lods: Record<string, { file: string; triangles: number; bytes: number }> }
type Entry = (typeof sculptures.sculptures)[number] & { asset?: string; mirror?: boolean }
interface Scan {
  positions: Float32Array
  normals: Float32Array
  index: Uint32Array
}

export const COSTUME = {
  /** Diamond tile size on the costume (m) and the costume's upper limit as a fraction of the figure height. */
  tile: 0.12,
  topFraction: 0.72,
}

/** Canonical positions (metres) of a loaded GLB, with node transforms (quantization) applied. */
function readScan(root: Object3D): Scan {
  const geos: BufferGeometry[] = []
  root.updateMatrixWorld(true)
  root.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh) return
    const g = new BufferGeometry()
    const p = m.geometry.getAttribute('position')
    const n = m.geometry.getAttribute('normal')
    const pos = new Float32Array(p.count * 3)
    const nor = new Float32Array(p.count * 3)
    for (let i = 0; i < p.count; i++) {
      pos.set([p.getX(i), p.getY(i), p.getZ(i)], i * 3)
      if (n) nor.set([n.getX(i), n.getY(i), n.getZ(i)], i * 3)
    }
    g.setAttribute('position', new BufferAttribute(pos, 3))
    g.setAttribute('normal', new BufferAttribute(nor, 3))
    if (m.geometry.index) g.setIndex(new BufferAttribute(Uint32Array.from(m.geometry.index.array), 1))
    g.applyMatrix4(m.matrixWorld)
    geos.push(g)
  })
  const g = geos.length === 1 ? geos[0] : mergeGeometries(geos)
  return { positions: g.getAttribute('position').array as Float32Array, normals: g.getAttribute('normal').array as Float32Array, index: Uint32Array.from(g.index!.array) }
}

/** Mirror across the canonical x = 0 plane (left-right), flipping triangle winding. */
export function mirrorScan(s: Scan): Scan {
  const positions = Float32Array.from(s.positions)
  const normals = Float32Array.from(s.normals)
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = -positions[i]
    normals[i] = -normals[i]
  }
  const index = Uint32Array.from(s.index)
  for (let t = 0; t < index.length; t += 3) [index[t + 1], index[t + 2]] = [index[t + 2], index[t + 1]]
  return { positions, normals, index }
}

/** Collapses the stand-in triangles a scan replaces (their indices become degenerate). */
function hideStandIns(root: Group, ranges: GroupRange[]) {
  root.traverse((o) => {
    const m = o as Mesh
    const start = m.geometry?.userData?.groupIndexStart as Record<string, number> | undefined
    if (!start || !m.geometry.index) return
    const idx = m.geometry.index
    for (const r of ranges) {
      const s = start[r.group]
      if (s === undefined) continue
      const keep = idx.getX(s + r.start)
      for (let i = 0; i < r.count; i++) idx.setX(s + r.start + i, keep)
      idx.needsUpdate = true
    }
  })
}

const geometryOf = (s: Scan, m: Matrix4, uv = false): BufferGeometry => {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(Float32Array.from(s.positions), 3))
  g.setAttribute('normal', new BufferAttribute(Float32Array.from(s.normals), 3))
  if (uv) {
    // Planar costume UVs in canonical metres (before placement), one diamond tile per COSTUME.tile.
    const u = new Float32Array((s.positions.length / 3) * 2)
    for (let i = 0; i < s.positions.length / 3; i++) {
      u[i * 2] = (s.positions[i * 3] + s.positions[i * 3 + 2]) / COSTUME.tile
      u[i * 2 + 1] = s.positions[i * 3 + 1] / COSTUME.tile
    }
    g.setAttribute('uv', new BufferAttribute(u, 2))
  }
  g.setIndex(new BufferAttribute(s.index, 1))
  g.applyMatrix4(m)
  return g
}

/** Splits a scan's triangles at a canonical height: [below, above]. */
function splitAtHeight(s: Scan, y: number): [Scan, Scan] {
  const lo: number[] = []
  const hi: number[] = []
  for (let t = 0; t < s.index.length; t += 3) {
    const cy = (s.positions[s.index[t] * 3 + 1] + s.positions[s.index[t + 1] * 3 + 1] + s.positions[s.index[t + 2] * 3 + 1]) / 3
    ;(cy < y ? lo : hi).push(s.index[t], s.index[t + 1], s.index[t + 2])
  }
  return [
    { ...s, index: Uint32Array.from(lo) },
    { ...s, index: Uint32Array.from(hi) },
  ]
}

const placement = (fit: ScanFit) =>
  new Matrix4().compose(new Vector3(...fit.position), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), fit.rotY), new Vector3(fit.scale, fit.scale, fit.scale))

export function loadSculptures(root: Group, meta: TempleMeta, tier: Tier, onDone?: (s: SculptureStatus) => void): SculptureStatus {
  const status: SculptureStatus = { state: 'idle', loaded: [], failed: [], bytes: 0, ms: 0 }
  if (TEST_HOOK_ENABLED) (window as Window & { __aphaiaSculptures?: SculptureStatus }).__aphaiaSculptures = status
  const lod = tier === 'high' ? 'high' : 'low'
  const base = `${import.meta.env.BASE_URL}sculptures/`
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const A = assets as Record<string, Asset>
  const entries = sculptures.sculptures as Entry[]
  const slots = new Map(meta.sculpture.figureSlots.map((f) => [f.id, f]))
  const field = meta.sculpture.field

  const run = async () => {
    status.state = 'loading'
    const t0 = performance.now()
    // Each processed scan is fetched once, however many slots reuse it.
    const assetIds = [...new Set(entries.map((e) => e.asset ?? e.id))].filter((id) => A[id]?.lods[lod])
    const scans = new Map<string, Scan>()
    await Promise.all(
      assetIds.map(async (id) => {
        const file = A[id].lods[lod]
        try {
          scans.set(id, readScan((await loader.loadAsync(base + file.file)).scene))
          status.bytes += file.bytes
        } catch (err) {
          console.warn(`sculpture scan ${id}:`, err)
        }
      }),
    )
    const scanFor = (e: Entry) => {
      const s = scans.get(e.asset ?? e.id)
      return s && (e.mirror ? mirrorScan(s) : s)
    }
    const marble: BufferGeometry[] = []
    const costume: BufferGeometry[] = []
    const ranges: GroupRange[] = []
    const done = (e: Entry, r: GroupRange[]) => {
      ranges.push(...r)
      status.loaded.push(e.id)
    }

    // Pediments: lay out every slot that has a scan, in viewer left-to-right order.
    for (const side of ['west', 'east'] as const) {
      const row = entries
        .filter((e) => 'pediment' in e.slot && e.slot.pediment === side)
        .map((e) => ({ e, slot: slots.get((e.slot as { figureId: string }).figureId), scan: scanFor(e) }))
        .filter((r) => r.slot && r.scan)
        // Viewer left-to-right: east front left = +z, west front left = -z.
        .sort((a, b) => (side === 'east' ? b.slot!.z - a.slot!.z : a.slot!.z - b.slot!.z))
      if (!row.length) continue
      const centre = Math.max(0, row.findIndex((r) => Math.abs(r.slot!.z) < 1e-6))
      const fits = layoutPediment(
        field,
        side,
        row.map((r) => ({ points: r.scan!.positions, plinth: Math.min(A[r.e.asset ?? r.e.id].plinthM, SCAN_CONVENTIONS.maxPlinth) })),
        centre,
      )
      row.forEach((r, i) => {
        const m = placement(fits[i])
        if (r.e.paint === 'scythian-costume') {
          let top = 0
          for (let k = 1; k < r.scan!.positions.length; k += 3) top = Math.max(top, r.scan!.positions[k])
          const [lo, hi] = splitAtHeight(r.scan!, top * COSTUME.topFraction)
          costume.push(geometryOf(lo, m, true))
          marble.push(geometryOf(hi, m))
        } else marble.push(geometryOf(r.scan!, m))
        done(r.e, r.slot!.ranges)
      })
    }

    // Cult statue: real size on its base, facing east toward the door (canonical +z -> +x).
    const cult = meta.sculpture.cultSlot
    for (const e of entries.filter((x) => 'site' in x.slot && x.slot.site === 'cella-cult-statue')) {
      const s = scanFor(e)
      if (!s) continue
      marble.push(geometryOf(s, placement({ scale: 1, position: [cult.x, cult.baseTopY, cult.z], rotY: Math.PI / 2 })))
      done(e, cult.ranges)
    }

    // Sphinx: on the capital, its chest (canonical +x) turned toward the temple.
    const sp = meta.sculpture.sphinxSlot
    for (const e of entries.filter((x) => 'site' in x.slot && x.slot.site === 'sphinx-column')) {
      const s = scanFor(e)
      if (!s || !sp) continue
      const rotY = Math.atan2(sp.z, -sp.x)
      marble.push(geometryOf(s, placement({ scale: 1, position: [sp.x, sp.y, sp.z], rotY })))
      done(e, sp.ranges)
    }

    // Votive statues: the kore at the base's figure height, turned toward the altar (canonical +z -> +x), each
    // with a small deterministic turn so the row does not look stamped.
    const bases = new Map((meta.sculpture.statueSlots ?? []).map((st) => [st.id, st]))
    entries
      .filter((x) => 'site' in x.slot && x.slot.site === 'votive-statue')
      .forEach((e, i) => {
        const st = bases.get(e.id.replace('votive-statue-', ''))
        const s = scanFor(e)
        if (!st || !s) return
        let top = 0
        for (let k = 1; k < s.positions.length; k += 3) top = Math.max(top, s.positions[k])
        const turn = ((i % 3) - 1) * 0.12
        marble.push(geometryOf(s, placement({ scale: st.height / top, position: [st.x, st.y, st.z], rotY: Math.PI / 2 + turn })))
        done(e, st.ranges)
      })

    for (const id of assetIds) if (!scans.has(id)) status.failed.push(id)
    if (marble.length) {
      const mesh = new Mesh(mergeGeometries(marble), new MeshStandardMaterial({ color: palette.colors.marble.color, roughness: 0.55, metalness: 0 }))
      mesh.name = 'sculptures'
      mesh.geometry.computeBoundingSphere()
      root.add(mesh)
    }
    if (costume.length) {
      const tile = createPatternTexture('diamond', palette.patterns.diamond as PatternColors, 128)
      await tile.ready
      const mesh = new Mesh(mergeGeometries(costume), new MeshStandardMaterial({ map: tile.texture, roughness: 0.7, metalness: 0 }))
      mesh.name = 'sculptures-costume'
      mesh.geometry.computeBoundingSphere()
      root.add(mesh)
    }
    hideStandIns(root, ranges)
    status.ms = performance.now() - t0
    status.state = status.failed.length && !status.loaded.length ? 'error' : 'done'
    onDone?.(status)
  }

  // Start once the first interactive view is up: on idle, so the first frames are not delayed.
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
  if (idle) idle(() => void run(), { timeout: 1500 })
  else setTimeout(() => void run(), 200)
  return status
}
