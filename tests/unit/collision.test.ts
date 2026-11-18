// Walk collision and ground following on the real generated world (plan Step 5): every column and wall
// blocks, sliding works, doorways pass, no tunnelling at 10x speed, step-up onto the krepis and the ramp,
// the threshold level, the propylon passage and the terrace parapet.
import { beforeAll, describe, expect, it } from 'vitest'
import { blocks, pushOut, resolveMove, separate, WALK_RADIUS, type Feet, type WalkWorld } from '../../src/app/controls/collision'
import { levelHeight, STEP_UP, surfaceAt } from '../../src/app/controls/ground'
import { WALK_SPAWN } from '../../src/app/controls/manager'
import type { Collider, Level } from '../../src/geometry/types'
import { buildWorld } from './helpers/world'
import sanctuary from '../../src/data/sanctuary.json'

let world: WalkWorld

beforeAll(async () => {
  world = await buildWorld('low')
})

const at = (x: number, z: number): Feet => ({ x, y: surfaceAt(world.levels, x, z), z })
/** Walk in small frames (like the app at 60 fps) from p by (dx, dz). */
function walk(p: Feet, dx: number, dz: number, frames = 120): Feet {
  for (let i = 0; i < frames; i++) p = resolveMove(p, { x: dx / frames, z: dz / frames }, world)
  return p
}
const clear = (p: Feet) => world.colliders.every((c) => !blocks(c, p.y) || !pushOut(c, p.x, p.z, WALK_RADIUS - 1e-6))

/** Collider centre and its local axes in the world (boxes are obbs with rotY 0). */
function frame(c: Exclude<Collider, { kind: 'circle' }>) {
  const cx = c.kind === 'box' ? (c.minX + c.maxX) / 2 : c.cx
  const cz = c.kind === 'box' ? (c.minZ + c.maxZ) / 2 : c.cz
  const hx = c.kind === 'box' ? (c.maxX - c.minX) / 2 : c.halfX
  const hz = c.kind === 'box' ? (c.maxZ - c.minZ) / 2 : c.halfZ
  const r = c.kind === 'obb' ? c.rotY : 0
  // Local +x and +z in world coordinates (Ry(r)).
  return { cx, cz, hx, hz, ax: [Math.cos(r), -Math.sin(r)] as const, az: [Math.sin(r), Math.cos(r)] as const }
}

