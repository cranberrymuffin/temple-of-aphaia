// Pure mouse/touch look maths (yaw/pitch in radians). Step 5's walk.ts builds on this.
export interface Look {
  yaw: number
  pitch: number
}

export const MAX_PITCH = (85 * Math.PI) / 180
export const LOOK_SENSITIVITY = 0.0025

export function applyLook(look: Look, dx: number, dy: number, sensitivity = LOOK_SENSITIVITY): Look {
  const pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, look.pitch - dy * sensitivity))
  return { yaw: look.yaw - dx * sensitivity, pitch }
}
