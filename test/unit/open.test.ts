import { describe, it, expect, vi, beforeEach } from 'vitest'

import { openProduct } from '~/lib/products/open'
import { findEntry } from '~/lib/products/registry'

/**
 * `openProduct` is the ONE place that knows how each catalog kind opens:
 * in-console modules navigate via the router; external surfaces open a new tab.
 */
describe('openProduct', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('navigates in-console for a module entry (no new tab)', () => {
    const push = vi.fn()
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    openProduct(findEntry('models')!, push)
    expect(push).toHaveBeenCalledWith('/models')
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('opens an external entry in a new noopener tab (no router push)', () => {
    const push = vi.fn()
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const gateway = findEntry('gateway')!
    expect(gateway.kind).toBe('external')
    openProduct(gateway, push)
    expect(openSpy).toHaveBeenCalledWith((gateway as { href: string }).href, '_blank', 'noopener')
    expect(push).not.toHaveBeenCalled()
  })
})
