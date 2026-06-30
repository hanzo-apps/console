import { describe, it, expect } from 'vitest'

import {
  formatCents,
  formatDurationMin,
  estimateCostCents,
  humanCount,
  isGated,
  needsToken,
  methodLabel,
  jobTitle,
  isActive,
  isDeployable,
  progressOf,
  upsertConfig,
  removeConfig,
  type SavedConfig,
} from './logic'

describe('formatCents', () => {
  it('formats cents as dollars', () => {
    expect(formatCents(0)).toBe('$0.00')
    expect(formatCents(150)).toBe('$1.50')
    expect(formatCents(199)).toBe('$1.99')
  })
  it('is defensive against undefined/negative', () => {
    expect(formatCents()).toBe('$0.00')
    expect(formatCents(-5)).toBe('$0.00')
  })
})

describe('formatDurationMin', () => {
  it('formats minutes under an hour', () => {
    expect(formatDurationMin(12)).toBe('12 min')
    expect(formatDurationMin(59)).toBe('59 min')
  })
  it('formats hours + minutes with zero-padding', () => {
    expect(formatDurationMin(60)).toBe('1h 00m')
    expect(formatDurationMin(65)).toBe('1h 05m')
    expect(formatDurationMin(150)).toBe('2h 30m')
  })
  it('is defensive', () => {
    expect(formatDurationMin()).toBe('0 min')
    expect(formatDurationMin(-3)).toBe('0 min')
  })
})

describe('estimateCostCents', () => {
  it('mirrors hours × units × rate, rounded up', () => {
    // 60 min, 1 GPU, $2.00/hr → $2.00
    expect(estimateCostCents(60, 200, 1, 1)).toBe(200)
    // 30 min, 2 GPUs, $2.00/hr → 1h GPU = $2.00
    expect(estimateCostCents(30, 200, 2, 1)).toBe(200)
    // 90 min, 1 GPU, $1.50/hr → $2.25
    expect(estimateCostCents(90, 150, 1, 1)).toBe(225)
  })
  it('rounds fractional cents up and floors units at 1', () => {
    expect(estimateCostCents(1, 200, 1, 1)).toBe(Math.ceil((1 / 60) * 200))
    expect(estimateCostCents(60, 100, 0, 0)).toBe(100)
  })
})

describe('humanCount', () => {
  it('compacts large counts', () => {
    expect(humanCount(0)).toBe('0')
    expect(humanCount(950)).toBe('950')
    expect(humanCount(1234)).toBe('1.2k')
    expect(humanCount(3_400_000)).toBe('3.4M')
  })
})

describe('isGated / needsToken', () => {
  it('interprets the mixed HF gated value', () => {
    expect(isGated(false)).toBe(false)
    expect(isGated(true)).toBe(true)
    expect(isGated('auto')).toBe(true)
    expect(isGated('manual')).toBe(true)
    expect(isGated('false')).toBe(false)
    expect(isGated(undefined)).toBe(false)
  })
  it('flags private OR gated repos as needing a token', () => {
    expect(needsToken({ private: false, gated: false })).toBe(false)
    expect(needsToken({ private: true, gated: false })).toBe(true)
    expect(needsToken({ private: false, gated: 'manual' })).toBe(true)
  })
})

describe('methodLabel', () => {
  it('labels known methods', () => {
    expect(methodLabel('qlora')).toBe('QLoRA (4-bit)')
    expect(methodLabel('lora')).toBe('LoRA')
    expect(methodLabel('full')).toBe('Full fine-tune')
    expect(methodLabel('mystery')).toBe('mystery')
  })
})

describe('jobTitle', () => {
  it('prefers displayName, then baseModel, then name', () => {
    expect(jobTitle({ displayName: 'My run', baseModel: 'x', name: 'y' })).toBe('My run')
    expect(jobTitle({ displayName: '', baseModel: 'meta/Llama', name: 'y' })).toBe('meta/Llama')
    expect(jobTitle({ displayName: '', baseModel: '', name: 'job-1' })).toBe('job-1')
  })
})

describe('status helpers', () => {
  it('isActive covers in-flight states', () => {
    expect(isActive('pending')).toBe(true)
    expect(isActive('queued')).toBe(true)
    expect(isActive('running')).toBe(true)
    expect(isActive('succeeded')).toBe(false)
    expect(isActive('failed')).toBe(false)
  })
  it('isDeployable only for succeeded', () => {
    expect(isDeployable({ status: 'succeeded' })).toBe(true)
    expect(isDeployable({ status: 'running' })).toBe(false)
  })
  it('progressOf clamps and forces 100 on success', () => {
    expect(progressOf({ status: 'running', progress: 50 })).toBe(50)
    expect(progressOf({ status: 'succeeded', progress: 0 })).toBe(100)
    expect(progressOf({ status: 'running', progress: 999 })).toBe(100)
    expect(progressOf({ status: 'pending' })).toBe(0)
  })
})

describe('saved-config merge', () => {
  const mk = (name: string): SavedConfig => ({
    name,
    input: { baseModel: 'm', method: 'qlora', dataset: 'd' },
    savedAt: '2026-01-01',
  })
  it('upserts newest-first and dedupes by name', () => {
    const a = upsertConfig([], mk('a'))
    expect(a.map((c) => c.name)).toEqual(['a'])
    const ab = upsertConfig(a, mk('b'))
    expect(ab.map((c) => c.name)).toEqual(['b', 'a'])
    const abReplace = upsertConfig(ab, mk('a'))
    expect(abReplace.map((c) => c.name)).toEqual(['a', 'b'])
  })
  it('removes by name', () => {
    const list = [mk('a'), mk('b')]
    expect(removeConfig(list, 'a').map((c) => c.name)).toEqual(['b'])
  })
})
