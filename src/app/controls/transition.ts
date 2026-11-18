// Pure orbit <-> walk camera tween (no `three`): position, look-at target and FOV eased with easeInOutSine
// over 1.2 s (peak speed pi/2 = 1.57x the mean, zero speed at both ends). Driven by the app clock.
export type V3 = [number, number, number]

export interface Pose {
  position: V3
  target: V3
  fov: number
}

export const TRANSITION_MS = 1200

export const easeInOutSine = (t: number) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, t)))) / 2

const lerp3 = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const k = easeInOutSine(t)
  return { position: lerp3(a.position, b.position, k), target: lerp3(a.target, b.target, k), fov: a.fov + (b.fov - a.fov) * k }
}

export class Transition {
  private elapsed = 0
  readonly from: Pose
  readonly to: Pose
  readonly duration: number
  constructor(from: Pose, to: Pose, duration = TRANSITION_MS) {
    this.from = from
    this.to = to
    this.duration = duration
  }

  /** Advance by dt ms; returns the pose and whether the tween has reached its end (the end pose is exact). */
  advance(dtMs: number): { pose: Pose; done: boolean } {
    this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, dtMs))
    const done = this.elapsed >= this.duration
    return { pose: done ? this.to : lerpPose(this.from, this.to, this.elapsed / this.duration), done }
  }

  get progress() {
    return this.elapsed / this.duration
  }
}
