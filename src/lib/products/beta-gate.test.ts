import { describe, expect, it } from 'vitest'

import { filterBeta } from '~/lib/entitlements'

// The registry stamps `beta: true` on every customer Apps entry and
// `visibleCatalog` routes them through this ONE predicate (fail-closed
// default) — the registry itself drags the component tree and stays out of
// unit tests, so the predicate is pinned here in the same pure style as
// `filterEntitled`.
describe('filterBeta — the apps beta gate', () => {
  const entries = [
    { id: 'vector' },
    { id: 'crm', beta: true },
    { id: 'captable', beta: true },
    { id: 'beta-features' }, // the flag surface itself is never behind its own flag
  ]

  it('hides beta entries from a customer without the flag', () => {
    expect(filterBeta(entries, false, false).map((e) => e.id)).toEqual(['vector', 'beta-features'])
  })

  it('the flag reveals them; a superadmin never needed it', () => {
    expect(filterBeta(entries, true, false)).toHaveLength(4)
    expect(filterBeta(entries, false, true)).toHaveLength(4)
  })
})
