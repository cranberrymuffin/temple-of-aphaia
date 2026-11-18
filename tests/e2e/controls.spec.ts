// Orbit and walk controls (plan Step 5, AC7/AC8), on the desktop and Pixel-class projects: mouse drag,
// wheel and right-drag; two-finger pinch and pan through CDP Input.dispatchTouchEvent; the ground clamp and
// the bbox minimum distance; walk eye height, WASD, the joystick, collision with a column; mouse-look
// through __aphaia.walk.applyLook (not real Pointer Lock). The app clock is manual throughout.
import { expect, test, type Page } from '@playwright/test'
import type { TempleMeta } from '../../src/geometry/protocol'
import type {} from '../../src/app/test-hook'

type V3 = [number, number, number]
// Every manual tick renders a frame; headless software GL makes long walks slow.
test.describe.configure({ timeout: 240_000 })
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

async function open(page: Page): Promise<TempleMeta> {
  await page.goto('./?tier=low')
  await page.waitForFunction(() => window.__aphaia?.ready === true, undefined, { timeout: 120_000 })
  await page.evaluate(() => {
    window.__aphaia!.setManualClock(true)
    window.__aphaia!.tick(1000 / 60)
  })
  return (await page.evaluate(() => window.__aphaia!.meta)) as TempleMeta
}

const tick = (page: Page, n: number) =>
  page.evaluate((k) => {
    for (let i = 0; i < k; i++) window.__aphaia!.tick(1000 / 60)
  }, n)
const cam = (page: Page) => page.evaluate(() => window.__aphaia!.getCamera())

async function toWalk(page: Page) {
  await page.evaluate(() => window.__aphaia!.setMode('walk'))
  await tick(page, 90)
  expect((await page.evaluate(() => window.__aphaia!.getMode())).mode).toBe('walk')
}

/** Canvas centre in CSS px. */
async function centre(page: Page) {
  const b = (await page.locator('#app canvas').boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height }
}

async function touch(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number }[]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id })) })
  return { cdp, send }
}

test.describe('orbit', () => {
  test('mouse drag orbits, wheel zooms, right-drag pans', async ({ page }) => {
    await open(page)
    const c = await centre(page)
    const a = await cam(page)
    await page.mouse.move(c.x, c.y)
    await page.mouse.down()
    for (let i = 1; i <= 10; i++) await page.mouse.move(c.x + i * 15, c.y)
    await page.mouse.up()
    await tick(page, 60)
    const b = await cam(page)
    expect(dist(a.position, b.position)).toBeGreaterThan(1)
    expect(dist(b.target, a.target)).toBeLessThan(1e-6)
    expect(Math.abs(dist(b.position, b.target) - dist(a.position, a.target))).toBeLessThan(0.05)

    await page.mouse.move(c.x, c.y)
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -200)
    await tick(page, 60)
    const z = await cam(page)
    expect(dist(z.position, z.target)).toBeLessThan(dist(b.position, b.target) - 1)

    await page.mouse.move(c.x, c.y)
    await page.mouse.down({ button: 'right' })
    for (let i = 1; i <= 10; i++) await page.mouse.move(c.x + i * 12, c.y + i * 4)
    await page.mouse.up({ button: 'right' })
    await tick(page, 60)
    const p = await cam(page)
    expect(dist(p.target, z.target)).toBeGreaterThan(0.5)
  })

  test('an aggressive downward drag keeps the camera above the ground, the polar limit holds', async ({ page }) => {
    await open(page)
    const c = await centre(page)
    for (let round = 0; round < 3; round++) {
      await page.mouse.move(c.x, c.y - c.h * 0.4)
      await page.mouse.down()
      for (let i = 1; i <= 12; i++) await page.mouse.move(c.x, c.y - c.h * 0.4 + (i * c.h * 0.8) / 12)
      await page.mouse.up()
      await tick(page, 45)
      const k = await cam(page)
      const g = await page.evaluate(([x, z]) => window.__aphaia!.ground(x, z), [k.position[0], k.position[2]])
      expect(k.position[1]).toBeGreaterThanOrEqual(g + 0.3)
      // Never below the target's horizon (polar <= pi/2 - 0.05).
      const d = dist(k.position, k.target)
      expect((k.position[1] - k.target[1]) / d).toBeGreaterThanOrEqual(Math.cos(Math.PI / 2 - 0.05) - 1e-3)
    }
  })

  test('zooming in cannot enter the temple box (bbox-derived minimum distance)', async ({ page }) => {
    const m = await open(page)
    const c = await centre(page)
    await page.evaluate((b) => {
      window.__aphaia!.setCamera({ position: [b.maxX + 20, b.maxY + 4, 10], target: [0, 4, 0] })
    }, m.bounds)
    // Interact so the limits engage, then zoom in hard.
    await page.mouse.move(c.x, c.y)
    for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -400)
    await tick(page, 120)
    const k = await cam(page)
    const b = m.bounds
    const inside = k.position[0] > b.minX && k.position[0] < b.maxX && k.position[1] < b.maxY && k.position[2] > b.minZ && k.position[2] < b.maxZ
    expect(inside, JSON.stringify(k.position)).toBe(false)
    const margin = Math.max(k.position[0] - b.maxX, b.minX - k.position[0], k.position[1] - b.maxY, k.position[2] - b.maxZ, b.minZ - k.position[2])
    expect(margin).toBeGreaterThanOrEqual(0.5 - 1e-6)
  })

  test('a pose looking up (target above the camera) is held without a jump', async ({ page }) => {
    const m = await open(page)
    const pose = {
      position: [m.stylobate.halfX - 2, m.stylobate.top + 1.6, 5.4] as V3,
      target: [-m.stylobate.halfX, m.stylobate.top + 2.6, 5.4] as V3,
      fov: 65,
    }
    await page.evaluate((p) => window.__aphaia!.setCamera(p), pose)
    await tick(page, 30)
    const k = await cam(page)
    expect(dist(k.position, pose.position)).toBeLessThan(1e-4)
    expect(dist(k.target, pose.target)).toBeLessThan(1e-4)
  })

  test('two-finger pinch zooms and two-finger drag pans (CDP touch)', async ({ page }) => {
    await open(page)
    const { send } = await touch(page)
    const c = await centre(page)
    const a = await cam(page)
    // Pinch out: fingers move apart -> zoom in.
    await send('touchStart', [
      { x: c.x - 30, y: c.y },
      { x: c.x + 30, y: c.y },
    ])
    for (let i = 1; i <= 10; i++)
      await send('touchMove', [
        { x: c.x - 30 - i * 12, y: c.y },
        { x: c.x + 30 + i * 12, y: c.y },
      ])
    await send('touchEnd', [])
    await tick(page, 60)
    const b = await cam(page)
    expect(dist(b.position, b.target)).toBeLessThan(dist(a.position, a.target) * 0.9)
    // Two fingers moving together -> pan (target moves).
    await send('touchStart', [
      { x: c.x - 40, y: c.y },
      { x: c.x + 40, y: c.y },
    ])
    for (let i = 1; i <= 10; i++)
      await send('touchMove', [
        { x: c.x - 40 + i * 10, y: c.y + i * 6 },
        { x: c.x + 40 + i * 10, y: c.y + i * 6 },
      ])
    await send('touchEnd', [])
    await tick(page, 60)
    const p = await cam(page)
    expect(dist(p.target, b.target)).toBeGreaterThan(0.3)
  })
})

