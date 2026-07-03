import { describe, expect, it } from 'vitest'

import {
  slugify,
  isValidSlug,
  validateBase,
  SIZE_PRESETS,
  DEFAULT_SIZE,
  specForSize,
  sizeForSpec,
  specSummary,
  statusOf,
  baseHref,
} from './bases-logic'
import { normalizeBase } from '~/lib/base-data/tenants'

describe('slugify — free text → a DNS-label slug', () => {
  it('lowercases, hyphenates, and trims', () => {
    expect(slugify('  My Blog Base! ')).toBe('my-blog-base')
    expect(slugify('Acme CRM Test')).toBe('acme-crm-test')
    expect(slugify('a__b--c')).toBe('a-b-c')
  })
  it('caps at 40 chars with no trailing hyphen', () => {
    const s = slugify('x'.repeat(60))
    expect(s.length).toBeLessThanOrEqual(40)
    expect(s.endsWith('-')).toBe(false)
  })
})

describe('isValidSlug', () => {
  it('accepts DNS labels', () => {
    expect(isValidSlug('my-base')).toBe(true)
    expect(isValidSlug('a')).toBe(true)
    expect(isValidSlug('base1')).toBe(true)
  })
  it('rejects invalid shapes', () => {
    expect(isValidSlug('-lead')).toBe(false)
    expect(isValidSlug('trail-')).toBe(false)
    expect(isValidSlug('Upper')).toBe(false)
    expect(isValidSlug('has space')).toBe(false)
    expect(isValidSlug('under_score')).toBe(false)
    expect(isValidSlug('')).toBe(false)
  })
})

describe('validateBase', () => {
  it('requires a name and a valid, unique, non-reserved slug', () => {
    expect(validateBase('My Base', 'my-base').ok).toBe(true)
    expect(validateBase('', 'my-base').nameError).toBeTruthy()
    expect(validateBase('My Base', '').slugError).toBeTruthy()
    expect(validateBase('My Base', 'Bad Slug').slugError).toBeTruthy()
    expect(validateBase('My Base', 'new').slugError).toBeTruthy() // reserved route word
    expect(validateBase('My Base', 'taken', ['taken']).slugError).toContain('already exists')
  })
})

describe('size presets', () => {
  it('round-trips a preset id through spec', () => {
    for (const p of SIZE_PRESETS) {
      expect(specForSize(p.id)).toEqual(p.spec)
      expect(sizeForSpec(p.spec)).toBe(p.id)
    }
  })
  it('default is a real preset; an unknown spec is custom', () => {
    expect(SIZE_PRESETS.some((p) => p.id === DEFAULT_SIZE)).toBe(true)
    expect(sizeForSpec({ replicas: 7, storage: '999Gi' })).toBe('custom')
  })
  it('summarizes a spec, honest — for empty', () => {
    expect(specSummary({ replicas: 2, storage: '10Gi' })).toBe('2 replicas · 10Gi')
    expect(specSummary({ replicas: 1 })).toBe('1 replica')
    expect(specSummary({})).toBe('—')
  })
})

describe('statusOf — provisioning lifecycle', () => {
  it('error wins over everything', () => {
    expect(statusOf({ status: 'Ready', subdomain: 'x.base.hanzo.ai', lastError: 'boom' }).tone).toBe('error')
    expect(statusOf({ status: 'failed', subdomain: '', lastError: '' }).tone).toBe('error')
  })
  it('ready only once a subdomain exists', () => {
    expect(statusOf({ status: '', subdomain: 'x.base.hanzo.ai', lastError: '' })).toMatchObject({ tone: 'ready', ready: true })
    expect(statusOf({ status: 'Ready', subdomain: 'x.base.hanzo.ai', lastError: '' }).ready).toBe(true)
  })
  it('provisioning while there is no subdomain yet', () => {
    expect(statusOf({ status: '', subdomain: '', lastError: '' })).toMatchObject({ label: 'Provisioning', tone: 'pending', ready: false })
    expect(statusOf({ status: 'Pending', subdomain: '', lastError: '' })).toMatchObject({ tone: 'pending', ready: false })
  })
})

describe('baseHref', () => {
  it('builds a URL from a bare subdomain, passes through an absolute one, null while provisioning', () => {
    expect(baseHref({ subdomain: 'acme.base.hanzo.ai' })).toBe('https://acme.base.hanzo.ai')
    expect(baseHref({ subdomain: 'https://acme.base.hanzo.ai' })).toBe('https://acme.base.hanzo.ai')
    expect(baseHref({ subdomain: '' })).toBeNull()
  })
})

describe('normalizeBase — defensive over the tenants wire shape', () => {
  it('reads the real record shape and folds spec', () => {
    const b = normalizeBase({
      id: 'yj1om5gz64endii',
      name: 'Acme CRM Test',
      slug: 'acme-crm-test',
      spec: { replicas: 3, storage: '10Gi' },
      status: '',
      subdomain: '',
      last_error: '',
    })
    expect(b).toMatchObject({ id: 'yj1om5gz64endii', name: 'Acme CRM Test', slug: 'acme-crm-test' })
    expect(b.spec).toEqual({ replicas: 3, storage: '10Gi' })
  })
  it('falls back name→slug and tolerates missing/garbage fields', () => {
    expect(normalizeBase({ slug: 'only-slug' }).name).toBe('only-slug')
    expect(normalizeBase({ spec: 'nope' as unknown as object }).spec).toEqual({})
    expect(normalizeBase(null)).toMatchObject({ id: '', name: '', slug: '' })
  })
})
