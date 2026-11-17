// Step 3b checkpoint: sanctuary views (plain materials) set through window.__aphaia; cameras derive from
// TempleMeta (site extent, cella, stylobate) and the sanctuary features' positions in sanctuary.json.
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { TempleMeta } from '../../src/geometry/protocol'
import type {} from '../../src/app/test-hook'

const sanctuary = JSON.parse(readFileSync(new URL('../../src/data/sanctuary.json', import.meta.url), 'utf8'))

type Pose = { position: [number, number, number]; target: [number, number, number]; fov?: number }
const F = sanctuary.features as Record<string, { center?: [number, number] }>

function views(m: TempleMeta): Record<string, Pose> {
  const S = m.stylobate.top
  const b = m.site.bounds
  const cx = (b.minX + b.maxX) / 2
  const cz = (b.minZ + b.maxZ) / 2
  const altar = F.altar.center!
  const cistern = F.cistern.center!
  const prop = F.propylon.center!
  const terraces = sanctuary.terrain.terraces as Record<string, { polygon: [number, number][]; level: { value: number } }>
  const sued = terraces['suedbau-terrace']
  const sx = sued.polygon.reduce((a, p) => a + p[0], 0) / sued.polygon.length
  const sz = sued.polygon.reduce((a, p) => a + p[1], 0) / sued.polygon.length
  const sy = S + sued.level.value
  const outerY = S + terraces['outer-terrace'].level.value
  return {
    'site-overview-se': { position: [cx + 95, 70, cz + 95], target: [cx - 2, -4, cz - 8], fov: 45 },
    'axis-altar-ramp-temple': { position: [altar[0] + 9, S + 3.2, altar[1] + 3], target: [0, S + 3, 0], fov: 55 },
    'cistern-closeup': { position: [cistern[0] - 4.5, S + 3.5, cistern[1] + 5.5], target: [cistern[0] - 1.2, S - 1.2, cistern[1] - 0.3], fov: 50 },
    'propylon-approach': { position: [prop[0] + 1.5, outerY + 1.6, prop[1] + 17], target: [prop[0], outerY + 2.6, prop[1]], fov: 60 },
    'site-plan-top': { position: [cx, 230, cz + 0.01], target: [cx, 0, cz], fov: 40 },
    'from-suedbau-up': { position: [sx - 4, sy + 1.6, sz + 1.5], target: [sx + 4, S + 4, 5], fov: 65 },
  }
}

test('step 3b sanctuary checkpoint views', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('./?tier=high')
  await page.waitForFunction(() => window.__aphaia?.ready === true, undefined, { timeout: 120_000 })
  const meta = (await page.evaluate(() => window.__aphaia!.meta)) as TempleMeta
  const stats = await page.evaluate(() => window.__aphaia!.stats())
  console.log(`[site] ${JSON.stringify(stats)}`)
  expect(meta.site.features.length).toBeGreaterThan(0)
  await page.evaluate(() => window.__aphaia!.setManualClock(true))
  for (const [name, pose] of Object.entries(views(meta))) {
    await page.evaluate((p) => {
      window.__aphaia!.setCamera(p)
      window.__aphaia!.tick(1000 / 60)
    }, pose)
    await page.screenshot({ path: `screenshots/step3b/${name}.png` })
  }
})
