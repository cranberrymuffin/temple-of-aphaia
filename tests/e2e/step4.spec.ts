// Step 4: painted temple and sanctuary, pediment stand-ins, and the About & Sources panel.
// Writes screenshots/step4/ (front 3/4, east front close-up, NE aerial, propylon approach, About panel on
// desktop and at 360 px) and checks the panel's required texts and keyboard behaviour.
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { TempleMeta } from '../../src/geometry/protocol'
import type {} from '../../src/app/test-hook'

const sanctuary = JSON.parse(readFileSync(new URL('../../src/data/sanctuary.json', import.meta.url), 'utf8'))
const landscape = JSON.parse(readFileSync(new URL('../../measurements/landscape.json', import.meta.url), 'utf8'))
type Pose = { position: [number, number, number]; target: [number, number, number]; fov?: number }
const F = sanctuary.features as Record<string, { center: [number, number]; width?: { value: number } }>

function views(m: TempleMeta): Record<string, Pose> {
  const S = m.stylobate.top
  const b = m.bounds
  const P = { baseY: 8.09, apexY: 9.85 }
  const terraceY = S + sanctuary.terrain.terraces['temple-terrace'].level.value
  const outerY = S + sanctuary.terrain.terraces['outer-terrace'].level.value
  const [px, pz] = F.propylon.center
  const front = pz + F.propylon.width!.value / 2
  return {
    'front-34': { position: [b.maxX + 22, S + 11, b.maxZ + 20], target: [0, S + 4, 0], fov: 50 },
    'east-pediment-closeup': { position: [b.maxX + 13, P.baseY - 1.5, 2.5], target: [b.maxX - 0.5, (P.baseY + P.apexY) / 2 - 0.2, 0], fov: 50 },
    'ne-aerial': { position: [b.maxX + 55, terraceY + 42, b.minZ - 50], target: [0, terraceY, 0], fov: 50 },
    'propylon-approach': { position: [px + 2, outerY + 1.6, front + 16], target: [px - 6, outerY + 2.2, 0], fov: 60 },
  }
}

async function load(page: Page, tier = 'high') {
  await page.goto(`./?tier=${tier}`)
  await page.waitForFunction(() => window.__aphaia?.ready === true, undefined, { timeout: 120_000 })
}

test.describe('step 4', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop project only (viewports set explicitly)')

  test('painted views', async ({ page }) => {
    test.setTimeout(240_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await load(page)
    const meta = (await page.evaluate(() => window.__aphaia!.meta)) as TempleMeta
    console.log(`[step4 high] ${JSON.stringify(await page.evaluate(() => window.__aphaia!.stats()))}`)
    const stats = await page.evaluate(() => window.__aphaia!.stats())
    expect(stats.drawCalls).toBeLessThanOrEqual(10)
    await page.evaluate(() => window.__aphaia!.setManualClock(true))
    for (const [name, pose] of Object.entries(views(meta))) {
      await page.evaluate((p) => {
        window.__aphaia!.setCamera(p)
        window.__aphaia!.tick(1000 / 60)
      }, pose)
      await page.screenshot({ path: `screenshots/step4/${name}.png` })
    }
  })

  test('About & Sources panel: required texts, keyboard, desktop and 360 px', async ({ page }) => {
    test.setTimeout(240_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await load(page, 'low')
    const button = page.locator('#about-button')
    await expect(button).toBeVisible()
    const box = await button.boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(44)
    expect(box!.height).toBeGreaterThanOrEqual(44)
    await button.click()
    const panel = page.locator('#about-panel')
    await expect(panel).toBeVisible()
    await expect(page.locator('.about-close')).toBeFocused()
    for (const t of [
      'distinguished by the very good preservation of the Late Archaic temple',
      'In Aegina, as you go towards the mountain of Zeus',
      'Creative Commons Attribution-ShareAlike 3.0 United States License',
      landscape.attribution,
      landscape.liability,
      '© OpenStreetMap contributors, ODbL',
      'Bibi Saint-Pol',
      'The scan verifies proportions; absolute size is anchored to published values.',
      'Trojan archer (identified as Paris by some)',
    ])
      await expect(panel).toContainText(t)
    await expect(panel.locator('summary', { hasText: /Hidden features \(\d+\)/ })).toBeVisible()
    await page.screenshot({ path: 'screenshots/step4/about-desktop.png' })
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(button).toBeFocused()

    await page.setViewportSize({ width: 360, height: 780 })
    await button.click()
    await expect(panel).toBeVisible()
    const pb = await panel.boundingBox()
    expect(pb!.width).toBeLessThanOrEqual(360)
    const close = await page.locator('.about-close').boundingBox()
    expect(close!.height).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
    await page.screenshot({ path: 'screenshots/step4/about-360.png' })
    await page.locator('#about-sources-h').scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'screenshots/step4/about-360-sources.png' })
  })
})
