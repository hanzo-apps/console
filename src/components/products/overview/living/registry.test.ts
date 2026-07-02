import { describe, it, expect, vi } from 'vitest'

// The registry imports lucide icons for the metric-tile `icon` field; that ESM
// package (via @hanzo/gui) isn't transformed in the node test env, so stub the
// icons the registry uses with plain tokens. The configs under test carry these as
// opaque `icon` values — the consistency checks assert they are TRUTHY, not what
// they render. Listed explicitly because vitest validates named exports on a mock.
vi.mock('@hanzogui/lucide-icons-2', () => {
  const names = ['Activity', 'Building2', 'Cpu', 'CreditCard', 'DollarSign', 'FunctionSquare', 'Gauge', 'Hash', 'Layers', 'Timer', 'TrendingUp', 'TriangleAlert', 'Users']
  return Object.fromEntries(names.map((n) => [n, `icon:${n}`]))
})

import { LIVING_OVERVIEWS, livingOverviewFor, livingOverviewIds } from './registry'

/**
 * The living-overview registry is the declarative catalog that makes the overview
 * reusable. These pin the invariants that keep "add one config" honest: every
 * declared config is internally consistent (its map key === its id, at least one
 * metric row, every tile is a known kind), and lookups resolve — so a wiring bug
 * (an id with no config, a typo'd tile) fails a test, not a user's screen.
 */

const TILE_KINDS = new Set(['metric', 'timeseries', 'distribution', 'activity', 'alerts', 'health'])

describe('LIVING_OVERVIEWS — declarative consistency', () => {
  it('the map key equals each config id', () => {
    for (const [id, cfg] of Object.entries(LIVING_OVERVIEWS)) {
      expect(cfg.id).toBe(id)
    }
  })

  it('every config has a title, at least one row, and a loader', () => {
    for (const cfg of Object.values(LIVING_OVERVIEWS)) {
      expect(cfg.title.length).toBeGreaterThan(0)
      expect(cfg.rows.length).toBeGreaterThan(0)
      expect(typeof cfg.load).toBe('function')
    }
  })

  it('every tile is a known kind and metric tiles carry a key + label + icon', () => {
    for (const cfg of Object.values(LIVING_OVERVIEWS)) {
      for (const row of cfg.rows) {
        for (const tile of row) {
          expect(TILE_KINDS.has(tile.tile)).toBe(true)
          if (tile.tile === 'metric') {
            expect(tile.key.length).toBeGreaterThan(0)
            expect(tile.label.length).toBeGreaterThan(0)
            expect(tile.icon).toBeTruthy()
          }
          if (tile.tile === 'timeseries' || tile.tile === 'distribution') {
            expect(tile.key.length).toBeGreaterThan(0)
            expect(tile.title.length).toBeGreaterThan(0)
          }
        }
      }
    }
  })

  it('each config declares at least one metric tile (a KPI headline row)', () => {
    for (const cfg of Object.values(LIVING_OVERVIEWS)) {
      const metrics = cfg.rows.flat().filter((t) => t.tile === 'metric')
      expect(metrics.length).toBeGreaterThan(0)
    }
  })

  it('a live config never asks to poll below a sane cadence (the driver floors it anyway)', () => {
    for (const cfg of Object.values(LIVING_OVERVIEWS)) {
      if (cfg.live?.pollMs) expect(cfg.live.pollMs).toBeGreaterThanOrEqual(1000)
    }
  })

  it('lookups resolve for every declared id and miss cleanly for an unknown id', () => {
    for (const id of livingOverviewIds()) {
      expect(livingOverviewFor(id)).toBeDefined()
    }
    expect(livingOverviewFor('does-not-exist')).toBeUndefined()
  })

  it('covers the platform overview + at least three product overviews', () => {
    expect(livingOverviewFor('overview')).toBeDefined()
    // proof: platform + ≥3 product overviews wired
    expect(livingOverviewIds().length).toBeGreaterThanOrEqual(4)
  })
})
