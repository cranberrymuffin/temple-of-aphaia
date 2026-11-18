// Pure look and walk-input maths (plan Step 5): applyLook yaw/pitch with the pitch clamped to +-85 degrees,
// the joystick dead zone, the WASD/joystick -> world-delta mapping and the forward vector.
import { describe, expect, it } from 'vitest'
import { DEAD_ZONE, joystickVector } from '../../src/app/controls/joystick'
import { applyLook, LOOK_SENSITIVITY, MAX_PITCH } from '../../src/app/controls/look'
import { forward, moveDelta } from '../../src/app/controls/walk'

const deg = (r: number) => (r * 180) / Math.PI

describe('applyLook', () => {
  it('mouse right turns right (yaw decreases), mouse down looks down', () => {
    const l = applyLook({ yaw: 0, pitch: 0 }, 100, 40)
    expect(l.yaw).toBeCloseTo(-100 * LOOK_SENSITIVITY, 12)
    expect(l.pitch).toBeCloseTo(-40 * LOOK_SENSITIVITY, 12)
  })

  it('pitch is clamped to +-85 degrees, yaw is not', () => {
    expect(deg(applyLook({ yaw: 0, pitch: 0 }, 0, -1e6).pitch)).toBeCloseTo(85, 9)
    expect(deg(applyLook({ yaw: 0, pitch: 0 }, 0, 1e6).pitch)).toBeCloseTo(-85, 9)
    expect(applyLook({ yaw: 0, pitch: MAX_PITCH }, 0, -10).pitch).toBe(MAX_PITCH)
    expect(applyLook({ yaw: 0, pitch: 0 }, -1e4, 0).yaw).toBeCloseTo(1e4 * LOOK_SENSITIVITY, 9)
  })

  it('is additive: two half moves equal one full move', () => {
    const a = applyLook(applyLook({ yaw: 0.3, pitch: 0.1 }, 20, 10), 20, 10)
    const b = applyLook({ yaw: 0.3, pitch: 0.1 }, 40, 20)
    expect(a.yaw).toBeCloseTo(b.yaw, 12)
    expect(a.pitch).toBeCloseTo(b.pitch, 12)
  })
})

describe('walk input', () => {
  it('forward at yaw 0 is north (-z); yaw +90 degrees faces west (-x); pitch tilts up', () => {
    const f = forward({ yaw: 0, pitch: 0 })
    expect(f[0]).toBeCloseTo(0, 12)
    expect(f[2]).toBeCloseTo(-1, 12)
    const w = forward({ yaw: Math.PI / 2, pitch: 0 })
    expect(w[0]).toBeCloseTo(-1, 12)
    expect(forward({ yaw: 0, pitch: 0.5 })[1]).toBeCloseTo(Math.sin(0.5), 12)
  })

  it('W moves forward, D strafes right, diagonals are not faster', () => {
    const fw = moveDelta(0, { x: 0, y: 1 }, 1)
    expect(fw.x).toBeCloseTo(0, 12)
    expect(fw.z).toBeCloseTo(-1, 12)
    const right = moveDelta(0, { x: 1, y: 0 }, 1)
    expect(right.x).toBeCloseTo(1, 12)
    expect(right.z).toBeCloseTo(0, 12)
    const diag = moveDelta(0.7, { x: 1, y: 1 }, 1)
    expect(Math.hypot(diag.x, diag.z)).toBeCloseTo(1, 12)
    expect(moveDelta(1, { x: 0, y: 0 }, 1)).toEqual({ x: 0, z: 0 })
  })

  it('joystick: dead zone, rescaled magnitude, clamped at the rim, up = forward', () => {
    expect(joystickVector(DEAD_ZONE * 60 * 0.9, 0, 60)).toEqual({ x: 0, y: 0 })
    const up = joystickVector(0, -60, 60)
    expect(up.x).toBeCloseTo(0, 12)
    expect(up.y).toBeCloseTo(1, 12)
    const far = joystickVector(300, 0, 60)
    expect(far.x).toBeCloseTo(1, 12)
    const mid = joystickVector(30, 0, 60)
    expect(mid.x).toBeCloseTo((0.5 - DEAD_ZONE) / (1 - DEAD_ZONE), 12)
  })
})
