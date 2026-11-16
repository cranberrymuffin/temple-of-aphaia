// PLACEHOLDER orbit controls for the Step 3 viewer shell. Step 5 replaces this module (limits, damping,
// bbox-derived minDistance, ground clamp) behind the same createOrbit() signature.
import type { PerspectiveCamera } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export interface Orbit {
  controls: OrbitControls
  update(dtMs: number): void
  dispose(): void
}

export function createOrbit(camera: PerspectiveCamera, dom: HTMLElement): Orbit {
  const controls = new OrbitControls(camera, dom)
  controls.enableDamping = true
  controls.maxPolarAngle = Math.PI / 2 - 0.05
  return {
    controls,
    update: () => controls.update(),
    dispose: () => controls.dispose(),
  }
}
