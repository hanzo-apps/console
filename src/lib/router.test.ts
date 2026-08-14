import { describe, it, expect } from 'vitest'

import { internal, move } from './router'

/**
 * The console navigates on the history API because a static host has no RSC payload
 * for a product address — see the module's own note. These pin the two decisions that
 * are not the browser's: what counts as an address this app draws, and what a call
 * should actually do from where the app already is.
 */
describe('an address this app draws', () => {
  it('is root-relative', () => {
    expect(internal('/profile')).toBe(true)
    expect(internal('/billing/reports?range=7d')).toBe(true)
    expect(internal('/')).toBe(true)
  })

  it('is not another origin — protocol-relative included', () => {
    // `//evil.example` is a URL, not a path: treating it as internal would push a
    // foreign origin into this app's own address bar.
    expect(internal('//evil.example/x')).toBe(false)
    expect(internal('https://hanzo.ai')).toBe(false)
    expect(internal('mailto:z@hanzo.ai')).toBe(false)
    expect(internal('signin')).toBe(false)
  })
})

describe('the move', () => {
  it('pushes a different address', () => {
    expect(move('/profile', '/', 'push')).toBe('push')
    expect(move('/billing?tab=x', '/billing', 'push')).toBe('push')
  })

  it('stays when a push asks for the address already on screen', () => {
    // A duplicate history entry makes Back do nothing visible.
    expect(move('/profile', '/profile', 'push')).toBe('stay')
    expect(move('/billing?tab=x', '/billing?tab=x', 'push')).toBe('stay')
  })

  it('replaces even the current address — that is what replace is for', () => {
    expect(move('/profile', '/profile', 'replace')).toBe('replace')
  })

  it('leaves for anywhere that is not this app', () => {
    expect(move('https://hanzo.ai/pricing', '/', 'push')).toBe('leave')
    expect(move('//evil.example', '/', 'replace')).toBe('leave')
  })
})
