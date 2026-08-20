import { describe, it, expect } from 'vitest'

import type { CatalogEntry, ProductIcon } from '~/lib/products/registry'
import { OVERVIEW_SPECS } from './spec'
import { defaultSpec, resolveSpec } from './resolve'

/**
 * Native-overview resolution — pure logic only (no runtime registry import, which
 * would pull the whole GUI component tree into the node test env, the reason every
 * other suite imports the registry types-only). Native overviews are the `module`
 * shape's surface: every HANZO product opens IN the console, so no Hanzo control
 * plane bounces to another domain. (The separate `external` kind is only for the
 * deployed Lux/Zoo chain-app LAUNCH tiles — standalone apps at their own domains,
 * not Hanzo products — which own no overview and never reach `resolveSpec`.)
 *
 * These pin: (1) registered specs resolve and are non-empty, (2) the derived
 * default is honest (never fabricates health, carries real catalog facts), and
 * (3) the network/security overviews declare a REAL platform health source.
 */
const I = (() => null) as unknown as ProductIcon

/** A synthetic module entry (matches the real registry shape; nothing renders). */
const entry = (over: Partial<CatalogEntry> & { id: string }): CatalogEntry => ({
  label: over.id,
  icon: I,
  description: `The ${over.id} product.`,
  category: 'Network',
  kind: 'module',
  routes: [],
  ...over,
}) as CatalogEntry

describe('resolveSpec', () => {
  it('returns the registered spec when one exists (by id)', () => {
    expect(resolveSpec(entry({ id: 'gateway' }))).toBe(OVERVIEW_SPECS.gateway)
  })

  it('every former link-out product has a registered, usable spec', () => {
    for (const id of ['gateway', 'dns', 'cdn', 'mpc', 'cli', 'sdks', 'api', 'ide', 'desktop', 'registry', 'metrics', 'crawl', 'studio', 'console']) {
      const spec = OVERVIEW_SPECS[id]
      expect(spec, `missing overview spec: ${id}`).toBeDefined()
      expect(spec.summary.length).toBeGreaterThan(0)
      expect(spec.docs.length).toBeGreaterThan(0)
    }
  })

  it('derives an honest default for an entry with no registered spec', () => {
    const spec = defaultSpec(entry({ id: 'vpc', label: 'VPC', category: 'Network', repo: 'hanzoai/vpc' }))
    expect(spec.health).toEqual({ kind: 'none' }) // never fabricates health
    expect(spec.facts.some((f) => f.value === 'Network')).toBe(true) // real category fact
    expect(spec.facts.some((f) => f.value === 'hanzoai/vpc')).toBe(true) // real repo fact
    expect(spec.docs[0].heading).toContain('VPC')
    expect(spec.actions).toEqual([]) // no fabricated actions
  })

  it('falls back to the default when the id is unknown', () => {
    const spec = resolveSpec(entry({ id: 'totally-unregistered' }))
    expect(spec.health).toEqual({ kind: 'none' })
    expect(spec.summary.length).toBeGreaterThan(0)
  })
})

describe('registered specs are honest', () => {
  it('network/security overviews declare a real platform health source', () => {
    for (const id of ['gateway', 'dns', 'cdn', 'mpc']) {
      expect(OVERVIEW_SPECS[id].health.kind).toBe('platform-app')
    }
  })

  it('every registered action navigates to an in-console route (leading slash)', () => {
    for (const spec of Object.values(OVERVIEW_SPECS)) {
      for (const a of spec.actions) {
        expect(a.to.startsWith('/'), `action "${a.label}" must be a native route`).toBe(true)
      }
    }
  })
})
