import { describe, expect, it } from 'vitest'

import { isOnline, onlineCaption, onlineSplit, providerKind, providerLabel } from './resource-logic'

describe('providerKind / providerLabel', () => {
  it('classifies bring-your-own slugs as byo', () => {
    for (const p of ['byo', 'BYO', 'on-prem', 'onprem', 'self-hosted', 'worker', 'fleet']) {
      expect(providerKind(p)).toBe('byo')
      expect(providerLabel(p)).toBe('BYO')
    }
  })
  it('treats visor/doks and absent/unknown as cloud (never fabricated BYO)', () => {
    for (const p of ['visor', 'doks', 'digitalocean', undefined, '']) {
      expect(providerKind(p)).toBe('cloud')
      expect(providerLabel(p)).toBe('Cloud')
    }
  })
})

describe('isOnline', () => {
  it('accepts up-states across GPU + machine vocabularies, case-insensitively', () => {
    for (const s of ['online', 'Running', 'ACTIVE', 'ready', 'ok', 'available']) expect(isOnline(s)).toBe(true)
  })
  it('is false for down/unknown/absent (never a fabricated online)', () => {
    for (const s of ['offline', 'off', 'error', 'provisioning', 'unknown', '', undefined]) expect(isOnline(s)).toBe(false)
  })
})

describe('onlineSplit', () => {
  it('splits online capacity into cloud vs BYO', () => {
    const s = onlineSplit([
      { provider: 'doks', status: 'online' }, // cloud, online
      { provider: 'visor', status: 'online' }, // cloud, online
      { provider: 'doks', status: 'offline' }, // cloud, down
      { provider: 'byo', status: 'online' }, // BYO GB10, online
      { provider: 'byo', status: 'offline' }, // BYO, down
    ])
    expect(s).toEqual({ total: 5, online: 3, onlineCloud: 2, onlineByo: 1, byo: 2 })
  })
  it('is all-cloud when no provider is reported (pre-union inventory)', () => {
    const s = onlineSplit([{ status: 'active' }, { status: 'active' }, { status: 'off' }])
    expect(s).toEqual({ total: 3, online: 2, onlineCloud: 2, onlineByo: 0, byo: 0 })
  })
})

describe('onlineCaption', () => {
  it('shows a cloud+BYO split only when BYO capacity exists', () => {
    expect(onlineCaption(onlineSplit([]))).toBe('none yet')
    expect(onlineCaption(onlineSplit([{ status: 'online' }, { status: 'off' }]))).toBe('1 online')
    expect(onlineCaption(onlineSplit([{ provider: 'doks', status: 'online' }, { provider: 'byo', status: 'online' }]))).toBe('1 cloud · 1 BYO')
  })
})
