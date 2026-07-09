import { describe, it, expect } from 'vitest'

import {
  slugifyProjectName,
  isValidProjectSlug,
  appEditUrl,
  chatProjectUrl,
  crossSurfaceLinks,
  PROJECT_PARAM,
} from './cross-surface'

describe('slugifyProjectName (the shared key must be slug-safe)', () => {
  it('lowercases + hyphenates a friendly name', () => {
    expect(slugifyProjectName('My App')).toBe('my-app')
  })
  it('is idempotent on an already-clean slug', () => {
    expect(slugifyProjectName('my-app')).toBe('my-app')
  })
  it('collapses runs + trims separators', () => {
    expect(slugifyProjectName('  Foo   Bar!!  ')).toBe('foo-bar')
  })
  it('drops an all-symbol name to empty (caller rejects it)', () => {
    expect(slugifyProjectName('!!!')).toBe('')
  })
  it('caps at 40 chars with no trailing dash', () => {
    const s = slugifyProjectName('a'.repeat(60))
    expect(s.length).toBeLessThanOrEqual(40)
    expect(s.endsWith('-')).toBe(false)
  })
})

describe('isValidProjectSlug', () => {
  it('accepts a clean slug, rejects the rest', () => {
    expect(isValidProjectSlug('my-app')).toBe(true)
    expect(isValidProjectSlug('My App')).toBe(false)
    expect(isValidProjectSlug('-x')).toBe(false)
    expect(isValidProjectSlug('')).toBe(false)
  })
})

describe('cross-surface deep links — ONE shared key, injection-safe', () => {
  it('exchanges the key under the "project" param', () => {
    expect(PROJECT_PARAM).toBe('project')
  })
  it('appEditUrl matches the established hanzo.app convention (/dev?project=)', () => {
    expect(appEditUrl('my-app', 'https://hanzo.app')).toBe('https://hanzo.app/dev?project=my-app')
  })
  it('chatProjectUrl opens hanzo.chat scoped to the project (/?project=)', () => {
    expect(chatProjectUrl('my-app', 'https://hanzo.chat')).toBe('https://hanzo.chat/?project=my-app')
  })
  it('URL-encodes the id so it can never inject a second param', () => {
    const u = chatProjectUrl('a&b=c', 'https://hanzo.chat')
    expect(u).toContain('project=a%26b%3Dc')
    expect(u.split('?')[1].split('&')).toHaveLength(1) // exactly one query param
  })
  it('crossSurfaceLinks returns both surfaces keyed on the SAME id', () => {
    const l = crossSurfaceLinks('my-app', { appUrl: 'https://hanzo.app', chatUrl: 'https://hanzo.chat' })
    expect(l.editInApp).toBe('https://hanzo.app/dev?project=my-app')
    expect(l.chatAbout).toBe('https://hanzo.chat/?project=my-app')
  })
})
