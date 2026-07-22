import { describe, expect, it } from 'vitest'

import {
  centsToInput,
  distinctCategories,
  formatUsd,
  inputToCents,
  isInfraCategory,
  metadataTemplate,
  metadataToRows,
  parseValue,
  priceUnit,
  rowsToMetadata,
  serializeValue,
  specSummary,
} from './logic'

describe('money round-trip', () => {
  it('parses dollars to integer cents', () => {
    expect(inputToCents('66.52')).toBe(6652)
    expect(inputToCents('5')).toBe(500)
    expect(inputToCents('3.48')).toBe(348)
    expect(inputToCents('0')).toBe(0)
  })
  it('is NaN-safe (blank/garbage → 0, never NaN)', () => {
    expect(inputToCents('')).toBe(0)
    expect(inputToCents('abc')).toBe(0)
    expect(Number.isNaN(inputToCents('abc'))).toBe(false)
  })
  it('round-trips cents ↔ input without padding', () => {
    expect(centsToInput(6652)).toBe('66.52')
    expect(centsToInput(500)).toBe('5')
    expect(inputToCents(centsToInput(42900))).toBe(42900)
  })
  it('formats a display price', () => {
    expect(formatUsd(6652)).toBe('$66.52')
    expect(formatUsd(500)).toBe('$5.00')
    expect(formatUsd(0)).toBe('$0.00')
  })
  it('picks the per-period suffix by category', () => {
    expect(priceUnit('gpu')).toBe('/hr')
    expect(priceUnit('cloud')).toBe('/mo')
    expect(priceUnit('datastore')).toBe('/mo')
    expect(priceUnit('subscription')).toBe('')
  })
})

describe('metadata value typing', () => {
  it('serializes each JSON type for display', () => {
    expect(serializeValue('shared')).toBe('shared') // string: raw, no quotes
    expect(serializeValue(2)).toBe('2')
    expect(serializeValue(true)).toBe('true')
    expect(serializeValue(null)).toBe('null')
    expect(serializeValue(['1 VM', '1 vCPU'])).toBe('["1 VM","1 vCPU"]')
    expect(serializeValue({ level: 'standard' })).toBe('{"level":"standard"}')
  })
  it('parses each cell back to its real type', () => {
    expect(parseValue('2')).toBe(2)
    expect(parseValue('66.52')).toBe(66.52)
    expect(parseValue('true')).toBe(true)
    expect(parseValue('null')).toBe(null)
    expect(parseValue('["a","b"]')).toEqual(['a', 'b'])
    expect(parseValue('{"level":"standard"}')).toEqual({ level: 'standard' })
  })
  it('keeps a non-JSON scalar as a string', () => {
    expect(parseValue('shared')).toBe('shared')
    expect(parseValue('1TB')).toBe('1TB')
    expect(parseValue('unlimited')).toBe('unlimited')
    expect(parseValue('')).toBe('')
  })
})

describe('metadata object ↔ rows', () => {
  it('round-trips a cloud-tier spec type-exactly', () => {
    const spec = {
      id: 'dev',
      vcpus: 2,
      memoryGB: 8,
      diskGB: 25,
      cpuType: 'shared',
      maxVMs: 25,
      priceMonthly: 15,
      features: ['Up to 25 VMs', '2 vCPU'],
      popular: true,
    }
    const back = rowsToMetadata(metadataToRows(spec))
    expect(back).toEqual(spec)
    // types preserved, not stringified
    expect(typeof back.vcpus).toBe('number')
    expect(typeof back.cpuType).toBe('string')
    expect(Array.isArray(back.features)).toBe(true)
    expect(typeof back.popular).toBe('boolean')
  })
  it('round-trips a nested datastore spec (support/usage kept as objects)', () => {
    const spec = {
      id: 'basic',
      replicas: 1,
      storageGB: null,
      support: { level: 'standard', responseTime: 'next_business_day' },
      usage: { storage: { pricePerGBMonth: 0.0247 } },
    }
    const back = rowsToMetadata(metadataToRows(spec))
    expect(back).toEqual(spec)
    expect(back.storageGB).toBe(null)
    expect(typeof back.support).toBe('object')
  })
  it('drops blank keys and preserves the empty object', () => {
    expect(rowsToMetadata([{ key: '', value: 'x' }, { key: '  ', value: 'y' }])).toEqual({})
    expect(metadataToRows(undefined)).toEqual([])
    expect(metadataToRows(null)).toEqual([])
  })
  it('last write wins on a duplicate key', () => {
    expect(rowsToMetadata([{ key: 'a', value: '1' }, { key: 'a', value: '2' }])).toEqual({ a: 2 })
  })
})

describe('category helpers', () => {
  it('detects infra categories', () => {
    expect(isInfraCategory('cloud')).toBe(true)
    expect(isInfraCategory('gpu')).toBe(true)
    expect(isInfraCategory('datastore')).toBe(true)
    expect(isInfraCategory('subscription')).toBe(false)
  })
  it('templates a new infra tier with the canonical scalar keys', () => {
    const cloud = metadataTemplate('cloud')
    expect(cloud.map((r) => r.key)).toContain('vcpus')
    expect(cloud.map((r) => r.key)).toContain('priceMonthly')
    expect(metadataTemplate('gpu').map((r) => r.key)).toEqual(['gpu', 'vram', 'price'])
    expect(metadataTemplate('subscription')).toEqual([])
  })
  it('summarizes an infra spec, skipping absent scalars', () => {
    expect(specSummary('cloud', { vcpus: 2, memoryGB: 8, diskGB: 25 })).toEqual([
      '2 vCPU',
      '8 GB',
      '25 GB SSD',
    ])
    expect(specSummary('gpu', { gpu: '1x H100', vram: '80 GB' })).toEqual(['1x H100', '80 GB'])
    expect(specSummary('subscription', { seats: 5 })).toEqual([])
  })
  it('floats infra categories to the front of the filter list', () => {
    const cats = distinctCategories([
      { category: 'subscription' },
      { category: 'gpu' },
      { category: 'cloud' },
      { category: 'datastore' },
      { category: 'ai' },
      { category: 'cloud' },
    ])
    expect(cats.slice(0, 3)).toEqual(['cloud', 'gpu', 'datastore'])
    expect(cats).toContain('subscription')
    expect(cats).toContain('ai')
  })
})
