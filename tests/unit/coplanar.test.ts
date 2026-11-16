// AC6 / M4: no coplanar overlapping faces anywhere, peristyle columns tested in world space
// (instance matrices applied) against the stylobate and architrave.
import { describe, expect, it } from 'vitest'
import dimensions from '../../src/data/dimensions.json'
import palette from '../../src/data/palette.json'
import { resolveDimensions } from '../../src/data/resolveDimensions'
import type { Dimensions } from '../../src/data/types'
import { MeshBuilder, Collector } from '../../src/geometry/mesh'
import { buildTemple } from '../../src/geometry/temple'
import type { GeneratorOutput, Tier } from '../../src/geometry/types'
import { findCoplanarOverlaps, worldTriangles } from './helpers/triangles'

const dims = dimensions.dimensions as unknown as Dimensions

const fmt = (h: ReturnType<typeof findCoplanarOverlaps>) =>
  h.map((x) => `${x.a} x ${x.b}: ${(x.area * 1e4).toFixed(2)} cm2 at ${x.at.map((v) => v.toFixed(3)).join(',')}`).join('\n')

describe('coplanar finder (controls)', () => {
  const run = (fill: (b: MeshBuilder) => void) => {
    const col = new Collector()
    fill(col.get('architrave'))
    const out: GeneratorOutput = { groups: col.build(palette.colors), instances: [], colliders: [], levels: [] }
    return findCoplanarOverlaps(worldTriangles(out))
  }
  it('flags two boxes sharing a face area', () => {
    expect(run((b) => (b.box([0, 0, 0], [1, 1, 1]), b.box([0.5, 1, 0], [1.5, 2, 1]))).length).toBeGreaterThan(0)
  })
  it('does not flag edge-adjacent coplanar faces or boxes with the contact faces omitted', () => {
    expect(run((b) => (b.box([0, 0, 0], [1, 1, 1]), b.box([1, 0, 0], [2, 1, 1], ['-x'])))).toEqual([
      // the remaining +x face of box 1 still overlaps nothing coplanar (box 2's -x face is omitted)
    ])
    expect(run((b) => (b.box([0, 0, 0], [1, 1, 1], ['+y']), b.box([0, 1, 0], [1, 2, 1], ['-y'])))).toEqual([])
  })
  it('flags a 0.3 mm offset overlap (below the 0.5 mm plane tolerance)', () => {
    expect(run((b) => (b.box([0, 0, 0], [1, 1, 1]), b.box([0.2, 1.0003, 0.2], [0.8, 2, 0.8])))).not.toEqual([])
  })
})

describe.each(['low', 'high'] as Tier[])('no coplanar overlaps (%s tier)', (tier) => {
  it('whole temple incl. the east ramp, columns instance-transformed', () => {
    const r = resolveDimensions(dims, { eastRamp: true })
    const out = buildTemple(r, tier, palette.colors)
    const tris = worldTriangles(out)
    expect(tris.some((t) => t.group.startsWith('peristyle['))).toBe(true)
    const hits = findCoplanarOverlaps(tris)
    expect(hits, fmt(hits)).toEqual([])
  }, 120_000)
})
