import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  STOCK_NETWORKS,
  DEFAULT_NETWORK,
  isStockNetwork,
  allNetworks,
  networkById,
  activeNetwork,
  setCustomRegistry,
  slugifyNetworkId,
  parseCustomNetwork,
  loadCustomNetworks,
  persistCustomNetworks,
  type Network,
} from './network'
import { setScope, DEFAULT_ENVIRONMENT } from './scope'

/** A minimal in-memory localStorage, enough for the custom-network store. */
function fakeStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
}

describe('stock networks (Hanzo sovereign L1: networkID == evmChainID)', () => {
  it('ships mainnet/testnet/devnet/local in order', () => {
    expect(STOCK_NETWORKS.map((n) => n.id)).toEqual(['mainnet', 'testnet', 'devnet', 'local'])
  })

  it('holds networkID == evmChainID for every stock network', () => {
    for (const n of STOCK_NETWORKS) expect(n.networkID).toBe(n.evmChainID)
  })

  it('carries a real RPC endpoint per network and same-origin API for the stock tiers', () => {
    for (const n of STOCK_NETWORKS) expect(n.rpcEndpoint).toMatch(/^https?:\/\//)
    // mainnet/testnet/devnet keep the cloud API same-origin (env-scoped by header).
    for (const id of ['mainnet', 'testnet', 'devnet']) {
      expect(STOCK_NETWORKS.find((n) => n.id === id)!.apiEndpoint).toBe('')
    }
  })

  it('defaults to mainnet', () => {
    expect(DEFAULT_NETWORK.id).toBe('mainnet')
  })

  it('recognizes stock ids only', () => {
    expect(isStockNetwork('mainnet')).toBe(true)
    expect(isStockNetwork('local')).toBe(true)
    expect(isStockNetwork('my-net')).toBe(false)
  })
})

describe('network resolution (active = the environment string)', () => {
  beforeEach(() => {
    setCustomRegistry([])
    setScope({ project: undefined, environment: DEFAULT_ENVIRONMENT })
  })

  it('resolves the stock network the environment names', () => {
    setScope({ environment: 'devnet' })
    expect(activeNetwork().id).toBe('devnet')
  })

  it('falls back to mainnet for a project-custom environment (no network)', () => {
    setScope({ environment: 'staging' })
    expect(activeNetwork().id).toBe('mainnet')
  })

  it('resolves a registered custom network', () => {
    const custom: Network = {
      id: 'home', label: 'Home', networkID: 42, evmChainID: 42,
      rpcEndpoint: 'http://localhost:8545', apiEndpoint: 'http://localhost:4000', explorer: '', custom: true,
    }
    setCustomRegistry([custom])
    expect(allNetworks().map((n) => n.id)).toContain('home')
    expect(networkById('home')).toEqual(custom)
    setScope({ environment: 'home' })
    expect(activeNetwork()).toEqual(custom)
  })
})

describe('slugifyNetworkId', () => {
  it('lowercases, hyphenates, and trims', () => {
    expect(slugifyNetworkId('My Home Net!')).toBe('my-home-net')
    expect(slugifyNetworkId('  Osage L1  ')).toBe('osage-l1')
  })
})

describe('parseCustomNetwork', () => {
  const base = { label: 'Home Net', networkID: '70000', evmChainID: '', rpcEndpoint: 'https://rpc.home.test', apiEndpoint: '' }

  it('accepts a valid draft and defaults evmChainID to networkID', () => {
    const r = parseCustomNetwork(base)
    expect('network' in r).toBe(true)
    if ('network' in r) {
      expect(r.network).toMatchObject({ id: 'home-net', label: 'Home Net', networkID: 70000, evmChainID: 70000, custom: true })
    }
  })

  it('honors an explicit distinct evmChainID', () => {
    const r = parseCustomNetwork({ ...base, evmChainID: '70001' })
    if ('network' in r) expect(r.network.evmChainID).toBe(70001)
    else throw new Error('expected ok')
  })

  it('rejects an empty name', () => {
    expect(parseCustomNetwork({ ...base, label: '  ' })).toEqual({ error: expect.stringContaining('Name') })
  })

  it('rejects a collision with a stock network', () => {
    expect(parseCustomNetwork({ ...base, label: 'Mainnet' })).toEqual({ error: expect.stringContaining('already exists') })
  })

  it('rejects a collision with a taken custom id', () => {
    expect(parseCustomNetwork(base, new Set(['home-net']))).toEqual({ error: expect.stringContaining('already exists') })
  })

  it('rejects a non-positive networkID', () => {
    expect(parseCustomNetwork({ ...base, networkID: '0' })).toEqual({ error: expect.stringContaining('Network ID') })
  })

  it('rejects a non-http RPC endpoint', () => {
    expect(parseCustomNetwork({ ...base, rpcEndpoint: 'ftp://x' })).toEqual({ error: expect.stringContaining('RPC') })
  })

  it('rejects a bad API endpoint but allows a blank one', () => {
    expect(parseCustomNetwork({ ...base, apiEndpoint: 'not-a-url' })).toEqual({ error: expect.stringContaining('API') })
    expect('network' in parseCustomNetwork({ ...base, apiEndpoint: '' })).toBe(true)
  })

  it('trims trailing slashes off endpoints', () => {
    const r = parseCustomNetwork({ ...base, rpcEndpoint: 'https://rpc.home.test/', apiEndpoint: 'https://api.home.test/' })
    if ('network' in r) {
      expect(r.network.rpcEndpoint).toBe('https://rpc.home.test')
      expect(r.network.apiEndpoint).toBe('https://api.home.test')
    } else throw new Error('expected ok')
  })
})

describe('custom-network persistence', () => {
  let store: ReturnType<typeof fakeStorage>
  beforeEach(() => {
    store = fakeStorage()
    ;(globalThis as { window?: unknown }).window = { localStorage: store }
  })
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('round-trips valid networks and marks them custom', () => {
    const net: Network = {
      id: 'home', label: 'Home', networkID: 42, evmChainID: 42,
      rpcEndpoint: 'http://localhost:8545', apiEndpoint: '', explorer: '', custom: true,
    }
    persistCustomNetworks([net])
    expect(loadCustomNetworks()).toEqual([net])
  })

  it('returns [] for absent or corrupt storage and drops malformed rows', () => {
    expect(loadCustomNetworks()).toEqual([])
    store.setItem('hanzo.console.networks', '{not json')
    expect(loadCustomNetworks()).toEqual([])
    store.setItem('hanzo.console.networks', JSON.stringify([{ id: 'x' }, 42]))
    expect(loadCustomNetworks()).toEqual([])
  })
})
