// Orbit mode: three's OrbitControls with damping and the plan's limits: polar angle <= pi/2 - 0.05, a
// minimum distance derived from the temple bounding box (the camera never enters the inflated box, so it
// cannot clip into the roof or columns), a maximum distance, a target clamp to the site, and a ground clamp
// (camera y >= real ground + clearance).
//
// Poses set programmatically (test hook, transitions) are kept exactly: the limits only engage once the user
// moves the camera, and the polar limit then relaxes to the current angle so nothing ever jumps (the
// placeholder's clamp snapped the camera whenever the target was above it).
import type { PerspectiveCamera } from 'three'
import { Spherical, Vector3 } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Level } from '../../geometry/types'
import { orbitGround } from './ground'

export const MAX_POLAR = Math.PI / 2 - 0.05
export const MAX_DISTANCE = 320
/** Camera clearance above the ground (plan: >= 0.3 m; more here, so the 0.5 m near plane never cuts the ground). */
export const GROUND_CLEARANCE = 0.8
/** Inflation of the temple box: covers the near-plane rectangle (0.5 m at 50 degrees FOV, any aspect). */
export const BOX_MARGIN = 1.0

export interface Box3Like {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

export interface OrbitLimits {
  /** The temple's outer bounds (cornice outline, ground to ridge). */
  box: Box3Like
  /** Site extent for the target clamp. */
  site: { minX: number; maxX: number; minZ: number; maxZ: number }
  levels: readonly Level[]
}

type V3 = [number, number, number]

/**
 * Keep the camera out of `box` (already inflated). The camera stays on the ray from the target: if the target
 * is inside the box the camera moves out to where the ray leaves it (the bbox-derived minimum distance);
 * if the box lies between them the camera moves in front of it. Returns null when the camera is outside.
 */
export function keepOutside(box: Box3Like, target: V3, cam: V3): V3 | null {
  const inside = (p: V3) => p[0] > box.minX && p[0] < box.maxX && p[1] > box.minY && p[1] < box.maxY && p[2] > box.minZ && p[2] < box.maxZ
  if (!inside(cam)) return null
  const d: V3 = [cam[0] - target[0], cam[1] - target[1], cam[2] - target[2]]
  const len = Math.hypot(d[0], d[1], d[2])
  if (len < 1e-9) return [cam[0], box.maxY, cam[2]]
  let t0 = -Infinity
  let t1 = Infinity
  const lo = [box.minX, box.minY, box.minZ]
  const hi = [box.maxX, box.maxY, box.maxZ]
  for (let i = 0; i < 3; i++) {
    const di = d[i] / len
    if (Math.abs(di) < 1e-12) continue
    const a = (lo[i] - target[i]) / di
    const b = (hi[i] - target[i]) / di
    t0 = Math.max(t0, Math.min(a, b))
    t1 = Math.min(t1, Math.max(a, b))
  }
  const t = t0 <= 0 ? t1 : t0
  return [target[0] + (d[0] / len) * t, target[1] + (d[1] / len) * t, target[2] + (d[2] / len) * t]
}

export const inflate = (b: Box3Like, m: number): Box3Like => ({
  minX: b.minX - m,
  maxX: b.maxX + m,
  minY: b.minY - m,
  maxY: b.maxY + m,
  minZ: b.minZ - m,
  maxZ: b.maxZ + m,
})

export interface Orbit {
  controls: OrbitControls
  update(dtMs: number): void
  dispose(): void
  /** Scene limits (set once the Worker returns). */
  configure(limits: OrbitLimits): void
  /** Hold the current pose exactly; the limits engage on the next user interaction. */
  hold(): void
  /** Drop any damping momentum (before handing the camera to a transition or another mode). */
  stop(): void
  readonly constrained: boolean
}

export function createOrbit(camera: PerspectiveCamera, dom: HTMLElement): Orbit {
  const controls = new OrbitControls(camera, dom)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 2
  controls.maxDistance = MAX_DISTANCE
  controls.maxPolarAngle = MAX_POLAR
  controls.zoomToCursor = false
  let limits: OrbitLimits | null = null
  let box: Box3Like | null = null
  let constrained = false
  const sph = new Spherical()
  const off = new Vector3()

  const polar = () => sph.setFromVector3(off.copy(camera.position).sub(controls.target)).phi
  // A pose beyond the polar limit (a held pose looking up) relaxes the limit to its own angle instead of
  // snapping; the limit tightens back as the user rotates upward.
  const relaxPolar = () => {
    controls.maxPolarAngle = Math.max(MAX_POLAR, Math.min(controls.maxPolarAngle, polar() + 1e-6))
    controls.maxDistance = Math.max(MAX_DISTANCE, Math.min(controls.maxDistance, camera.position.distanceTo(controls.target) + 1e-6))
  }
  const onStart = () => {
    if (!constrained) {
      constrained = true
      controls.maxPolarAngle = Math.max(MAX_POLAR, polar() + 1e-6)
      controls.minDistance = 2
      controls.maxDistance = Math.max(MAX_DISTANCE, camera.position.distanceTo(controls.target))
    }
  }
  controls.addEventListener('start', onStart)

  const stop = () => {
    // OrbitControls keeps its pending damped motion in private fields; clear it so a hand-over is exact.
    const c = controls as unknown as { _sphericalDelta?: Spherical; _panOffset?: Vector3; _scale?: number }
    c._sphericalDelta?.set(0, 0, 0)
    c._panOffset?.set(0, 0, 0)
    if (c._scale !== undefined) c._scale = 1
  }

  const clamp = () => {
    if (!limits || !box) return
    const t = controls.target
    const s = limits.site
    t.x = Math.min(s.maxX, Math.max(s.minX, t.x))
    t.z = Math.min(s.maxZ, Math.max(s.minZ, t.z))
    const tg = orbitGround(limits.levels, t.x, t.z)
    t.y = Math.min(limits.box.maxY + 10, Math.max(tg, t.y))
    const out = keepOutside(box, t.toArray() as V3, camera.position.toArray() as V3)
    if (out) camera.position.set(...out)
    const g = orbitGround(limits.levels, camera.position.x, camera.position.z) + GROUND_CLEARANCE
    if (camera.position.y < g) camera.position.y = g
    camera.lookAt(t)
  }

  return {
    controls,
    update() {
      controls.update()
      if (constrained) {
        clamp()
        relaxPolar()
      }
    },
    dispose() {
      controls.removeEventListener('start', onStart)
      controls.dispose()
    },
    configure(l) {
      limits = l
      box = inflate(l.box, BOX_MARGIN)
    },
    hold() {
      stop()
      constrained = false
      // No limits while held: OrbitControls would otherwise clamp the pose on its next update.
      controls.maxPolarAngle = Math.PI
      controls.minDistance = 0
      controls.maxDistance = Infinity
      controls.update()
    },
    stop,
    get constrained() {
      return constrained
    },
  }
}
