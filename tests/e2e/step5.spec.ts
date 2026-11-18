// Step 5 checkpoint screenshots (high tier, painted): the default start view, walk mode at the propylon
// spawn, walking inside the south peristyle and in the naos, and the HUD at 360 px in walk mode.
import { expect, test, type Page } from '@playwright/test'
import type {} from '../../src/app/test-hook'

async function open(page: Page, w: number, h: number) {
  await page.setViewportSize({ width: w, height: h })
  await page.goto('./?tier=high')
  await page.waitForFunction(() => window.__aphaia?.ready === true, undefined, { timeout: 120_000 })
  await page.evaluate(() => {
    window.__aphaia!.setManualClock(true)
    window.__aphaia!.tick(1000 / 60)
  })
}

const ticks = (page: Page, n: number) =>
  page.evaluate((k) => {
    for (let i = 0; i < k; i++) window.__aphaia!.tick(1000 / 60)
  }, n)

test('step 5 views', async ({ page }, info) => {
  test.setTimeout(240_000)
  const p = info.project.name
  await open(page, 1280, 800)
  await page.screenshot({ path: `screenshots/step5/start-${p}.png` })
  await page.locator('#hud-mode').click()
  await ticks(page, 90)
  expect((await page.evaluate(() => window.__aphaia!.getMode())).mode).toBe('walk')
  await page.screenshot({ path: `screenshots/step5/walk-propylon-${p}.png` })
  // South peristyle, looking west along the pteron.
  const m = await page.evaluate(() => window.__aphaia!.meta)
  const pteronZ = (m.cella.halfZ + m.peristyle.innerZ) / 2
  await page.evaluate((z) => window.__aphaia!.walk.place(13.4, z, Math.PI / 2, 0.1), pteronZ)
  await ticks(page, 2)
  await page.screenshot({ path: `screenshots/step5/walk-peristyle-${p}.png` })
  // Through the east door into the naos, looking west.
  await page.evaluate(() => window.__aphaia!.walk.place(9.5, 0, Math.PI / 2, 0.15))
  await page.keyboard.down('KeyW')
  await ticks(page, 120)
  await page.keyboard.up('KeyW')
  await ticks(page, 20)
  const s = await page.evaluate(() => window.__aphaia!.walk.state())
  expect(s.feet.x).toBeLessThan(6.5)
  await page.screenshot({ path: `screenshots/step5/walk-naos-${p}.png` })
})

test('HUD at 360 px in walk mode', async ({ page }, info) => {
  test.setTimeout(240_000)
  await open(page, 360, 780)
  await page.locator('#hud-mode').click()
  await ticks(page, 90)
  await page.screenshot({ path: `screenshots/step5/hud-360-walk-${info.project.name}.png` })
})
