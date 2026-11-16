import './style.css'
import { buildScene } from './app/build-scene'
import { generateTemple } from './app/geometry-client'
import { installTestHook, TEST_HOOK_ENABLED } from './app/test-hook'
import { pickTier } from './app/tier'
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
    const b = res.meta.bounds
    viewer.setCamera({ position: [b.maxX * 1.6, b.maxY * 1.8, b.maxZ * 3.2], target: [0, b.maxY * 0.4, 0] })
    installTestHook(viewer, res.meta, { tier, generationMs: res.ms, workerWallMs: res.wallMs, triangles: res.triangles })
    status?.remove()
  } catch (err) {
    if (status) status.textContent = `Could not build the temple: ${err instanceof Error ? err.message : String(err)}`
    throw err
  }
}

void start()
