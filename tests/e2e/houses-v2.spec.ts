// Priests' houses blockout (v2) against the Ministry boards (reference only; the photos are not in the repo):
// (a) the aerial from the north-east (IMG_8187, the houses top left), (b) the approach view (IMG_8191, the houses on
// the right). Writes screenshots/houses-v2/ (high tier); the side-by-side composites stay local (refs/).
import { expect, test } from '@playwright/test'
import type {} from '../../src/app/test-hook'

type Pose = { position: [number, number, number]; target: [number, number, number]; fov?: number }
const VIEWS: Record<string, Pose> = {
  // IMG_8187's camera (as boards-compare a-aerial-ne), rendered large so the houses can be cropped.
  'a-aerial-ne': { position: [37, 34, -56], target: [29, -2, 6], fov: 42 },
  'a-aerial-ne-houses': { position: [37, 34, -56], target: [41, 0, 26], fov: 16 },
  // IMG_8191's right side: from the south-west, below the outcrop.
  'b-approach-houses': { position: [24, 0.2, 62], target: [42, 1.0, 30], fov: 40 },
}

test('priests houses v2 views', async ({ page }) => {
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
    await page.screenshot({ path: `screenshots/houses-v2/${name}.png` })
  }
})
