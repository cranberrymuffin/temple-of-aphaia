// Responsive HUD (360 px to desktop): Orbit/Walk toggle, Reset view and Help at the top right, a one-line
// hint at the bottom, and the walk joystick at the bottom left on touch screens. Targets are >= 44 x 44 px
// and respect the safe-area insets. The About button and panel (Step 4) sit at the top left.
import './hud.css'
import type { Controls, Mode } from '../controls/manager'
import { createJoystick } from '../controls/joystick'

const ICONS = {
  walk: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="13" cy="4" r="2"/><path d="M10.5 21l1.6-6.2L14.5 17v4M9 12.5l1.2-4.3 3.3.7 1.8 3.1 2.2.8M10.2 8.2 7 10.2V13"/></svg>',
  orbit: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="12" rx="9.5" ry="4"/><path d="M12 5v14M8 8.5l4-3.5 4 3.5"/></svg>',
  reset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5"/></svg>',
  help: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.3-2.7 4"/><circle cx="12" cy="17.6" r=".6"/></svg>',
}

const touchScreen = () => matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0

function hint(mode: Mode, touch: boolean): string {
  if (mode === 'orbit')
    return touch ? 'Drag to orbit · pinch to zoom · two fingers to pan' : 'Drag to orbit · scroll to zoom · right-drag to pan'
  return touch ? 'Left pad to walk · drag to look around' : 'WASD or arrows to walk · click, then move the mouse to look (Esc releases)'
}

export interface HudButton {
  id: string
  label: string
  title?: string
  icon?: string
  onClick: () => void
}

export function createHud(controls: Controls, root: HTMLElement = document.body) {
  const hud = document.createElement('div')
  hud.id = 'hud'
  const bar = document.createElement('div')
  bar.className = 'hud-bar'
  bar.setAttribute('role', 'toolbar')
  bar.setAttribute('aria-label', 'View controls')
  const hintEl = document.createElement('p')
  hintEl.className = 'hud-hint'
  hintEl.setAttribute('aria-live', 'polite')
  const help = document.createElement('div')
  help.className = 'hud-help'
  help.id = 'hud-help'
  help.hidden = true
  help.setAttribute('role', 'dialog')
  help.setAttribute('aria-label', 'How to move')
  help.innerHTML = `
    <h2>How to move</h2>
    <h3>Orbit</h3>
    <ul>
      <li><b>Drag</b> (one finger) to orbit around the temple</li>
      <li><b>Scroll</b> or <b>pinch</b> to zoom</li>
      <li><b>Right-drag</b> or <b>two fingers</b> to pan</li>
    </ul>
    <h3>Walk</h3>
    <ul>
      <li><b>W A S D</b> or the <b>arrow keys</b> to walk, <b>Shift</b> to hurry</li>
      <li><b>Click</b> the view, then move the mouse to look around; <b>Esc</b> releases the mouse. You can also drag to look.</li>
      <li>On a phone or tablet: the <b>pad</b> at the bottom left walks, <b>drag</b> anywhere else to look</li>
    </ul>
    <p>You start in front of the propylon (the sanctuary gateway). Columns, walls and the terrace parapet stop you; steps and the east ramp carry you up.</p>`
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'hud-btn hud-close'
  close.textContent = 'Close'
  help.appendChild(close)

  const mkButton = (b: HudButton) => {
    const el = document.createElement('button')
    el.type = 'button'
    el.id = b.id
    el.className = 'hud-btn'
    el.title = b.title ?? b.label
    el.setAttribute('aria-label', b.title ?? b.label)
    el.innerHTML = `${b.icon ?? ''}<span class="hud-label">${b.label}</span>`
    el.addEventListener('click', (e) => {
      b.onClick()
      // A pointer click hands the keyboard back to the scene (WASD, and Space must not re-press the button).
      if (e.detail > 0) el.blur()
    })
    return el
  }
  const modeBtn = mkButton({ id: 'hud-mode', label: 'Walk', icon: ICONS.walk, onClick: () => controls.toggle() })
  const resetBtn = mkButton({ id: 'hud-reset', label: 'Reset', title: 'Reset view', icon: ICONS.reset, onClick: () => controls.reset() })
  const helpBtn = mkButton({
    id: 'hud-help-btn',
    label: 'Help',
    title: 'How to move',
    icon: ICONS.help,
    onClick: () => setHelp(help.hidden === true),
  })
  helpBtn.setAttribute('aria-controls', help.id)
  bar.append(modeBtn, resetBtn, helpBtn)

  const setHelp = (open: boolean) => {
    help.hidden = !open
    helpBtn.setAttribute('aria-expanded', String(open))
    if (open) close.focus()
  }
  close.addEventListener('click', () => {
    setHelp(false)
    helpBtn.focus()
  })
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !help.hidden) setHelp(false)
  })

  const joystick = createJoystick((v) => controls.setJoystick(v))
  const touch = touchScreen()
  hud.classList.toggle('hud-touch', touch)

  // Keep pointer events on HUD elements away from the canvas controls.
  for (const el of [bar, help, joystick.el]) el.addEventListener('pointerdown', (e) => e.stopPropagation())

  hud.append(bar, hintEl, help, joystick.el)
  root.appendChild(hud)

  const render = (mode: Mode, transitioning: boolean) => {
    const target = controls.destination
    const next: Mode = target === 'walk' ? 'orbit' : 'walk'
    modeBtn.innerHTML = `${ICONS[next]}<span class="hud-label">${next === 'walk' ? 'Walk' : 'Orbit'}</span>`
    modeBtn.title = next === 'walk' ? 'Walk around at eye level' : 'Back to the orbit view'
    modeBtn.setAttribute('aria-label', modeBtn.title)
    modeBtn.setAttribute('aria-pressed', String(target === 'walk'))
    for (const b of [modeBtn, resetBtn]) b.disabled = transitioning
    hud.dataset.mode = target
    hintEl.textContent = hint(target, touch)
    joystick.el.hidden = !(touch && mode === 'walk' && !transitioning)
  }
  controls.onChange(render)
  render(controls.mode, controls.transitioning)

  return {
    el: hud,
    /** Append a button to the toolbar (e.g. the About button, if it lives here). */
    addButton(b: HudButton) {
      const el = mkButton(b)
      bar.appendChild(el)
      return el
    },
    joystick,
  }
}
