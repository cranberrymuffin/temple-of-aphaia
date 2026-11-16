// Minimal viewer shell: renderer, scene, basic lights, camera, placeholder orbit, render loop.
// Controls live in src/app/controls; Step 5 swaps them without touching this file's API.
import { Color, DirectionalLight, HemisphereLight, Scene, SRGBColorSpace, Vector3, WebGLRenderer, type Object3D } from 'three'
import { AppClock } from './clock'
import { createCamera } from './camera'
import { createOrbit } from './controls/orbit'

export interface CameraPose {
  position: [number, number, number]
  target: [number, number, number]
  fov?: number
}

export function createViewer(container: HTMLElement) {
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = SRGBColorSpace
  container.appendChild(renderer.domElement)

  const scene = new Scene()
  scene.background = new Color(0xbfd3e6)
  scene.add(new HemisphereLight(0xdfe9f5, 0x8a7a5c, 1.1))
  const sun = new DirectionalLight(0xfff3df, 2.2)
  sun.position.set(30, 45, 20)
  scene.add(sun)
  const fill = new DirectionalLight(0xe6eefc, 0.7)
  fill.position.set(-35, 20, -25)
  scene.add(fill)

  const camera = createCamera(1)
  const orbit = createOrbit(camera, renderer.domElement)
  const clock = new AppClock()
  let frames = 0
  let fps = 0
  let fpsT = performance.now()

  const resize = () => {
    const w = container.clientWidth || window.innerWidth
    const h = container.clientHeight || window.innerHeight
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', resize)
  resize()

  const renderFrame = (dt: number) => {
    orbit.update(dt)
    renderer.render(scene, camera)
    frames++
    const t = performance.now()
    if (t - fpsT >= 1000) {
      fps = (frames * 1000) / (t - fpsT)
      frames = 0
      fpsT = t
    }
  }
  renderer.setAnimationLoop(() => {
    if (!clock.isManual) renderFrame(clock.frame())
  })

  return {
    renderer,
    scene,
    camera,
    orbit,
    clock,
    add(obj: Object3D) {
      scene.add(obj)
    },
    setCamera(p: CameraPose) {
      camera.position.set(...p.position)
      orbit.controls.target.set(...p.target)
      if (p.fov) camera.fov = p.fov
      camera.updateProjectionMatrix()
      camera.lookAt(new Vector3(...p.target))
      orbit.controls.update()
      renderer.render(scene, camera)
    },
    getCamera(): Required<CameraPose> & { near: number } {
      return {
        position: camera.position.toArray() as [number, number, number],
        target: orbit.controls.target.toArray() as [number, number, number],
        fov: camera.fov,
        near: camera.near,
      }
    },
    /** Manual clock: advance and render one frame. */
    tick(ms: number) {
      renderFrame(clock.tick(ms))
    },
    get fps() {
      return fps
    },
  }
}

export type Viewer = ReturnType<typeof createViewer>
