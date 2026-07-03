import { describe, expect, it } from 'vitest'

import {
  RAILWAY_STAGES,
  isTerminalPhase,
  railwayModel,
  railwayPhase,
  stageIndex,
  type StationState,
} from './railway'

const states = (status?: string | null, furthest?: number): StationState[] =>
  railwayModel(status, furthest).stations.map((s) => s.state)

describe('railwayPhase — normalizes the real PaaS status enums', () => {
  it('maps app/deployment statuses to canonical phases', () => {
    expect(railwayPhase('queued')).toBe('queued')
    expect(railwayPhase('building')).toBe('building')
    expect(railwayPhase('deploying')).toBe('deploying')
    expect(railwayPhase('live')).toBe('live')
    expect(railwayPhase('succeeded')).toBe('live')
    expect(railwayPhase('superseded')).toBe('live')
    expect(railwayPhase('error')).toBe('error')
    expect(railwayPhase('failed')).toBe('error')
    expect(railwayPhase('canceled')).toBe('error')
    expect(railwayPhase('draft')).toBe('idle')
    expect(railwayPhase('stopped')).toBe('idle')
  })
  it('is case/space-insensitive and defaults unknown to idle', () => {
    expect(railwayPhase('  BUILDING ')).toBe('building')
    expect(railwayPhase('')).toBe('idle')
    expect(railwayPhase(null)).toBe('idle')
    expect(railwayPhase('wat')).toBe('idle')
  })
})

describe('stageIndex', () => {
  it('orders the four stations', () => {
    expect(stageIndex('queued')).toBe(0)
    expect(stageIndex('building')).toBe(1)
    expect(stageIndex('deploying')).toBe(2)
    expect(stageIndex('live')).toBe(3)
    expect(stageIndex('idle')).toBe(-1)
    expect(stageIndex('error')).toBe(-1)
  })
})

describe('isTerminalPhase', () => {
  it('is terminal only for live and error', () => {
    expect(isTerminalPhase('live')).toBe(true)
    expect(isTerminalPhase('error')).toBe(true)
    expect(isTerminalPhase('building')).toBe(false)
    expect(isTerminalPhase('queued')).toBe(false)
    expect(isTerminalPhase('idle')).toBe(false)
  })
})

describe('railwayModel — station states + progress', () => {
  it('idle: every station pending, zero progress, honest label', () => {
    const m = railwayModel('draft')
    expect(m.activeIndex).toBe(-1)
    expect(m.progress).toBe(0)
    expect(m.inProgress).toBe(false)
    expect(states('draft')).toEqual(['pending', 'pending', 'pending', 'pending'])
    expect(m.label).toBe('Not deployed')
  })

  it('queued: station 0 active, rest pending', () => {
    const m = railwayModel('queued')
    expect(m.activeIndex).toBe(0)
    expect(m.progress).toBe(0)
    expect(m.inProgress).toBe(true)
    expect(states('queued')).toEqual(['active', 'pending', 'pending', 'pending'])
    expect(m.label).toBe('Queued')
  })

  it('building: station 0 done, 1 active, progress 1/3', () => {
    const m = railwayModel('building')
    expect(m.activeIndex).toBe(1)
    expect(m.progress).toBeCloseTo(1 / 3)
    expect(states('building')).toEqual(['done', 'active', 'pending', 'pending'])
    expect(m.label).toBe('Building…')
  })

  it('deploying: stations 0-1 done, 2 active, progress 2/3', () => {
    const m = railwayModel('deploying')
    expect(m.activeIndex).toBe(2)
    expect(m.progress).toBeCloseTo(2 / 3)
    expect(states('deploying')).toEqual(['done', 'done', 'active', 'pending'])
    expect(m.label).toBe('Deploying…')
  })

  it('live: every station done, full progress', () => {
    const m = railwayModel('live')
    expect(m.live).toBe(true)
    expect(m.progress).toBe(1)
    expect(m.inProgress).toBe(false)
    expect(states('live')).toEqual(['done', 'done', 'done', 'done'])
    expect(m.label).toBe('Live')
  })
})

describe('railwayModel — error marks the station actually reached', () => {
  it('errors at the furthest observed station (building), earlier done, later pending', () => {
    const m = railwayModel('error', 1)
    expect(m.errored).toBe(true)
    expect(m.activeIndex).toBe(1)
    expect(states('error', 1)).toEqual(['done', 'error', 'pending', 'pending'])
    expect(m.progress).toBeCloseTo(1 / 3)
    expect(m.label).toBe('Failed while building')
  })
  it('errors while deploying when reached station 2', () => {
    const m = railwayModel('error', 2)
    expect(states('error', 2)).toEqual(['done', 'done', 'error', 'pending'])
    expect(m.label).toBe('Failed while deploying')
  })
  it('errors in queue when nothing was observed yet', () => {
    const m = railwayModel('error')
    expect(m.activeIndex).toBe(0)
    expect(states('error')).toEqual(['error', 'pending', 'pending', 'pending'])
    expect(m.label).toBe('Failed in queue')
  })
})

describe('railwayModel — furthest is monotonic (no going backwards)', () => {
  it('keeps completed stations filled when a later poll returns an earlier status', () => {
    // Observed deploying (2), then a transient poll returns building (1): furthest wins.
    expect(states('building', 2)).toEqual(['done', 'done', 'active', 'pending'])
    expect(railwayModel('building', 2).activeIndex).toBe(2)
  })
})

describe('RAILWAY_STAGES', () => {
  it('has the four named stations in order', () => {
    expect(RAILWAY_STAGES).toEqual(['Queued', 'Building', 'Deploying', 'Live'])
  })
})
