import './style.css'
import { buildScene } from './app/build-scene'
import { generateTemple } from './app/geometry-client'
import { installTestHook, TEST_HOOK_ENABLED } from './app/test-hook'
import { pickTier } from './app/tier'
import { createHud } from './app/ui/hud'
import { createViewer } from './app/viewer'

async function start() {
  const app = document.querySelector<HTMLDivElement>('#app')
  if (!app) return
  const status = document.querySelector<HTMLDivElement>('#status')
  const tier = pickTier()
  const viewer = createViewer(app)
  try {
    const res = await generateTemple({ tier, keepColorIdx: TEST_HOOK_ENABLED })
    const paint = new URLSearchParams(location.search).has('paint')
    viewer.add(buildScene(res.output, { paint }))
    viewer.controls.configure(res.output, res.meta)
    createHud(viewer.controls)
    installTestHook(viewer, res.meta, { tier, generationMs: res.ms, workerWallMs: res.wallMs, triangles: res.triangles })
    status?.remove()
  } catch (err) {
    if (status) status.textContent = `Could not build the temple: ${err instanceof Error ? err.message : String(err)}`
    throw err
  }
}

void start()
