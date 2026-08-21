import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveRoute, slugOf } from './match-core'
import type { ProductModule } from './registry'

/**
 * `/integrations/<provider>` has to resolve.
 *
 * It did not, and how it failed is the point: the console served its own
 * not-found page — "Nothing is served at /integrations/cloudflare" — which reads
 * as the product being missing rather than the address being wrong. The product
 * was there the whole time; the entry mounted only its index, so every link that
 * named a provider died on arrival. `internal-links.test.ts` says outright that
 * this class — a wrong SUB-path under a real product — is not caught by it and
 * belongs to the module's own routing test. This is that test.
 *
 * The registry is read as TEXT, for the reason the neighbouring tests give: it
 * cannot be imported under vitest (icon ESM), and a fixture mirroring it proves
 * nothing about the file that ships. So the declaration is asserted from source
 * and the MATCHING is exercised against the real matcher.
 */
const REGISTRY = readFileSync(join(__dirname, 'registry.tsx'), 'utf8')

describe('connectors deep link', () => {
  it('declares the :provider sub-route in the shipped registry', () => {
    // The entry, from `id: 'integrations'` to the end of its routes array.
    const entry = REGISTRY.slice(REGISTRY.indexOf("id: 'integrations',"))
    const routes = entry.slice(entry.indexOf('routes:'), entry.indexOf('],') + 2)
    expect(routes).toContain("{ path: '', component: OrgConnectorsModule }")
    expect(routes).toContain("{ path: ':provider', component: OrgConnectorsModule }")
  })

  it('resolves a provider path against the real matcher', () => {
    // The shape the registry declares, exercised through the matcher that ships.
    const modules = [
      {
        id: 'integrations',
        routes: [
          { path: '', component: null },
          { path: ':provider', component: null },
        ],
      },
    ] as unknown as ProductModule[]

    const one = resolveRoute(modules, slugOf('/integrations/cloudflare'))
    expect(one?.module.id).toBe('integrations')
    expect(one?.route.path).toBe(':provider')
    expect(one?.params).toEqual({ provider: 'cloudflare' })

    // The index still answers, which is the regression a new sub-route can cause.
    const index = resolveRoute(modules, slugOf('/integrations'))
    expect(index?.route.path).toBe('')
    expect(index?.params).toEqual({})

    // Any id, not a list to maintain: the page renders whatever the cloud
    // returns, so a second copy of "which providers exist" would go stale the
    // day a connector ships.
    for (const id of ['slack', 'github', 'something-new']) {
      expect(resolveRoute(modules, slugOf(`/integrations/${id}`))?.params).toEqual({ provider: id })
    }
  })
})
