// window.__aphaia: deterministic test hook for Playwright. Installed in dev and in test builds only
// (VITE_TEST_HOOK=1); production builds tree-shake it away.
import { Euler } from 'three'
import type { TempleMeta } from '../geometry/protocol'
import type { Tier } from '../geometry/types'
import { applyLook, type Look } from './controls/look'
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
  walk: { applyLook(dx: number, dy: number): Look }
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
    walk: {
      applyLook(dx, dy) {
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
