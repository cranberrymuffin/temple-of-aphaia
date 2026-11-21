// Cameras approximating the Ministry on-site boards (reference only; the photos are not in the repo): (a) the aerial
// "area in front of the temple about 490 BC" from the north-east, (b) the elevation-like view from the approach.
// Writes screenshots/boards-compare/ (high tier). Side-by-side composites with the photos stay local (refs/).
import { expect, test } from '@playwright/test'
import type {} from '../../src/app/test-hook'

type Pose = { position: [number, number, number]; target: [number, number, number]; fov?: number }
const VIEWS: Record<string, Pose> = {
  'a-aerial-ne': { position: [37, 34, -56], target: [29, -2, 6], fov: 42 },
  'b-approach-elevation': { position: [17, 3, 140], target: [17, 4, 0], fov: 22 },
  'c-propylon-stair': { position: [13, -1.5, 40], target: [23.3, -1.6, 26], fov: 55 },
  // The priests' houses: from the plaza (IMG_8191's right side), and their porch close up.
  'd-houses-from-plaza': { position: [24, 0, 44], target: [44, 1, 30], fov: 50 },
  'e-houses-porch': { position: [35.6, 1.6, 34.5], target: [41.5, 1.8, 32], fov: 60 },
}

test('board comparison views', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1200, height: 900 })
  await page.goto('./?tier=high')
  await page.waitForFunction(() => window.__aphaia?.ready === true, undefined, { timeout: 120_000 })
  expect(await page.evaluate(() => window.__aphaia!.meta.site.demError)).toBeUndefined()
  await page.evaluate(() => window.__aphaia!.setManualClock(true))
  for (const [name, pose] of Object.entries(VIEWS)) {
    await page.evaluate((p) => {
      window.__aphaia!.setCamera(p)
      window.__aphaia!.tick(1000 / 60)
    }, pose)
    await page.screenshot({ path: `screenshots/boards-compare/${name}.png` })
  }
})
