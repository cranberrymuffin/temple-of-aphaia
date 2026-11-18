// On-screen walk joystick for touch screens: a >= 88 px pad (120 px here) at the bottom left, with a dead
// zone. The maths is pure (joystickVector); the DOM part reports a vector in [-1, 1]^2 (x right, y forward).
export const JOYSTICK_SIZE = 120
export const DEAD_ZONE = 0.15

/**
 * Knob offset (px, screen axes: +y down) -> movement vector: x = strafe right, y = forward, magnitude <= 1,
 * zero inside the dead zone and rescaled outside it so speed starts at 0 at the dead-zone edge.
 */
export function joystickVector(dx: number, dy: number, radius: number, deadZone = DEAD_ZONE): { x: number; y: number } {
  const d = Math.hypot(dx, dy)
  if (radius <= 0 || d / radius <= deadZone) return { x: 0, y: 0 }
  const m = Math.min(1, (d / radius - deadZone) / (1 - deadZone))
  return { x: (dx / d) * m, y: (-dy / d) * m }
}

export interface Joystick {
  el: HTMLElement
  /** Current vector (x strafe right, y forward). */
  value: { x: number; y: number }
  dispose(): void
}

export function createJoystick(onChange?: (v: { x: number; y: number }) => void): Joystick {
  const el = document.createElement('div')
  el.className = 'hud-joystick'
  el.setAttribute('role', 'application')
  el.setAttribute('aria-label', 'Walk joystick: drag to move')
  const knob = document.createElement('div')
  knob.className = 'hud-joystick-knob'
  el.appendChild(knob)
  const js: Joystick = { el, value: { x: 0, y: 0 }, dispose: () => el.remove() }
  let id: number | null = null
  const set = (dx: number, dy: number) => {
    const r = el.clientWidth / 2 || JOYSTICK_SIZE / 2
    const d = Math.hypot(dx, dy)
    const k = d > r ? r / d : 1
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`
    js.value = joystickVector(dx, dy, r)
    onChange?.(js.value)
  }
  const fromEvent = (e: PointerEvent) => {
    const b = el.getBoundingClientRect()
    set(e.clientX - (b.left + b.width / 2), e.clientY - (b.top + b.height / 2))
  }
  el.addEventListener('pointerdown', (e) => {
    if (id !== null) return
    id = e.pointerId
    el.setPointerCapture?.(e.pointerId)
    fromEvent(e)
    e.preventDefault()
    e.stopPropagation()
  })
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId === id) fromEvent(e)
  })
  const end = (e: PointerEvent) => {
    if (e.pointerId !== id) return
    id = null
    set(0, 0)
  }
  el.addEventListener('pointerup', end)
  el.addEventListener('pointercancel', end)
  return js
}
