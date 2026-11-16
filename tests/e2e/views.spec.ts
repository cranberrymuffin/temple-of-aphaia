// Unpainted geometry screenshots: 8 fixed cameras set through window.__aphaia (plan Step 3).
// Cameras derive from the generator's TempleMeta, so they follow dimensions.json.
import { expect, test } from '@playwright/test'
import type { TempleMeta } from '../../src/geometry/protocol'
import type {} from '../../src/app/test-hook'

type Pose = { position: [number, number, number]; target: [number, number, number]; fov?: number }

export function views(m: TempleMeta): Record<string, Pose> {
  const b = m.bounds
  const S = m.stylobate.top
  const c = m.cella
  // Mid-way between the cella wall and the flank columns' inner faces.
  const pteronZ = (c.halfZ + m.peristyle.innerZ) / 2
  return {
    'front-34': { position: [b.maxX * 1.25, b.maxY * 1.15, b.maxZ * 2.3], target: [0, b.maxY * 0.35, 0] },
    east: { position: [b.maxX + 32, S + 5, 0], target: [0, b.maxY * 0.45, 0] },
    south: { position: [0, S + 5, b.maxZ + 38], target: [0, b.maxY * 0.45, 0] },
    top: { position: [0, b.maxY + 62, 0.01], target: [0, 0, 0] },
    'west-34': { position: [-b.maxX * 1.25, b.maxY * 1.0, -b.maxZ * 2.3], target: [0, b.maxY * 0.35, 0] },
    peristyle: { position: [m.stylobate.halfX - 2, S + 1.6, pteronZ], target: [-m.stylobate.halfX, S + 2.6, pteronZ], fov: 65 },
    pronaos: { position: [m.stylobate.halfX - 0.8, S + 1.6, 0.6], target: [c.eastWallX[1], S + 2, 0], fov: 65 },
    naos: { position: [c.eastWallX[0] - 0.8, c.floorY + 1.6, 0], target: [c.westWallX[1], c.floorY + 3.2, 0], fov: 65 },
  }
}

for (const tier of ['low', 'high'] as const) {
  test(`8 fixed views, ${tier} tier`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`./?tier=${tier}`)
    await page.waitForFunction(() => window.__aphaia?.ready === true, undefined, { timeout: 60_000 })
    const meta = (await page.evaluate(() => window.__aphaia!.meta)) as TempleMeta
    const stats = await page.evaluate(() => window.__aphaia!.stats())
    expect(stats.tier).toBe(tier)
    expect(stats.drawCalls).toBeLessThanOrEqual(10)
    console.log(`[views] ${tier}: ${JSON.stringify(stats)}`)
    await page.evaluate(() => window.__aphaia!.setManualClock(true))
    for (const [name, pose] of Object.entries(views(meta))) {
      await page.evaluate((p) => {
        window.__aphaia!.setCamera(p)
        window.__aphaia!.tick(1000 / 60)
      }, pose)
      await page.screenshot({ path: `screenshots/step3/${name}-${tier}.png` })
    }
  })
}
