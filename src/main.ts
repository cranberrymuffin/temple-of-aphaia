import './style.css'
import { mountAbout } from './app/about'
import { buildScene } from './app/build-scene'
import { createMaterials } from './app/materials'
import { loadSculptures } from './app/sculptures'
import { generateTemple } from './app/geometry-client'
import { installTestHook, TEST_HOOK_ENABLED } from './app/test-hook'
import { pickTier } from './app/tier'
import { createHud } from './app/ui/hud'
import { createViewer } from './app/viewer'

if (import.meta.env.DEV) void import('./app/dev-badge').then((m) => m.mountDevBadge())

async function start() {
  const app = document.querySelector<HTMLDivElement>('#app')
  if (!app) return
  const status = document.querySelector<HTMLDivElement>('#status')
  const tier = pickTier()
  const viewer = createViewer(app)
  try {
    const res = await generateTemple({ tier, keepColorIdx: TEST_HOOK_ENABLED })
    // Painted by default; ?plain shows the unpainted Step 3 look for comparison.
    const paint = !new URLSearchParams(location.search).has('plain')
    const site = { bounds: res.meta.site.bounds, seaLevelY: res.meta.site.seaLevelY }
    const materials = createMaterials({ tier, paint, site, anisotropy: viewer.renderer.capabilities.getMaxAnisotropy() })
    const scene = buildScene(res.output, materials)
    viewer.add(scene)
    await materials.ready
    viewer.controls.configure(res.output, res.meta)
    createHud(viewer.controls)
    mountAbout(res.meta)
    installTestHook(viewer, res.meta, { tier, generationMs: res.ms, workerWallMs: res.wallMs, triangles: res.triangles }, res.output)
    status?.remove()
    // Scanned sculptures load after the first interactive view; the stand-ins show until then.
    loadSculptures(scene, res.meta, tier)
  } catch (err) {
    if (status) status.textContent = `Could not build the temple: ${err instanceof Error ? err.message : String(err)}`
    throw err
  }
}

void start()