describe('pushOut (synthetic)', () => {
  it('circle, axis box and rotated box keep the walker radius away', () => {
    expect(pushOut({ kind: 'circle', name: 'c', x: 0, z: 0, r: 1, y0: 0, y1: 5 }, 0.5, 0, 0.3)).toEqual([1.3, 0])
    expect(pushOut({ kind: 'box', name: 'b', minX: -1, maxX: 1, minZ: -1, maxZ: 1, y0: 0, y1: 5 }, 1.1, 0.2, 0.3)![0]).toBeCloseTo(1.3, 9)
    // A 2 x 0.2 wall rotated 90 degrees runs along z: a point 0.2 m east of its axis is pushed to 0.1 + 0.3.
    const p = pushOut({ kind: 'obb', name: 'o', cx: 0, cz: 0, halfX: 1, halfZ: 0.1, rotY: Math.PI / 2, y0: 0, y1: 5 }, 0.2, 0.5, 0.3)!
    expect(p[0]).toBeCloseTo(0.4, 9)
    expect(p[1]).toBeCloseTo(0.5, 9)
    expect(pushOut({ kind: 'obb', name: 'o', cx: 0, cz: 0, halfX: 1, halfZ: 0.1, rotY: Math.PI / 2, y0: 0, y1: 5 }, 0.5, 0.5, 0.3)).toBeNull()
  })

  it('low parts are stepped over, lintels walked under', () => {
    const c: Collider = { kind: 'box', name: 'b', minX: 0, maxX: 1, minZ: 0, maxZ: 1, y0: 0, y1: 0.4 }
    expect(blocks(c, 0)).toBe(false)
    expect(blocks({ ...c, y1: 2 }, 0)).toBe(true)
    expect(blocks({ ...c, y0: 2.5, y1: 4 }, 0)).toBe(false)
  })

  it('refuses a rise above the step-up, follows one below it', () => {
    const levels: Level[] = [
      { name: 'floor', y: 0, minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
      { name: 'low', y: 0.3, minX: 2, maxX: 10, minZ: -10, maxZ: 10 },
      { name: 'high', y: 0.3 + STEP_UP + 0.1, minX: 5, maxX: 10, minZ: -10, maxZ: 10 },
    ]
    const w: WalkWorld = { colliders: [], levels }
    let p: Feet = { x: 0, y: 0, z: 0 }
    for (let i = 0; i < 100; i++) p = resolveMove(p, { x: 0.1, z: 0 }, w)
    expect(p.y).toBe(0.3)
    expect(p.x).toBeLessThanOrEqual(5)
    expect(p.x).toBeGreaterThan(4.8)
  })

  it('rotated and sloped levels', () => {
    const ramp: Level = { name: 'ramp', y: 1, minX: 0, maxX: 2, minZ: -1, maxZ: 1, slopeX: -0.5 }
    expect(levelHeight(ramp, 1, 0)).toBeCloseTo(0.5, 9)
    const rot: Level = { name: 'r', y: 2, minX: -2, maxX: 2, minZ: -0.5, maxZ: 0.5, rotY: Math.PI / 2 }
    expect(levelHeight(rot, 0, 1.5)).toBe(2)
    expect(levelHeight(rot, 1.5, 0)).toBeNaN()
  })
})

describe('walk on the generated site', () => {
  it('the world carries colliders and levels', () => {
    expect(world.colliders.filter((c) => c.kind === 'circle' && c.name.startsWith('column-')).length).toBe(32)
    expect(world.levels.some((l) => l.heightfield)).toBe(true)
  })

  it('every column blocks, approached from every free side', () => {
    let tested = 0
    for (const c of world.colliders) {
      if (c.kind !== 'circle' || !/column/.test(c.name)) continue
      let sides = 0
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4
        const ux = Math.cos(a)
        const uz = Math.sin(a)
        const start = at(c.x + ux * (c.r + 0.7), c.z + uz * (c.r + 0.7))
        if (!Number.isFinite(start.y) || !blocks(c, start.y) || !clear(start)) continue
        const end = resolveMove(start, { x: -ux * 2 * (c.r + 0.7), z: -uz * 2 * (c.r + 0.7) }, world)
        const d = Math.hypot(end.x - c.x, end.z - c.z)
        expect(d, `${c.name} from ${k}`).toBeGreaterThanOrEqual(c.r + WALK_RADIUS - 1e-6)
        expect((end.x - c.x) * ux + (end.z - c.z) * uz, `${c.name} crossed`).toBeGreaterThan(-1e-6)
        sides++
      }
      expect(sides, c.name).toBeGreaterThan(0)
      tested++
    }
    expect(tested).toBeGreaterThanOrEqual(32 + 4 + 10 + 4)
  })

  it('every wall, anta, parapet, cheek wall and building wall blocks, approached across each long face', () => {
    let tested = 0
    const skipped: string[] = []
    for (const c of world.colliders) {
      if (c.kind === 'circle') continue
      const f = frame(c)
      let faces = 0
      // Approach across the thinner dimension (the faces a walker meets), at 3 points along the wall.
      const across = f.hx < f.hz ? f.ax : f.az
      const along = f.hx < f.hz ? f.az : f.ax
      const half = f.hx < f.hz ? f.hx : f.hz
      const len = f.hx < f.hz ? f.hz : f.hx
      for (const s of [-1, 1])
        for (const t of [-0.6, 0, 0.6]) {
          const o = half + WALK_RADIUS + 0.4
          const sx = f.cx + across[0] * s * o + along[0] * t * len
          const sz = f.cz + across[1] * s * o + along[1] * t * len
          const start = at(sx, sz)
          if (!Number.isFinite(start.y) || !blocks(c, start.y) || !clear(start)) continue
          const end = walk(start, -across[0] * s * 2 * o, -across[1] * s * 2 * o, 20)
          // Signed distance along the approach axis from the wall's mid-plane stays on the start side.
          const side = ((end.x - f.cx) * across[0] + (end.z - f.cz) * across[1]) * s
          expect(side, `${c.name} side ${s} at ${t}`).toBeGreaterThan(half + WALK_RADIUS - 1e-3)
          faces++
        }
      if (faces) tested++
      else skipped.push(c.name)
    }
    expect(tested).toBeGreaterThan(40)
    // Colliders no walker can reach (buried, or fully inside other blockers) are listed for the record.
    console.log(`[collision] walls tested ${tested}; unreachable faces: ${skipped.join(', ') || 'none'}`)
  })

  it('the cella wall: blocked across, slides along', () => {
    // In the south pteron, walking diagonally north-west into the cella's south wall (z = 4.005).
    const start = at(0, 5.2)
    expect(start.y).toBeCloseTo(0.78, 6)
    const end = walk(start, -3, -3, 60)
    expect(end.z).toBeGreaterThanOrEqual(4.005 + WALK_RADIUS - 1e-6)
    expect(end.x).toBeLessThan(-2.9)
  })

  it('the east door is passable: pronaos -> threshold -> naos', () => {
    const start = at(9, 0)
    expect(start.y).toBeCloseTo(1.01, 6)
    let p = walk(start, -2, 0, 40)
    expect(p.x).toBeCloseTo(7, 1)
    expect(p.y).toBeCloseTo(1.245, 6)
    p = walk(p, -3, 0, 60)
    expect(p.x).toBeCloseTo(4, 6)
    expect(p.y).toBeCloseTo(1.01, 6)
  })

  it('no tunnelling at 10x speed (one 15 m move into a column and through a wall)', () => {
    const col = world.colliders.find((c) => c.name === 'column-r0c3' || (c.kind === 'circle' && c.name.startsWith('column-')))!
    if (col.kind !== 'circle') throw new Error('kind')
    const start = at(col.x, col.z + (col.z < 0 ? 1.2 : -1.2))
    const end = resolveMove(start, { x: 0, z: (col.z - start.z) * 15 }, world)
    expect(Math.hypot(end.x - col.x, end.z - col.z)).toBeGreaterThanOrEqual(col.r + WALK_RADIUS - 1e-6)
    expect(Math.sign(end.z - col.z)).toBe(Math.sign(start.z - col.z))
    const naos = at(0, 0)
    expect(resolveMove(naos, { x: 0, z: 15 }, world).z).toBeLessThanOrEqual(3.207 - WALK_RADIUS + 1e-6)
  })

  it('steps up the krepis onto the stylobate, and down again', () => {
    let p = at(-3, 11)
    expect(p.y).toBeCloseTo(0, 6)
    p = walk(p, 0, -5.5, 80)
    expect(p.y).toBeCloseTo(0.78, 6)
    p = walk(p, 0, 5.5, 80)
    expect(p.y).toBeCloseTo(0, 6)
  })

  it('walks up the east ramp onto the stylobate', () => {
    let p = at(21, 0)
    expect(p.y).toBeLessThan(0.2)
    const ys: number[] = []
    // The fill over the lowest tread (x 14.825..15.25) carries the ramp top level, so the climb never dips.
    expect(world.levels.some((l) => l.name === 'ramp-fill')).toBe(true)
    for (let i = 0; i < 90; i++) {
      p = resolveMove(p, { x: -0.1, z: 0 }, world)
      ys.push(p.y)
    }
    expect(p.y).toBeCloseTo(0.78, 6)
    // Monotonic climb, no rise per 10 cm above the step-up.
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1] - 1e-9)
      expect(ys[i] - ys[i - 1]).toBeLessThanOrEqual(STEP_UP)
    }
    expect(surfaceAt(world.levels, 17, 0)).toBeCloseTo(0.52 - (0.52 / 3.12) * 1.75, 2)
  })

  it('the walk spawn is clear and the propylon passes walkers through its middle, blocks them at its cross wall', () => {
    const spawn = at(WALK_SPAWN.x, WALK_SPAWN.z)
    expect(Number.isFinite(spawn.y)).toBe(true)
    expect(clear(spawn)).toBe(true)
    // The plaza at the foot of the propylon stair (outer terrace, from sanctuary.json); the walk below climbs the
    // two flights (about 4 m) up into the propylon.
    expect(spawn.y).toBeCloseTo(0.78 + sanctuary.terrain.terraces['outer-terrace'].level.value, 1)
    let p = walk(spawn, 0, -14, 200)
    expect(p.z).toBeCloseTo(WALK_SPAWN.z - 14, 6)
    expect(p.y).toBeCloseTo(0, 1)
    p = walk(at(20.2, 23), 0, -5, 80)
    expect(p.z).toBeGreaterThanOrEqual(20.82 + 0.3 + WALK_RADIUS - 1e-6)
  })

  it('the terrace parapet holds', () => {
    // The NW-S enclosure (retaining wall + parapet): its first leg runs along z = 20.58, its second along x = -31.75.
    const wall = world.colliders.find((c) => c.name === 'terrace-wall-nws-0')
    expect(wall).toBeDefined()
    const p = walk(at(-6, 18.5), 0, 6, 80)
    expect(p.z).toBeLessThan(20.583 - 0.575 - WALK_RADIUS + 1e-3)
    const q = walk(at(-28, 0), -8, 0, 80)
    expect(q.x).toBeGreaterThan(-31.753 + 0.575 + WALK_RADIUS - 1e-3)
  })

  it('separate() settles in a corner between two walls', () => {
    const [x, z] = separate(world, -7.2, 3.1, 1.01)
    expect(world.colliders.every((c) => !blocks(c, 1.01) || !pushOut(c, x, z, WALK_RADIUS - 1e-6))).toBe(true)
  })
})
