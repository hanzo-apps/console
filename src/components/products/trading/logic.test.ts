import { describe, it, expect } from 'vitest'

import type { PaasAppWithProject } from '~/lib/api/paas'
import { botsFromApps, deriveNetwork, summarizeFleet, isBotRunning, networkLabel } from './logic'

/** Build a minimal PaaS app-with-project fixture. */
function app(over: Partial<PaasAppWithProject>): PaasAppWithProject {
  return {
    id: 'app1',
    org: 'lux',
    projectId: 'p1',
    slug: 'market-maker-lux-testnet',
    name: 'Market Maker',
    project: { id: 'p1', org: 'lux', slug: 'trading-bots', name: 'Trading Bots' },
    ...over,
  } as PaasAppWithProject
}

describe('deriveNetwork — from env RPC then environment', () => {
  it('reads the network from COHERENCE_RPC', () => {
    expect(
      deriveNetwork(app({ env: [{ key: 'COHERENCE_RPC', value: 'http://luxd-0.luxd-headless.lux-testnet.svc:9640/v1/bc/C/rpc' }] })),
    ).toBe('lux-testnet')
    expect(deriveNetwork(app({ env: [{ key: 'LUX_RPC', value: 'http://x.lux-mainnet.svc/rpc' }] }))).toBe('lux-mainnet')
  })

  it('falls back to environment when no RPC identifies it', () => {
    expect(deriveNetwork(app({ environment: 'production' }))).toBe('lux-mainnet')
    expect(deriveNetwork(app({ environment: 'staging' }))).toBe('lux-testnet')
  })

  it('is undefined when nothing identifies it (never guessed)', () => {
    expect(deriveNetwork(app({}))).toBeUndefined()
  })
})

describe('botsFromApps — project the app fleet to bots', () => {
  it('keeps only maker/trader images and projects them', () => {
    const apps = [
      app({ id: 'm', image: { repository: 'ghcr.io/luxfi/maker', tag: 'v1.2.3' }, status: 'live', environment: 'staging' }),
      app({ id: 't', slug: 'trader-x', image: { repository: 'ghcr.io/luxfi/trader', tag: 'sha-abc' }, status: 'running' }),
      app({ id: 'other', image: { repository: 'ghcr.io/hanzoai/bot' } }), // not a bot → dropped
    ]
    const bots = botsFromApps(apps)
    expect(bots.map((b) => b.template)).toEqual(['market-maker', 'trader'])
    const maker = bots[0]
    expect(maker.appId).toBe('m')
    expect(maker.project).toBe('trading-bots')
    expect(maker.image).toBe('ghcr.io/luxfi/maker')
    expect(maker.tag).toBe('v1.2.3')
    expect(maker.network).toBe('lux-testnet') // from environment=staging
  })

  it('drops apps with no image', () => {
    expect(botsFromApps([app({})])).toEqual([])
  })
})

describe('summarizeFleet — real lifecycle counts', () => {
  it('counts running/stopped/errored and kind', () => {
    const bots = botsFromApps([
      app({ id: 'a', image: { repository: 'ghcr.io/luxfi/maker' }, status: 'live' }),
      app({ id: 'b', slug: 'b', image: { repository: 'ghcr.io/luxfi/maker' }, status: 'stopped' }),
      app({ id: 'c', slug: 'c', image: { repository: 'ghcr.io/luxfi/trader' }, status: 'error' }),
      app({ id: 'd', slug: 'd', image: { repository: 'ghcr.io/luxfi/trader' }, status: 'live', health: 'red' }),
    ])
    const s = summarizeFleet(bots)
    expect(s.total).toBe(4)
    expect(s.running).toBe(1) // only the healthy live maker
    expect(s.stopped).toBe(1)
    expect(s.error).toBe(2) // the 'error' trader + the red-health "live" trader
    expect(s.makers).toBe(2)
    expect(s.traders).toBe(2)
  })
})

describe('isBotRunning — health verdict wins over lifecycle', () => {
  it('red health is not running even if status says live', () => {
    const [bot] = botsFromApps([app({ image: { repository: 'ghcr.io/luxfi/maker' }, status: 'live', health: 'red' })])
    expect(isBotRunning(bot)).toBe(false)
  })
  it('live + green is running', () => {
    const [bot] = botsFromApps([app({ image: { repository: 'ghcr.io/luxfi/maker' }, status: 'live', health: 'green' })])
    expect(isBotRunning(bot)).toBe(true)
  })
})

describe('networkLabel', () => {
  it('maps ids to labels, honest dash for unknown', () => {
    expect(networkLabel('lux-testnet')).toBe('Lux Testnet')
    expect(networkLabel('lux-mainnet')).toBe('Lux Mainnet')
    expect(networkLabel(undefined)).toBe('—')
    expect(networkLabel('weird')).toBe('—')
  })
})
