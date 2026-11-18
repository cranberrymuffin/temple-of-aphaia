// Step 3d checkpoint: terrace edges in masonry or rock, square porch piers, the corrected ground outside the walls, plain
// materials; plus per-tier triangle counts and Worker timings (logged). Writes screenshots/step3d/.
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { TempleMeta } from '../../src/geometry/protocol'
import type {} from '../../src/app/test-hook'

const sanctuary = JSON.parse(readFileSync(new URL('../../src/data/sanctuary.json', import.meta.url), 'utf8'))
type Pose = { position: [number, number, number]; target: [number, number, number]; fov?: number }
const F = sanctuary.features as Record<string, { center: [number, number]; width?: { value: number } }>

function views(m: TempleMeta): Record<string, Pose> {
  const S = m.stylobate.top
  const terraceY = S + sanctuary.terrain.terraces['temple-terrace'].level.value
  const outerY = S + sanctuary.terrain.terraces['outer-terrace'].level.value
    const [cx, cz] = F.cistern.center
  const [hx, hz] = F['se-rooms-ii-iv'].center
  return {
    'wide-hill-sea': { position: [420, 260, 520], target: [0, -40, 0], fov: 45 },
    'wide-hill-low': { position: [-900, 120, 700], target: [200, 60, -300], fov: 50 },
    'ne-aerial': { position: [cx + 22, terraceY + 26, cz - 30], target: [cx + 2, terraceY, cz + 18], fov: 55 },
    'ne-corner-below': { position: [cx + 26, terraceY - 4, cz - 22], target: [cx + 6, terraceY - 2, cz - 4], fov: 55 },
    'priests-houses': { position: [hx - 26, outerY + 6, hz + 12], target: [hx - 2, outerY + 1.5, hz - 8], fov: 55 },
    'priests-porch': { position: [hx - 14, outerY + 2.2, hz + 2], target: [hx - 4, outerY + 1.6, hz - 1], fov: 55 },
    'sw-wall-outside': { position: [-45, terraceY + 1.0, 38], target: [-20, terraceY + 1.0, 20.6], fov: 55 },
  }
}

test('step 3d checkpoint', async ({ page }) => {
  test.setTimeout(300_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const tier of ['low', 'med'] as const) {
    await page.goto(`./?tier=${tier}`)
    await page.waitForFunction(() => window.__aphaia?.ready === true, undefined, { timeout: 120_000 })
    console.log(`[step3d ${tier}] ${JSON.stringify(await page.evaluate(() => window.__aphaia!.stats()))}`)
  }
  await page.goto('./?tier=high')
  await page.waitForFunction(() => window.__aphaia?.ready === true, undefined, { timeout: 120_000 })
  const meta = (await page.evaluate(() => window.__aphaia!.meta)) as TempleMeta
  console.log(`[step3d high] ${JSON.stringify(await page.evaluate(() => window.__aphaia!.stats()))}`)
  console.log(`[step3d] demLoadMs ${meta.site.demLoadMs.toFixed(0)} demError ${meta.site.demError ?? 'none'} sea ${meta.site.seaLevelY}`)
  expect(meta.site.demError).toBeUndefined()
  expect(meta.site.seaLevelY).toBeLessThan(-100)
  await page.evaluate(() => window.__aphaia!.setManualClock(true))
  for (const [name, pose] of Object.entries(views(meta))) {
    await page.evaluate((p) => {
      window.__aphaia!.setCamera(p)
      window.__aphaia!.tick(1000 / 60)
    }, pose)
    await page.screenshot({ path: `screenshots/step3d/${name}.png` })
  }
})
