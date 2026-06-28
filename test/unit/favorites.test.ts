import { describe, it, expect } from 'vitest'

import { DEFAULT_PINNED } from '~/lib/products/favorites'
import { findEntry } from '~/lib/products/registry'

/**
 * First-run pins are shown in the sidebar before the user customizes them. The
 * shell renders pins by resolving each id against the catalog and dropping
 * unknown ids — so a default that names a NON-EXISTENT product silently vanishes
 * (the user sees fewer pins than intended). Every default MUST resolve.
 */
describe('DEFAULT_PINNED', () => {
  it('is non-empty', () => {
    expect(DEFAULT_PINNED.length).toBeGreaterThan(0)
  })

  it('every default pin resolves to a real catalog entry (no dead pins)', () => {
    for (const id of DEFAULT_PINNED) {
      expect(findEntry(id), `default pin "${id}" must exist in the catalog`).toBeDefined()
    }
  })
})
