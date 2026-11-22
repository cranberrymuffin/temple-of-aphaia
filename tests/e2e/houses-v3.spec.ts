// Priests' houses blockout (v2) against the Ministry boards (reference only; the photos are not in the repo):
// (a) the aerial from the north-east (IMG_8187, the houses top left), (b) the approach view (IMG_8191, the houses on
// the right). Writes screenshots/houses-v3/ (high tier); the side-by-side composites stay local (refs/).
import { expect, test } from '@playwright/test'
import type {} from '../../src/app/test-hook'

type Pose = { position: [number, number, number]; target: [number, number, number]; fov?: number }
const VIEWS: Record<string, Pose> = {
  'j-inside-rear': { position: [38.2, 1.6, 26.5], target: [46, 1.4, 22.5], fov: 70 },
  'k-inside-bath': { position: [38.0, 1.6, 22.0], target: [36.4, 0.3, 24.6], fov: 70 },
  'l-aerial-houses': { position: [44, 28, 4], target: [43, 0, 26], fov: 35 },
  'i-door': { position: [38, 3, 6], target: [42, 2, 24], fov: 50 },
  'h-inside-wall': { position: [28, 7, 8], target: [42, 3, 24], fov: 50 },
  'f-statues': { position: [24, 5, -9], target: [31, 1, 0], fov: 40 },
  'g-archer': { position: [-30, 12, 4], target: [-21, 11, 0], fov: 25 },
  'c-user-view': { position: [20, 14, 78], target: [32, 2, 28], fov: 45 },
  'd-houses-front': { position: [18, 3, 48], target: [38, 2, 30], fov: 40 },
  'e-aerial': { position: [37, 34, -56], target: [41, 0, 26], fov: 16 },
}

test('priests houses v3 views', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1200, height: 900 })
  await page.goto('./?tier=high')
  await page.waitForFunction(() => window.__aphaia?.ready === true, undefined, { timeout: 120_000 })
  expect(await page.evaluate(() => window.__aphaia!.meta.site.demError)).toBeUndefined()
  await page.evaluate(() => window.__aphaia!.setManualClock(true))
  await page.waitForFunction(() => (window as unknown as { __aphaiaSculptures?: { state: string } }).__aphaiaSculptures?.state === 'done', undefined, { timeout: 60_000 })
  console.log(JSON.stringify(await page.evaluate(() => (window as unknown as { __aphaiaSculptures: unknown }).__aphaiaSculptures)))
  for (const [name, pose] of Object.entries(VIEWS)) {
    await page.evaluate((p) => {
      window.__aphaia!.setCamera(p)
      window.__aphaia!.tick(1000 / 60)
    }, pose)
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `screenshots/houses-v3/${name}.png` })
  }
})
