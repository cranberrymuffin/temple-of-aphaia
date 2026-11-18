// window.__aphaia: deterministic test hook for Playwright. Installed in dev and in test builds only
// (VITE_TEST_HOOK=1); production builds tree-shake it away.
import { Euler } from 'three'
import type { TempleMeta } from '../geometry/protocol'
import type { Tier } from '../geometry/types'
import { applyLook, type Look } from './controls/look'
import type { Mode } from './controls/manager'
import type { WalkState } from './controls/walk'
import type { CameraPose, Viewer } from './viewer'

export interface AphaiaStats {
  tier: Tier
  generationMs: number
  workerWallMs: number
  triangles: number
  drawCalls: number
  renderedTriangles: number
  fps: number
}

export interface AphaiaHook {
  ready: boolean
  meta: TempleMeta
  setCamera(p: CameraPose): void
  getCamera(): ReturnType<Viewer['getCamera']>
  setManualClock(on: boolean): void
  tick(ms: number): void
  /** Orbit/walk: setMode starts the animated transition (as the HUD toggle does). */
  setMode(m: Mode): void
  reset(): void
  getMode(): { mode: Mode; destination: Mode; transitioning: boolean; progress: number | null }
  walk: {
    /** Mouse-look maths (the same path Pointer Lock and drag-to-look feed). In walk mode it turns the walker. */
    applyLook(dx: number, dy: number): Look
    /** Put the walker's feet on the ground at (x, z), facing yaw/pitch (radians). */
    place(x: number, z: number, yaw: number, pitch?: number): void
    state(): WalkState
    /** Joystick vector (x strafe right, y forward, |v| <= 1). */
    setJoystick(x: number, y: number): void
  }
  stats(): AphaiaStats
}

declare global {
  interface Window {
    __aphaia?: AphaiaHook
  }
}

export const TEST_HOOK_ENABLED: boolean = import.meta.env.DEV || import.meta.env.VITE_TEST_HOOK === '1'

export function installTestHook(viewer: Viewer, meta: TempleMeta, base: Omit<AphaiaStats, 'drawCalls' | 'renderedTriangles' | 'fps'>) {
  if (!TEST_HOOK_ENABLED) return
  const e = new Euler(0, 0, 0, 'YXZ')
  window.__aphaia = {
    ready: true,
    meta,
    setCamera: (p) => viewer.setCamera(p),
    getCamera: () => viewer.getCamera(),
    setManualClock: (on) => viewer.clock.setManual(on),
    tick: (ms) => viewer.tick(ms),
    setMode: (m) => viewer.controls.setMode(m),
    reset: () => viewer.controls.reset(),
    getMode: () => ({
      mode: viewer.controls.mode,
      destination: viewer.controls.destination,
      transitioning: viewer.controls.transitioning,
      progress: viewer.controls.progress,
    }),
    walk: {
      place(x, z, yaw, pitch = 0) {
        viewer.controls.walk?.place(x, z, yaw, pitch)
        viewer.renderer.render(viewer.scene, viewer.camera)
      },
      state() {
        const w = viewer.controls.walk
        if (!w) throw new Error('walk not configured')
        return JSON.parse(JSON.stringify(w.state)) as WalkState
      },
      setJoystick: (x, y) => viewer.controls.setJoystick({ x, y }),
      applyLook(dx, dy) {
        const w = viewer.controls.walk
        if (w && viewer.controls.mode === 'walk') {
          const next = w.applyLook(dx, dy)
          viewer.renderer.render(viewer.scene, viewer.camera)
          return next
        }
        e.setFromQuaternion(viewer.camera.quaternion, 'YXZ')
        const next = applyLook({ yaw: e.y, pitch: e.x }, dx, dy)
        viewer.camera.quaternion.setFromEuler(new Euler(next.pitch, next.yaw, 0, 'YXZ'))
        viewer.renderer.render(viewer.scene, viewer.camera)
        return next
      },
    },
    stats: () => {
      viewer.renderer.render(viewer.scene, viewer.camera)
      const info = viewer.renderer.info.render
      return { ...base, drawCalls: info.calls, renderedTriangles: info.triangles, fps: viewer.fps }
    },
  }
}
