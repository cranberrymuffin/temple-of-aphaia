// Scanned sculptures: lazy loading after the first view, both pediments, the cult statue in the cella (walk
// mode at eye height) and the About credits. Writes screenshots/statues/.
import { expect, test, type Page } from '@playwright/test'
import type { TempleMeta } from '../../src/geometry/protocol'
import type {} from '../../src/app/test-hook'
import type { SculptureStatus } from '../../src/app/sculptures'

declare global {
  interface Window {
    __aphaiaSculptures?: SculptureStatus
  }
}

async function load(page: Page, tier: string) {
  const glb: { url: string; t: number }[] = []
  page.on('request', (r) => {
    if (r.url().endsWith('.glb')) glb.push({ url: r.url(), t: Date.now() })
  })
  const t0 = Date.now()
  await page.goto(`./?tier=${tier}`)
  await page.waitForFunction(() => window.__aphaia?.ready === true, undefined, { timeout: 120_000 })
  const ready = Date.now()
  await page.waitForFunction(() => window.__aphaiaSculptures?.state === 'done', undefined, { timeout: 120_000 })
  const status = (await page.evaluate(() => window.__aphaiaSculptures)) as SculptureStatus
  return { readyMs: ready - t0, glb, ready, status }
}

test.describe('scanned sculptures', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop project only')

  test('lazy after the first view; pediments, cella statue and credits', async ({ page }) => {
    test.setTimeout(300_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    const r = await load(page, 'high')
    console.log(`[statues] ready ${r.readyMs} ms; sculptures ${r.status.loaded.length} loaded, ${r.status.failed.length} failed, ${(r.status.bytes / 1024).toFixed(0)} KB, ${r.status.ms.toFixed(0)} ms after start`)
    // No sculpture request before the first interactive view.
    for (const g of r.glb) expect(g.t, g.url).toBeGreaterThanOrEqual(r.ready - 50)
    expect(r.status.failed).toEqual([])
    expect(r.status.loaded.length).toBe(14)
    expect(r.status.bytes).toBeLessThan(1.5 * 1024 * 1024)
    const stats = await page.evaluate(() => window.__aphaia!.stats())
    expect(stats.drawCalls).toBeLessThanOrEqual(10)

    const meta = (await page.evaluate(() => window.__aphaia!.meta)) as TempleMeta
    const F = meta.sculpture.field
    const mid = (F.baseY + F.apexY) / 2
    await page.evaluate(() => window.__aphaia!.setManualClock(true))
    const shots: Record<string, { position: [number, number, number]; target: [number, number, number]; fov: number }> = {
      'west-pediment': { position: [-F.outerX - 12, F.baseY - 1, 0], target: [-F.outerX, mid - 0.3, 0], fov: 55 },
      'east-pediment': { position: [F.outerX + 12, F.baseY - 1, 0], target: [F.outerX, mid - 0.3, 0], fov: 55 },
      'west-pediment-left-half': { position: [-F.outerX - 6, F.baseY - 0.6, -3.5], target: [-F.outerX, mid - 0.4, -3.5], fov: 50 },
      'east-pediment-right-half': { position: [F.outerX + 6, F.baseY - 0.6, -3.5], target: [F.outerX, mid - 0.4, -3.5], fov: 50 },
      'front-34': { position: [F.outerX + 22, 12, 20], target: [0, 5, 0], fov: 50 },
    }
    for (const [name, pose] of Object.entries(shots)) {
      await page.evaluate((p) => {
        window.__aphaia!.setCamera(p)
        window.__aphaia!.tick(1000 / 60)
      }, pose)
      await page.screenshot({ path: `screenshots/statues/${name}.png` })
    }

    // Cella, walk mode at eye height, looking west at the cult statue from inside the door.
    const c = meta.cella
    await page.evaluate(() => window.__aphaia!.setMode('walk'))
    for (let i = 0; i < 120; i++) await page.evaluate(() => window.__aphaia!.tick(1000 / 60))
    await page.evaluate((x) => window.__aphaia!.walk.place(x, 0, Math.PI / 2, 0), c.eastWallX[0] - 1.2)
    await page.evaluate(() => window.__aphaia!.tick(1000 / 60))
    await page.screenshot({ path: 'screenshots/statues/cella-walk-west.png' })
    const eye = await page.evaluate(() => window.__aphaia!.getCamera())
    expect(eye.position[1] - c.floorY).toBeGreaterThan(1.4)

    await page.evaluate(() => window.__aphaia!.setMode('orbit'))
    for (let i = 0; i < 120; i++) await page.evaluate(() => window.__aphaia!.tick(1000 / 60))
    await page.locator('#about-button').click()
    const panel = page.locator('#about-panel')
    await expect(panel).toContainText("Some figures are scans of casts showing Bertel Thorvaldsen's 1816–17 restorations")
    await expect(panel).toContainText("A comparable Late Archaic statue standing in for Aphaia's lost cult image")
    await page.locator('#about-sculptures-h').scrollIntoViewIfNeeded()
    await page.locator('#about-sculptures summary', { hasText: 'Scanned figures' }).click()
    await page.screenshot({ path: 'screenshots/statues/about-credits.png' })
  })
})
