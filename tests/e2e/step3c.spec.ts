// Step 3c checkpoint: real DEM terrain + sea, the gap fix and the Ministry board findings, high tier, plain
// materials; plus per-tier triangle counts and Worker timings (logged). Writes screenshots/step3c/.
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
  const [px, pz] = F.propylon.center
  const front = pz + F.propylon.width!.value / 2 // south face of the propylon (stair foot beyond it)
  const [cx, cz] = F.cistern.center
  const [hx, hz] = [45.5, 31.8] // the priests' houses on their outcrop
  return {
    'wide-hill-sea': { position: [420, 260, 520], target: [0, -40, 0], fov: 45 },
    // Eye 1.6 m above the plaza south of the gate: the enclosure parapet should hide the krepis.
    'south-approach-propylon': { position: [px + 2, outerY + 1.6, front + 16], target: [px - 6, outerY + 2.2, 0], fov: 60 },
    'ne-aerial-cistern-sphinx-altar': { position: [cx + 22, terraceY + 26, cz - 30], target: [cx + 2, terraceY, cz + 18], fov: 55 },
    'propylon-stair-closeup': { position: [px + 7, outerY + 1.2, front + 3.5], target: [px + 2, outerY + 0.4, front + 0.6], fov: 55 },
    'priests-houses': { position: [hx - 26, outerY + 6, hz + 12], target: [hx - 2, outerY + 1.5, hz - 8], fov: 55 },
    // The user-reported gap: the east end of the propylon's south flight, seen low from the east.
    'old-gap-location': { position: [px + 6.7, outerY + 1.4, front + 1.3], target: [px, outerY + 0.2, front + 0.5], fov: 50 },
  }
}

test('step 3c checkpoint', async ({ page }) => {
  test.setTimeout(300_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const tier of ['low', 'med'] as const) {
    await page.goto(`./?tier=${tier}`)
    await page.waitForFunction(() => window.__aphaia?.ready === true, undefined, { timeout: 120_000 })
    console.log(`[step3c ${tier}] ${JSON.stringify(await page.evaluate(() => window.__aphaia!.stats()))}`)
  }
  await page.goto('./?tier=high')
  await page.waitForFunction(() => window.__aphaia?.ready === true, undefined, { timeout: 120_000 })
  const meta = (await page.evaluate(() => window.__aphaia!.meta)) as TempleMeta
  console.log(`[step3c high] ${JSON.stringify(await page.evaluate(() => window.__aphaia!.stats()))}`)
  console.log(`[step3c] demLoadMs ${meta.site.demLoadMs.toFixed(0)} demError ${meta.site.demError ?? 'none'} sea ${meta.site.seaLevelY}`)
  expect(meta.site.demError).toBeUndefined()
  expect(meta.site.seaLevelY).toBeLessThan(-100)
  await page.evaluate(() => window.__aphaia!.setManualClock(true))
  for (const [name, pose] of Object.entries(views(meta))) {
    await page.evaluate((p) => {
      window.__aphaia!.setCamera(p)
      window.__aphaia!.tick(1000 / 60)
    }, pose)
    await page.screenshot({ path: `screenshots/step3c/${name}.png` })
  }
})
