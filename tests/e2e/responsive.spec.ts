// Responsive HUD (plan Step 5 / AC12): 360, 390, 768, 1280 and 1920 px wide, orbit and walk, help open.
// Every visible interactive element is at least 44 x 44 px, nothing overlaps the toolbar, there is no
// horizontal scroll. Screenshots go to screenshots/step5/.
import { expect, test, type Page } from '@playwright/test'
import type {} from '../../src/app/test-hook'

const SIZES: [number, number][] = [
  [360, 780],
  [390, 844],
  [768, 1024],
  [1280, 800],
  [1920, 1080],
]

const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [role="application"], [tabindex]:not([tabindex="-1"])'

async function audit(page: Page, label: string) {
  const res = await page.evaluate((sel) => {
    const small: string[] = []
    const boxes: { id: string; r: DOMRect }[] = []
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || el.closest('[hidden]')) continue
      const id = el.id || el.className || el.tagName
      if (r.width < 44 - 0.5 || r.height < 44 - 0.5) small.push(`${id} ${r.width.toFixed(1)}x${r.height.toFixed(1)}`)
      if (r.left < -0.5 || r.right > innerWidth + 0.5 || r.top < -0.5 || r.bottom > innerHeight + 0.5) small.push(`${id} off-screen`)
      boxes.push({ id, r })
    }
    const overlaps: string[] = []
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].r
        const b = boxes[j].r
        if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5)
          overlaps.push(`${boxes[i].id} / ${boxes[j].id}`)
      }
    // The hint is not interactive but must not cover the joystick.
    const hint = document.querySelector('.hud-hint')?.getBoundingClientRect()
    const pad = document.querySelector<HTMLElement>('.hud-joystick')
    if (hint && pad && !pad.hidden) {
      const b = pad.getBoundingClientRect()
      if (hint.left < b.right && b.left < hint.right && hint.top < b.bottom && b.top < hint.bottom) overlaps.push('hud-hint / joystick')
    }
    return {
      small,
      overlaps,
      scrollX: document.documentElement.scrollWidth - innerWidth,
      count: boxes.length,
    }
  }, INTERACTIVE)
  expect(res.small, label).toEqual([])
  expect(res.overlaps, label).toEqual([])
  expect(res.scrollX, label).toBeLessThanOrEqual(0)
  expect(res.count, label).toBeGreaterThanOrEqual(3)
}

for (const [w, h] of SIZES) {
  test(`HUD at ${w} px: targets >= 44 px, no overlap, no horizontal scroll`, async ({ page }, info) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: w, height: h })
    await page.goto('./?tier=low')
    await page.waitForFunction(() => window.__aphaia?.ready === true, undefined, { timeout: 120_000 })
    await page.evaluate(() => {
      window.__aphaia!.setManualClock(true)
      window.__aphaia!.tick(1000 / 60)
    })
    await expect(page.locator('#hud-mode')).toBeVisible()
    await audit(page, `${w} orbit`)
    await page.screenshot({ path: `screenshots/step5/responsive-${w}-orbit-${info.project.name}.png` })

    await page.locator('#hud-mode').click()
    await page.evaluate(() => {
      for (let i = 0; i < 90; i++) window.__aphaia!.tick(1000 / 60)
    })
    await audit(page, `${w} walk`)
    await page.screenshot({ path: `screenshots/step5/responsive-${w}-walk-${info.project.name}.png` })

    await page.locator('#hud-help-btn').click()
    await expect(page.locator('#hud-help')).toBeVisible()
    const help = (await page.locator('#hud-help').boundingBox())!
    expect(help.x).toBeGreaterThanOrEqual(0)
    expect(help.x + help.width).toBeLessThanOrEqual(w)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
    await page.screenshot({ path: `screenshots/step5/responsive-${w}-help-${info.project.name}.png` })
    await page.keyboard.press('Escape')
    await expect(page.locator('#hud-help')).toBeHidden()
  })
}