test.describe('walk', () => {
  test('the walk toggle gives eye height 1.6 m and the walk near plane', async ({ page }) => {
    await open(page)
    await page.locator('#hud-mode').click()
    await tick(page, 90)
    const s = await page.evaluate(() => window.__aphaia!.walk.state())
    const k = await cam(page)
    expect(Math.abs(k.position[1] - s.feet.y - 1.6)).toBeLessThanOrEqual(0.05)
    expect(k.near).toBeCloseTo(0.15, 6)
    await expect(page.locator('#hud-mode')).toHaveAttribute('aria-pressed', 'true')
  })

  test('WASD walks: W forward, D right; Shift hurries', async ({ page }) => {
    await open(page)
    await toWalk(page)
    await page.evaluate(() => window.__aphaia!.walk.place(0, 11, 0))
    await page.keyboard.down('KeyW')
    await tick(page, 60)
    await page.keyboard.up('KeyW')
    let s = await page.evaluate(() => window.__aphaia!.walk.state())
    expect(s.feet.z).toBeCloseTo(11 - 1.6, 1)
    expect(s.feet.x).toBeCloseTo(0, 6)
    await page.keyboard.down('KeyD')
    await tick(page, 30)
    await page.keyboard.up('KeyD')
    s = await page.evaluate(() => window.__aphaia!.walk.state())
    expect(s.feet.x).toBeCloseTo(0.8, 1)
    await page.keyboard.down('Shift')
    await page.keyboard.down('KeyS')
    await tick(page, 30)
    await page.keyboard.up('KeyS')
    await page.keyboard.up('Shift')
    s = await page.evaluate(() => window.__aphaia!.walk.state())
    expect(s.feet.z).toBeCloseTo(11 - 1.6 + 2, 1)
  })

  test('collision holds against a column, the cella wall and the terrace parapet', async ({ page }) => {
    await open(page)
    await toWalk(page)
    const [col] = await page.evaluate(() => window.__aphaia!.colliders('^column-r5c3$'))
    if (col.kind !== 'circle') throw new Error('column collider')
    // From the south pteron, facing south (yaw pi), straight into the column for 4 s.
    await page.evaluate(([x, z]) => window.__aphaia!.walk.place(x, z, Math.PI), [col.x, col.z - 1.4])
    await page.keyboard.down('KeyW')
    await tick(page, 240)
    await page.keyboard.up('KeyW')
    let s = await page.evaluate(() => window.__aphaia!.walk.state())
    expect(Math.hypot(s.feet.x - col.x, s.feet.z - col.z)).toBeGreaterThanOrEqual(col.r + 0.3 - 1e-3)
    expect(s.feet.z).toBeLessThan(col.z)
    // From the naos, facing south, into the cella wall.
    await page.evaluate(() => window.__aphaia!.walk.place(0, 0, Math.PI))
    await page.keyboard.down('KeyW')
    await tick(page, 240)
    await page.keyboard.up('KeyW')
    s = await page.evaluate(() => window.__aphaia!.walk.state())
    expect(s.feet.z).toBeLessThan(3.21 - 0.3 + 1e-3)
    // Over the parapet of the temple terrace: blocked.
    const [wall] = await page.evaluate(() => window.__aphaia!.colliders('^terrace-wall-nws-0$'))
    if (wall.kind !== 'obb') throw new Error('parapet collider')
    await page.evaluate(([x, z]) => window.__aphaia!.walk.place(x, z, Math.PI), [wall.cx, wall.cz - 2])
    await page.keyboard.down('KeyW')
    await tick(page, 240)
    await page.keyboard.up('KeyW')
    s = await page.evaluate(() => window.__aphaia!.walk.state())
    expect(s.feet.z).toBeLessThan(wall.cz - wall.halfZ - 0.3 + 1e-3)
  })

  test('ground following: up the propylon steps and up the east ramp onto the stylobate', async ({ page }) => {
    await open(page)
    await toWalk(page)
    let s = await page.evaluate(() => window.__aphaia!.walk.state())
    const y0 = s.feet.y
    await page.keyboard.down('KeyW')
    await tick(page, 400)
    await page.keyboard.up('KeyW')
    s = await page.evaluate(() => window.__aphaia!.walk.state())
    expect(s.feet.y).toBeGreaterThan(y0 + 0.85)
    // East ramp: from the paved way, facing west (yaw +pi/2).
    await page.evaluate(() => window.__aphaia!.walk.place(21, 0, Math.PI / 2))
    await page.keyboard.down('KeyW')
    await tick(page, 340)
    await page.keyboard.up('KeyW')
    await tick(page, 30)
    s = await page.evaluate(() => window.__aphaia!.walk.state())
    expect(s.feet.x).toBeLessThan(13)
    expect(s.feet.y).toBeCloseTo(0.78, 3)
    const k = await cam(page)
    expect(Math.abs(k.position[1] - 0.78 - 1.6)).toBeLessThanOrEqual(0.05)
  })

  test('the joystick walks forward', async ({ page }) => {
    await open(page)
    await toWalk(page)
    await page.evaluate(() => window.__aphaia!.walk.place(0, 11, 0))
    const pad = page.locator('.hud-joystick')
    if (await pad.isVisible()) {
      // Touch screen: drive the real pad with CDP touch, pushed fully up.
      const { send } = await touch(page)
      const b = (await pad.boundingBox())!
      expect(b.width).toBeGreaterThanOrEqual(88)
      const cx = b.x + b.width / 2
      const cy = b.y + b.height / 2
      await send('touchStart', [{ x: cx, y: cy }])
      await send('touchMove', [{ x: cx, y: cy - b.height }])
      await tick(page, 60)
      await send('touchEnd', [])
    } else {
      await page.evaluate(() => window.__aphaia!.walk.setJoystick(0, 1))
      await tick(page, 60)
      await page.evaluate(() => window.__aphaia!.walk.setJoystick(0, 0))
    }
    const s = await page.evaluate(() => window.__aphaia!.walk.state())
    expect(s.feet.z).toBeCloseTo(11 - 1.6, 1)
  })

  test('mouse-look maths through the hook turns the walker and the camera; pitch clamps at 85 degrees', async ({ page }) => {
    await open(page)
    await toWalk(page)
    const before = await page.evaluate(() => window.__aphaia!.walk.state())
    const look = await page.evaluate(() => window.__aphaia!.walk.applyLook(200, -100))
    expect(look.yaw).toBeCloseTo(before.look.yaw - 0.5, 6)
    expect(look.pitch).toBeCloseTo(before.look.pitch + 0.25, 6)
    const k = await cam(page)
    const dir = [k.target[0] - k.position[0], k.target[1] - k.position[1], k.target[2] - k.position[2]]
    const n = Math.hypot(dir[0], dir[1], dir[2])
    expect(dir[1] / n).toBeCloseTo(Math.sin(look.pitch), 4)
    const up = await page.evaluate(() => window.__aphaia!.walk.applyLook(0, -1e5))
    expect((up.pitch * 180) / Math.PI).toBeCloseTo(85, 6)
  })

  test('drag-to-look on a touch screen turns the walker', async ({ page }) => {
    await open(page)
    await toWalk(page)
    const { send } = await touch(page)
    const c = await centre(page)
    const before = await page.evaluate(() => window.__aphaia!.walk.state())
    await send('touchStart', [{ x: c.x + c.w * 0.25, y: c.y }])
    for (let i = 1; i <= 8; i++) await send('touchMove', [{ x: c.x + c.w * 0.25 - i * 10, y: c.y }])
    await send('touchEnd', [])
    await tick(page, 2)
    const s = await page.evaluate(() => window.__aphaia!.walk.state())
    expect(s.look.yaw).toBeGreaterThan(before.look.yaw + 0.1)
  })
})
