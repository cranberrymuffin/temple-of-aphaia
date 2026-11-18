// Orbit / walk mode switching with the smooth camera transition. Input is disabled while a transition runs;
// everything is driven by update(dt) from the app clock, so the test hook's manual clock controls it exactly.
import type { PerspectiveCamera } from 'three'
import { Vector3 } from 'three'
import type { TempleMeta } from '../../geometry/protocol'
import type { GeneratorOutput } from '../../geometry/types'
import { NEAR } from '../camera'
import { createOrbit } from './orbit'
import { Transition, type Pose, type V3 } from './transition'
import { createWalk, type Walk } from './walk'

export type Mode = 'orbit' | 'walk'

/** Default orbit view: the east front and south flank from above the altar court, the ramp and altar in view. */
export function startPose(meta: TempleMeta): Pose {
  const b = meta.bounds
  return { position: [b.maxX + 30, b.maxY + 11, b.maxZ + 27], target: [6, b.maxY * 0.3, 1], fov: 50 }
}

/** Walk spawn: on the outer terrace south of the propylon, facing north up its steps toward the temple. */
export const WALK_SPAWN = { x: 23.3, z: 33, yaw: 0.08, pitch: 0.04 }

export function createControls(camera: PerspectiveCamera, dom: HTMLElement) {
  const orbit = createOrbit(camera, dom)
  let walk: Walk | null = null
  let mode: Mode = 'orbit'
  let transition: { t: Transition; to: Mode; pose: Pose } | null = null
  let orbitPose: Pose | null = null
  let home: Pose | null = null
  const listeners = new Set<(m: Mode, transitioning: boolean) => void>()
  const tmp = new Vector3()

  const emit = () => listeners.forEach((f) => f(mode, transition !== null))

  const currentPose = (): Pose =>
    transition
      ? transition.pose
      : mode === 'walk' && walk
      ? walk.pose()
      : { position: camera.position.toArray() as V3, target: orbit.controls.target.toArray() as V3, fov: camera.fov }

  const applyPose = (p: Pose) => {
    camera.position.set(...p.position)
    camera.fov = p.fov
    camera.updateProjectionMatrix()
    camera.lookAt(tmp.set(...p.target))
  }

  const setNear = (n: number) => {
    camera.near = n
    camera.updateProjectionMatrix()
  }

  /** Enter orbit at `p` exactly (held: the limits engage on the next user interaction, without a jump). */
  const enterOrbit = (p: Pose) => {
    walk?.setActive(false)
    mode = 'orbit'
    setNear(NEAR.orbit)
    applyPose(p)
    orbit.controls.target.set(...p.target)
    orbit.controls.enabled = true
    orbit.hold()
  }

  const enterWalk = () => {
    if (!walk) return
    mode = 'walk'
    setNear(NEAR.walk)
    orbit.controls.enabled = false
    walk.setInputEnabled(true)
    walk.setActive(true)
  }

  const animate = (to: Pose, toMode: Mode, from = currentPose()) => {
    orbit.stop()
    orbit.controls.enabled = false
    walk?.setInputEnabled(false)
    walk?.setActive(false)
    if (toMode === 'walk') setNear(NEAR.walk)
    transition = { t: new Transition(from, to), to: toMode, pose: from }
    emit()
  }

  return {
    orbit,
    get walk() {
      return walk
    },
    get mode() {
      return mode
    },
    /** The mode being shown or, during a transition, the one it is heading to. */
    get destination(): Mode {
      return transition ? transition.to : mode
    },
    get transitioning() {
      return transition !== null
    },
    /** Transition progress in [0, 1], or null when idle. */
    get progress() {
      return transition ? transition.t.progress : null
    },
    onChange(f: (m: Mode, transitioning: boolean) => void) {
      listeners.add(f)
      return () => listeners.delete(f)
    },
    /** Wire the scene (colliders, levels, limits) once the Worker returns, and show the start view. */
    configure(out: GeneratorOutput, meta: TempleMeta) {
      orbit.configure({ box: meta.bounds, site: meta.site.bounds, levels: out.levels })
      walk = createWalk(camera, dom, { colliders: out.colliders, levels: out.levels })
      walk.place(WALK_SPAWN.x, WALK_SPAWN.z, WALK_SPAWN.yaw, WALK_SPAWN.pitch)
      home = startPose(meta)
      enterOrbit(home)
      emit()
    },
    /** Programmatic pose (test hook): orbit mode, instantly, held exactly. */
    setPose(p: Pose) {
      transition = null
      enterOrbit(p)
      emit()
    },
    getPose: currentPose,
    setMode(m: Mode) {
      if (transition || m === mode || !walk) return
      if (m === 'walk') {
        orbitPose = currentPose()
        animate(walk.pose(), 'walk')
      } else animate(orbitPose ?? home ?? currentPose(), 'orbit')
    },
    toggle() {
      this.setMode(mode === 'orbit' ? 'walk' : 'orbit')
    },
    /** Back to the start view (orbit) or the walk spawn (walk), animated. */
    reset() {
      if (transition || !walk || !home) return
      if (mode === 'orbit') animate(home, 'orbit')
      else {
        const from = walk.pose()
        walk.place(WALK_SPAWN.x, WALK_SPAWN.z, WALK_SPAWN.yaw, WALK_SPAWN.pitch)
        animate(walk.pose(), 'walk', from)
      }
    },
    setJoystick(v: { x: number; y: number }) {
      walk?.setJoystick(v)
    },
    update(dtMs: number) {
      if (transition) {
        const { pose, done } = transition.t.advance(dtMs)
        transition.pose = pose
        applyPose(pose)
        if (done) {
          const to = transition.to
          transition = null
          if (to === 'walk') enterWalk()
          else enterOrbit(pose)
          emit()
        }
        return
      }
      if (mode === 'walk') walk?.update(dtMs)
      else orbit.update(dtMs)
    },
    dispose() {
      orbit.dispose()
      walk?.dispose()
    },
  }
}

export type Controls = ReturnType<typeof createControls>
