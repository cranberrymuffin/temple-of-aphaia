// Walk mode up the propylon's grand stair (Ministry approach board): from the plaza 4 m below the terrace, over
// the landing, into the propylon at terrace height. Feet only ever rise (no snag, no drop) on the way up.
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type {} from '../../src/app/test-hook'

const sanctuary = JSON.parse(readFileSync(new URL('../../src/data/sanctuary.json', import.meta.url), 'utf8'))
test.describe.configure({ timeout: 240_000 })

const tick = (page: Page, n: number) =>
  page.evaluate((k) => {
    for (let i = 0; i < k; i++) window.__aphaia!.tick(1000 / 60)
  }, n)

test('walk up the propylon stair', async ({ page }) => {
  await page.goto('./?tier=low')
  await page.waitForFunction(() => window.__aphaia?.ready === true, undefined, { timeout: 120_000 })
  await page.evaluate(() => window.__aphaia!.setManualClock(true))
  await page.evaluate(() => window.__aphaia!.setMode('walk'))
  await tick(page, 90)
  const S = (await page.evaluate(() => window.__aphaia!.meta.stylobate.top)) as number
  const plazaY = S + sanctuary.terrain.terraces['outer-terrace'].level.value
  const floorY = S + sanctuary.features.propylon.baseLevel
  const [px, pz] = sanctuary.features.propylon.center as [number, number]
  const front = pz + sanctuary.features.propylon.width.value / 2
  await page.evaluate(([x, z]) => window.__aphaia!.walk.place(x, z, 0, 0), [px, front + 8])
  await tick(page, 2)
  const start = (await page.evaluate(() => window.__aphaia!.walk.state())).feet
  expect(start.y).toBeCloseTo(plazaY, 1)
  await page.evaluate(() => window.__aphaia!.walk.setJoystick(0, 1))
  const ys: number[] = [start.y]
  let feet = start
  for (let i = 0; i < 40 && feet.z > pz; i++) {
    await tick(page, 15)
    feet = (await page.evaluate(() => window.__aphaia!.walk.state())).feet
    ys.push(feet.y)
  }
  await page.evaluate(() => window.__aphaia!.walk.setJoystick(0, 0))
  console.log(`[stair] climbed ${(feet.y - start.y).toFixed(2)} m to z ${feet.z.toFixed(2)}; heights ${ys.map((y) => y.toFixed(2)).join(' ')}`)
  expect(feet.z).toBeLessThan(front - 1) // inside the propylon
  expect(feet.y).toBeCloseTo(floorY, 1)
  for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1] - 0.01)
  expect(Math.abs(feet.x - px)).toBeLessThan(0.5) // went straight up the middle
})
