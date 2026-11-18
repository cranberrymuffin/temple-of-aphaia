// Orbit <-> walk transition (plan Step 5 C3 / AC9) on the real camera with the manual clock:
// (a) monotonic progress toward the end pose; (b) max per-step displacement <= 2.5x the mean step;
// (c) no velocity discontinuity, |v[i+1] - v[i]| <= 0.2 x max v at every step including the first and last;
// (d) done within 1.5 s of simulated time (<= 90 ticks); (e) the first control-driven frame after it equals
// the end pose within 1 mm.
import { expect, test, type Page } from '@playwright/test'
import type {} from '../../src/app/test-hook'

type V3 = [number, number, number]
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const DT = 1000 / 60

async function sample(page: Page, to: 'walk' | 'orbit') {
  return page.evaluate(
    ({ to, dt }) => {
      const h = window.__aphaia!
      const pts: [number, number, number][] = [h.getCamera().position]
      h.setMode(to)
      let ticks = 0
      while (h.getMode().transitioning && ticks < 200) {
        h.tick(dt)
        pts.push(h.getCamera().position)
        ticks++
      }
      const end = h.getCamera().position
      h.tick(dt) // first control-driven frame
      const after = h.getCamera().position
      return { pts, ticks, end, after, mode: h.getMode().mode }
    },
    { to, dt: DT },
  )
}

function check(r: Awaited<ReturnType<typeof sample>>) {
  const { pts, ticks, end, after } = r
  expect(ticks).toBeGreaterThan(10)
  expect(ticks).toBeLessThanOrEqual(90)
  const toEnd = pts.map((p) => dist(p, end))
  for (let i = 1; i < toEnd.length; i++) expect(toEnd[i], `step ${i}`).toBeLessThanOrEqual(toEnd[i - 1] + 1e-6)
  const steps = pts.slice(1).map((p, i) => dist(p, pts[i]))
  const mean = steps.reduce((s, x) => s + x, 0) / steps.length
  const max = Math.max(...steps)
  expect(max).toBeLessThanOrEqual(2.5 * mean)
  const v = [0, ...steps, 0]
  for (let i = 1; i < v.length; i++) expect(Math.abs(v[i] - v[i - 1]), `velocity jump at ${i}`).toBeLessThanOrEqual(0.2 * max)
  expect(dist(after, end)).toBeLessThanOrEqual(0.001)
  return { ticks, mean, max }
}

test('orbit -> walk -> orbit: smooth, monotonic, <= 1.5 s, no hand-over jump', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('./?tier=low')
  await page.waitForFunction(() => window.__aphaia?.ready === true, undefined, { timeout: 120_000 })
  await page.evaluate(() => {
    window.__aphaia!.setManualClock(true)
    window.__aphaia!.tick(1000 / 60)
  })
  const start = (await page.evaluate(() => window.__aphaia!.getCamera())).position
  const w = await sample(page, 'walk')
  expect(w.mode).toBe('walk')
  const a = check(w)
  const o = await sample(page, 'orbit')
  expect(o.mode).toBe('orbit')
  const b = check(o)
  // Back where orbit left off.
  expect(dist(o.end, start)).toBeLessThan(1e-3)
  console.log(`[transition] to walk ${JSON.stringify(a)}; to orbit ${JSON.stringify(b)}`)
})

test('input is ignored while the transition runs', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('./?tier=low')
  await page.waitForFunction(() => window.__aphaia?.ready === true, undefined, { timeout: 120_000 })
  await page.evaluate(() => window.__aphaia!.setManualClock(true))
  await page.evaluate(() => {
    window.__aphaia!.setMode('walk')
    for (let i = 0; i < 20; i++) window.__aphaia!.tick(1000 / 60)
  })
  await expect(page.locator('#hud-mode')).toBeDisabled()
  const before = await page.evaluate(() => window.__aphaia!.walk.state())
  await page.keyboard.down('KeyW')
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) window.__aphaia!.tick(1000 / 60)
  })
  await page.keyboard.up('KeyW')
  const s = await page.evaluate(() => window.__aphaia!.walk.state())
  expect(s.feet).toEqual(before.feet)
})
