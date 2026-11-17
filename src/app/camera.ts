// Camera factory and the near planes per mode (plan M4: walk 0.15, orbit 0.5).
import { PerspectiveCamera } from 'three'

export const NEAR = { orbit: 0.5, walk: 0.15 } as const
/** Far plane: the DEM landscape reaches 3 km from the temple, the sea plane to the horizon. */
export const FAR = 15000

export function createCamera(aspect: number): PerspectiveCamera {
  return new PerspectiveCamera(50, aspect, NEAR.orbit, FAR)
}
