import { afterEach, describe, expect, it } from 'vitest'
import { PRODUCT_SHELLS, shellFor, isProductShell } from './shell'
import { shellFromHost, isSentryHost, brandFromHost, type ShellId } from '~/config'

// Proves the product-shell contract: the descriptor is complete + honest, the host
// resolver selects the right face, and — CRITICAL white-label invariant — the shell
// is ORTHOGONAL to the brand (sentry.hanzo.ai is the hanzo brand wearing the Sentry
// face; the shell never crosses a brand). Pure (host passed in / env restored), so
// no window mocking.

const ALL: ShellId[] = ['console', 'billing', 'sentry']

afterEach(() => {
  delete process.env.NEXT_PUBLIC_PRODUCT_SHELL
  delete process.env.NEXT_PUBLIC_BILLING_ONLY
})

describe('product-shell descriptor', () => {
  it('declares every shell id, keyed to itself', () => {
    for (const id of ALL) {
      expect(PRODUCT_SHELLS[id].id).toBe(id)
      expect(shellFor(id)).toBe(PRODUCT_SHELLS[id])
    }
  })

  it('console is the full catalog (no root, no home, no wordmark)', () => {
    const c = shellFor('console')
    expect(c.rootId).toBeNull()
    expect(c.home).toBe('')
    expect(c.wordmark).toBe('')
    expect(isProductShell('console')).toBe(false)
  })

  it('billing + sentry are single-product faces (root + home set)', () => {
    for (const id of ['billing', 'sentry'] as ShellId[]) {
      const s = shellFor(id)
      expect(s.rootId).toBe(id)
      expect(s.home).toBe(id)
      expect(isProductShell(id)).toBe(true)
    }
  })

  it('sentry wears the "Sentry" wordmark + boots into Issues; billing keeps mark-only + Overview', () => {
    expect(shellFor('sentry').wordmark).toBe('Sentry')
    expect(shellFor('sentry').indexLabel).toBe('Issues')
    // billing is unchanged — the brand mark alone, index labelled Overview.
    expect(shellFor('billing').wordmark).toBe('')
    expect(shellFor('billing').indexLabel).toBe('Overview')
  })
})

describe('shellFromHost', () => {
  it('a sentry.<brand> host wears the sentry face', () => {
    expect(shellFromHost('sentry.hanzo.ai')).toBe('sentry')
    expect(shellFromHost('sentry.lux.cloud')).toBe('sentry')
    expect(isSentryHost('sentry.hanzo.ai')).toBe(true)
  })

  it('a billing.<brand> host wears the billing face (unchanged)', () => {
    expect(shellFromHost('billing.hanzo.ai')).toBe('billing')
  })

  it('every other host is the full console', () => {
    expect(shellFromHost('cloud.hanzo.ai')).toBe('console')
    expect(shellFromHost('console.hanzo.ai')).toBe('console')
    expect(shellFromHost('admin.hanzo.ai')).toBe('console')
    expect(shellFromHost('')).toBe('console')
    expect(shellFromHost(undefined)).toBe('console')
  })

  it('NEXT_PUBLIC_PRODUCT_SHELL overrides the host (dev/preview)', () => {
    process.env.NEXT_PUBLIC_PRODUCT_SHELL = 'sentry'
    expect(shellFromHost('cloud.hanzo.ai')).toBe('sentry')
    process.env.NEXT_PUBLIC_PRODUCT_SHELL = 'console'
    expect(shellFromHost('sentry.hanzo.ai')).toBe('console')
  })

  it('the legacy NEXT_PUBLIC_BILLING_ONLY=1 still selects billing', () => {
    process.env.NEXT_PUBLIC_BILLING_ONLY = '1'
    expect(shellFromHost('cloud.hanzo.ai')).toBe('billing')
  })

  it('WHITE-LABEL: the shell is orthogonal to the brand — sentry.<brand> keeps its brand', () => {
    // The face is Sentry, but the BRAND (IAM/wordmark) is the host's own brand — a
    // Sentry face never crosses a brand.
    expect(brandFromHost('sentry.hanzo.ai')).toBe('hanzo')
    expect(brandFromHost('sentry.lux.cloud')).toBe('lux')
    expect(brandFromHost('sentry.zoo.ngo')).toBe('zoo')
  })
})
