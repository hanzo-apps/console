import { describe, expect, it } from 'vitest'

import {
  degreeOf,
  edgeColor,
  hitTest,
  initLayout,
  nodeColor,
  normalizeGraph,
  runLayout,
  stepLayout,
  type Graph,
} from './graph-logic'

describe('normalizeGraph', () => {
  it('parses nodes + edges and drops malformed/dangling rows', () => {
    const g = normalizeGraph({
      nodes: [
        { id: 'kb-page:home', type: 'kb-page', title: 'Home', name: 'home' },
        { id: 'kb-page:runbook', type: 'kb-page', title: 'Runbook' },
        { id: '', type: 'kb-page', title: 'no id' }, // dropped: empty id
        { id: 'kb-page:home', type: 'kb-page', title: 'dup' }, // dropped: duplicate
        null,
      ],
      edges: [
        { from: 'kb-page:runbook', to: 'kb-page:home', kind: 'parent' },
        { from: 'kb-page:home', to: 'kb-page:missing', kind: 'link' }, // dropped: no endpoint
        { from: 'kb-page:home', to: 'kb-page:home', kind: 'link' }, // dropped: self
        { from: 'kb-page:runbook', to: 'kb-page:home', kind: 'parent' }, // dropped: dup
      ],
    })
    expect(g.nodes.map((n) => n.id)).toEqual(['kb-page:home', 'kb-page:runbook'])
    expect(g.edges).toEqual([{ from: 'kb-page:runbook', to: 'kb-page:home', kind: 'parent' }])
  })

  it('returns an empty graph for garbage', () => {
    expect(normalizeGraph(null)).toEqual({ nodes: [], edges: [] })
    expect(normalizeGraph({ nodes: 'x', edges: 7 })).toEqual({ nodes: [], edges: [] })
  })
})

describe('colors', () => {
  it('maps known node/edge kinds and falls back', () => {
    expect(nodeColor('kb-page')).not.toEqual(nodeColor('kb-memory'))
    expect(nodeColor('unknown')).toBe('#615CED')
    expect(edgeColor('parent')).not.toEqual(edgeColor('provenance'))
    expect(edgeColor('mystery')).toBe('#94A3B8')
  })
})

describe('degreeOf', () => {
  it('counts incident edges both directions', () => {
    const g: Graph = {
      nodes: [{ id: 'a', type: 'kb-page', title: 'a' }, { id: 'b', type: 'kb-page', title: 'b' }, { id: 'c', type: 'kb-page', title: 'c' }],
      edges: [{ from: 'a', to: 'b', kind: 'link' }, { from: 'a', to: 'c', kind: 'link' }],
    }
    expect(degreeOf(g)).toEqual({ a: 2, b: 1, c: 1 })
  })
})

const sample: Graph = {
  nodes: Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, type: 'kb-page', title: `N${i}` })),
  edges: [
    { from: 'n0', to: 'n1', kind: 'link' },
    { from: 'n1', to: 'n2', kind: 'link' },
    { from: 'n2', to: 'n0', kind: 'link' },
  ],
}

describe('layout', () => {
  it('seeds every node in-bounds and stays in-bounds after stepping', () => {
    const s = initLayout(sample, 600, 400)
    for (const p of s.pos) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(600)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(400)
    }
    for (let i = 0; i < 300; i++) stepLayout(s, sample)
    for (const p of s.pos) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(600)
    }
  })

  it('is deterministic across runs (no random jitter)', () => {
    const a = runLayout(sample, 600, 400, 120)
    const b = runLayout(sample, 600, 400, 120)
    expect(a.pos).toEqual(b.pos)
  })

  it('draws connected nodes closer than the frame diagonal', () => {
    const s = runLayout(sample, 600, 400, 300)
    const d = (i: number, j: number) => Math.hypot(s.pos[i].x - s.pos[j].x, s.pos[i].y - s.pos[j].y)
    const diag = Math.hypot(600, 400)
    // The triangle n0-n1-n2 is bonded; each pair should settle well inside the frame.
    expect(d(0, 1)).toBeLessThan(diag)
    expect(d(1, 2)).toBeLessThan(diag)
  })

  it('hit-tests the nearest node within the radius, else null', () => {
    const s = runLayout(sample, 600, 400, 200)
    const p = s.pos[3]
    expect(hitTest(s, p.x, p.y, 12)).toBe('n3')
    expect(hitTest(s, -100, -100, 12)).toBeNull()
  })
})
