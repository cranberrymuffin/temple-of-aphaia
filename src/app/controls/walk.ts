// Walk mode: eye 1.6 m above the ground, WASD/arrows (Shift to hurry), mouse look with Pointer Lock where
// available and drag-to-look everywhere else (mouse fallback and touch), plus the on-screen joystick.
// The look maths is the pure applyLook (look.ts); movement and collision the pure resolveMove (collision.ts).
import type { PerspectiveCamera } from 'three'
import { Euler } from 'three'
import { resolveMove, type Feet, type WalkWorld } from './collision'
import { surfaceAt } from './ground'
import { applyLook, type Look } from './look'
import type { Pose, V3 } from './transition'

export const EYE_HEIGHT = 1.6
export const WALK_SPEED = 1.6
export const RUN_SPEED = 4
export const WALK_FOV = 65
/** Distance of the look-at point used for transitions and getCamera(). */
const LOOK_DIST = 10
/** Time constant of the eye-height smoothing on steps (s). */
const EYE_TAU = 0.08

const KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
}

export function forward(look: Look): V3 {
  const c = Math.cos(look.pitch)
  return [-Math.sin(look.yaw) * c, Math.sin(look.pitch), -Math.cos(look.yaw) * c]
}

/** Movement input (x strafe right, y forward) -> world delta (x, z) for a walker facing `yaw`. */
export function moveDelta(yaw: number, input: { x: number; y: number }, dist: number): { x: number; z: number } {
  const m = Math.hypot(input.x, input.y)
  if (m < 1e-9) return { x: 0, z: 0 }
  const k = (Math.min(1, m) * dist) / m
  const s = Math.sin(yaw)
  const c = Math.cos(yaw)
  // forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw)
  return { x: (-s * input.y + c * input.x) * k, z: (-c * input.y - s * input.x) * k }
}

export interface WalkState {
  feet: Feet
  eyeY: number
  look: Look
}

export function createWalk(camera: PerspectiveCamera, dom: HTMLElement, world: WalkWorld) {
  const state: WalkState = { feet: { x: 0, y: 0, z: 0 }, eyeY: EYE_HEIGHT, look: { yaw: 0, pitch: 0 } }
  const keys = new Set<string>()
  let run = false
  let joy = { x: 0, y: 0 }
  let active = false
  let inputEnabled = true
  let drag: { id: number; x: number; y: number } | null = null
  const euler = new Euler(0, 0, 0, 'YXZ')

  const apply = () => {
    camera.position.set(state.feet.x, state.eyeY, state.feet.z)
    euler.set(state.look.pitch, state.look.yaw, 0, 'YXZ')
    camera.quaternion.setFromEuler(euler)
  }

  const look = (dx: number, dy: number) => {
    state.look = applyLook(state.look, dx, dy)
    if (active) apply()
    return state.look
  }

  const typing = (e: Event) => {
    const t = e.target as HTMLElement | null
    return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
  }
  const onKey = (down: boolean) => (e: KeyboardEvent) => {
    if (typing(e)) return
    if (e.key === 'Shift') run = down
    if (!(e.code in KEYS)) return
    if (down) keys.add(e.code)
    else keys.delete(e.code)
    if (active) e.preventDefault()
  }
  const keyDown = onKey(true)
  const keyUp = onKey(false)
  const blur = () => {
    keys.clear()
    run = false
  }

  const locked = () => document.pointerLockElement === dom
  const onPointerDown = (e: PointerEvent) => {
    if (!active || !inputEnabled || drag) return
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY }
    dom.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent) => {
    if (!active || !inputEnabled) return
    if (locked()) {
      look(e.movementX, e.movementY)
      return
    }
    if (!drag || e.pointerId !== drag.id) return
    look(e.clientX - drag.x, e.clientY - drag.y)
    drag.x = e.clientX
    drag.y = e.clientY
  }
  const onPointerUp = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.id) drag = null
  }
  // Desktop: a click locks the pointer (mouse look without holding a button); drag-to-look stays as the
  // fallback where Pointer Lock is missing or refused (iframes, some browsers, touch).
  const onClick = (e: MouseEvent) => {
    if (!active || !inputEnabled || locked() || (e as PointerEvent).pointerType === 'touch') return
    if (!matchMedia('(pointer: fine)').matches || !dom.requestPointerLock) return
    try {
      const p = dom.requestPointerLock() as unknown as Promise<void> | undefined
      p?.catch?.(() => {})
    } catch {
      // Pointer Lock refused: drag-to-look remains.
    }
  }

  window.addEventListener('keydown', keyDown)
  window.addEventListener('keyup', keyUp)
  window.addEventListener('blur', blur)
  dom.addEventListener('pointerdown', onPointerDown)
  dom.addEventListener('pointermove', onPointerMove)
  dom.addEventListener('pointerup', onPointerUp)
  dom.addEventListener('pointercancel', onPointerUp)
  dom.addEventListener('click', onClick)

  return {
    state,
    get active() {
      return active
    },
    /** Place the walker (feet on the highest surface at x, z) facing yaw/pitch. */
    place(x: number, z: number, yaw: number, pitch = 0) {
      const g = surfaceAt(world.levels, x, z)
      state.feet = { x, y: Number.isFinite(g) ? g : 0, z }
      state.eyeY = state.feet.y + EYE_HEIGHT
      state.look = { yaw, pitch }
      if (active) apply()
    },
    /** Camera pose for the current walker (look-at point LOOK_DIST ahead). */
    pose(): Pose {
      const f = forward(state.look)
      const p: V3 = [state.feet.x, state.eyeY, state.feet.z]
      return { position: p, target: [p[0] + f[0] * LOOK_DIST, p[1] + f[1] * LOOK_DIST, p[2] + f[2] * LOOK_DIST], fov: WALK_FOV }
    },
    setActive(on: boolean) {
      active = on
      drag = null
      if (on) apply()
      else if (locked()) document.exitPointerLock()
    },
    setInputEnabled(on: boolean) {
      inputEnabled = on
      if (!on) drag = null
    },
    setJoystick(v: { x: number; y: number }) {
      joy = v
    },
    applyLook: look,
    update(dtMs: number) {
      if (!active) return
      const dt = Math.min(dtMs, 100) / 1000
      if (inputEnabled && dt > 0) {
        const kx = [...keys].reduce((s, k) => s + KEYS[k][0], 0)
        const ky = [...keys].reduce((s, k) => s + KEYS[k][1], 0)
        const input = { x: Math.max(-1, Math.min(1, kx + joy.x)), y: Math.max(-1, Math.min(1, ky + joy.y)) }
        const d = moveDelta(state.look.yaw, input, (run ? RUN_SPEED : WALK_SPEED) * dt)
        if (d.x || d.z) state.feet = resolveMove(state.feet, d, world)
      }
      const target = state.feet.y + EYE_HEIGHT
      state.eyeY = dt > 0 ? target + (state.eyeY - target) * Math.exp(-dt / EYE_TAU) : state.eyeY
      if (Math.abs(state.eyeY - target) < 1e-4) state.eyeY = target
      apply()
    },
    dispose() {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', blur)
      dom.removeEventListener('pointerdown', onPointerDown)
      dom.removeEventListener('pointermove', onPointerMove)
      dom.removeEventListener('pointerup', onPointerUp)
      dom.removeEventListener('pointercancel', onPointerUp)
      dom.removeEventListener('click', onClick)
    },
  }
}

export type Walk = ReturnType<typeof createWalk>
