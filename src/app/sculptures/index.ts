// Scanned sculptures (lazy): after the first interactive view, fetch one meshopt-compressed GLB per figure
// (high LOD on the high tier, the light LOD otherwise), fit each into its slot with the pure fitScan from
// src/geometry/figures.ts, merge them into one marble mesh (one draw call) and hide the stand-ins they
// replace. Until then, and wherever a scan is missing or fails to load, the stand-ins stay.
import { BufferAttribute, BufferGeometry, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Vector3, type Group, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import assets from '../../data/sculpture-assets.json'
import palette from '../../data/palette.json'
import sculptures from '../../data/sculptures.json'
import { fitScan, SCAN_CONVENTIONS, type GroupRange } from '../../geometry/figures'
import type { TempleMeta } from '../../geometry/protocol'
import type { Tier } from '../../geometry/types'
import { TEST_HOOK_ENABLED } from '../test-hook'

export interface SculptureStatus {
  state: 'idle' | 'loading' | 'done' | 'error'
  loaded: string[]
  failed: string[]
  bytes: number
  ms: number
}

type Asset = { plinthM: number; lods: Record<string, { file: string; triangles: number; bytes: number }> }

/** Canonical positions (metres) of a loaded GLB, with node transforms (quantization) applied. */
function positionsOf(root: Object3D): { positions: Float32Array; normals: Float32Array; index: Uint32Array } {
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
  return {
    positions: g.getAttribute('position').array as Float32Array,
    normals: g.getAttribute('normal').array as Float32Array,
    index: Uint32Array.from(g.index!.array),
  }
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

export function loadSculptures(root: Group, meta: TempleMeta, tier: Tier, onDone?: (s: SculptureStatus) => void): SculptureStatus {
  const status: SculptureStatus = { state: 'idle', loaded: [], failed: [], bytes: 0, ms: 0 }
  if (TEST_HOOK_ENABLED) (window as Window & { __aphaiaSculptures?: SculptureStatus }).__aphaiaSculptures = status
  const lod = tier === 'high' ? 'high' : 'low'
  const base = `${import.meta.env.BASE_URL}sculptures/`
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const slots = new Map(meta.sculpture.figureSlots.map((f) => [f.id, f]))
  const field = meta.sculpture.field
  const cult = meta.sculpture.cultSlot

  const run = async () => {
    status.state = 'loading'
    const t0 = performance.now()
    const parts: { geo: BufferGeometry; ranges: GroupRange[] }[] = []
    await Promise.all(
      sculptures.sculptures.map(async (s) => {
        const a = (assets as Record<string, Asset>)[s.id]
        const file = a?.lods[lod]
        if (!file) return
        try {
          const gltf = await loader.loadAsync(base + file.file)
          const { positions, normals, index } = positionsOf(gltf.scene)
          let m: Matrix4
          let ranges: GroupRange[]
          const figureId = 'figureId' in s.slot ? s.slot.figureId : undefined
          if (figureId) {
            const slot = slots.get(figureId)
            if (!slot) throw new Error(`no slot ${figureId}`)
            const plinth = Math.min(a.plinthM, SCAN_CONVENTIONS.maxPlinth)
            const fit = fitScan(positions, plinth, slot.side, slot.z, field, slot.spacing * SCAN_CONVENTIONS.shiftFraction)
            const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), fit.rotY)
            m = new Matrix4().compose(new Vector3(...fit.position), q, new Vector3(fit.scale, fit.scale, fit.scale))
            ranges = slot.ranges
          } else {
            // Cult statue: real size on the base, facing east toward the door (canonical +z -> +x).
            m = new Matrix4().makeRotationY(Math.PI / 2)
            m.setPosition(cult.x, cult.baseTopY, cult.z)
            ranges = cult.ranges
          }
          const geo = new BufferGeometry()
          geo.setAttribute('position', new BufferAttribute(positions, 3))
          geo.setAttribute('normal', new BufferAttribute(normals, 3))
          geo.setIndex(new BufferAttribute(index, 1))
          geo.applyMatrix4(m)
          parts.push({ geo, ranges })
          status.loaded.push(s.id)
          status.bytes += file.bytes
        } catch (err) {
          status.failed.push(s.id)
          console.warn(`sculpture ${s.id}:`, err)
        }
      }),
    )
    if (parts.length) {
      const merged = mergeGeometries(parts.map((p) => p.geo))
      merged.computeBoundingSphere()
      const mat = new MeshStandardMaterial({ color: palette.colors.marble.color, roughness: 0.55, metalness: 0 })
      const mesh = new Mesh(merged, mat)
      mesh.name = 'sculptures'
      root.add(mesh)
      hideStandIns(root, parts.flatMap((p) => p.ranges))
    }
    status.ms = performance.now() - t0
    status.state = status.failed.length && !parts.length ? 'error' : 'done'
    onDone?.(status)
  }

  // Start once the first interactive view is up: on idle, so the first frames are not delayed.
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
  if (idle) idle(() => void run(), { timeout: 1500 })
  else setTimeout(() => void run(), 200)
  return status
}
