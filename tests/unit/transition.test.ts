// The orbit <-> walk tween in isolation (plan Step 5 / AC9; the e2e transition.spec checks the real camera).
import { describe, expect, it } from 'vitest'
import { easeInOutSine, Transition, TRANSITION_MS, type Pose } from '../../src/app/controls/transition'
import { keepOutside } from '../../src/app/controls/orbit'

const a: Pose = { position: [60, 30, 50], target: [4, 4, 4], fov: 50 }
const b: Pose = { position: [23.3, 0.7, 29.5], target: [22.1, 0.9, 19.6], fov: 65 }

describe('easeInOutSine', () => {
  it('starts and ends at rest, peak speed pi/2 of the mean', () => {
    expect(easeInOutSine(0)).toBe(0)
    expect(easeInOutSine(1)).toBeCloseTo(1, 15)
    expect(easeInOutSine(0.5)).toBeCloseTo(0.5, 15)
    const h = 1e-6
    expect((easeInOutSine(0.5 + h) - easeInOutSine(0.5 - h)) / (2 * h)).toBeCloseTo(Math.PI / 2, 5)
    expect((easeInOutSine(h) - easeInOutSine(0)) / h).toBeLessThan(1e-4)
  })
})

describe('Transition at 60 Hz', () => {
  it('monotonic, max step <= 2.5x mean, no velocity jump, exact end within 1.5 s', () => {
    const t = new Transition(a, b)
    const pts = [a.position]
    let done = false
    let ticks = 0
    while (!done && ticks < 200) {
      const r = t.advance(1000 / 60)
      pts.push(r.pose.position)
      done = r.done
      ticks++
    }
    expect(ticks).toBeLessThanOrEqual(90)
    expect(ticks * (1000 / 60)).toBeGreaterThanOrEqual(TRANSITION_MS - 1e-6)
    expect(pts[pts.length - 1]).toEqual(b.position)
    const dist = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
    const steps = pts.slice(1).map((p, i) => dist(p, pts[i]))
    const toEnd = pts.map((p) => dist(p, b.position))
    for (let i = 1; i < toEnd.length; i++) expect(toEnd[i]).toBeLessThanOrEqual(toEnd[i - 1] + 1e-9)
    const mean = steps.reduce((s, x) => s + x, 0) / steps.length
    const max = Math.max(...steps)
    expect(max).toBeLessThanOrEqual(2.5 * mean)
    const v = [0, ...steps, 0]
    for (let i = 1; i < v.length; i++) expect(Math.abs(v[i] - v[i - 1])).toBeLessThanOrEqual(0.2 * max)
  })
})

describe('keepOutside (bbox-derived minimum distance)', () => {
  const box = { minX: -16, maxX: 16, minY: -1, maxY: 15, minZ: -8, maxZ: 8 }
  it('a camera outside is untouched', () => {
    expect(keepOutside(box, [0, 5, 0], [0, 5, 30])).toBeNull()
  })
  it('target inside: the camera leaves through the box face along the view ray', () => {
    expect(keepOutside(box, [0, 5, 0], [0, 5, 4])).toEqual([0, 5, 8])
  })
  it('box between target and camera: the camera moves in front of the box', () => {
    const p = keepOutside(box, [0, 5, 20], [0, 5, 4])!
    expect(p[2]).toBeCloseTo(8, 9)
  })
})
