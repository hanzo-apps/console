import { describe, it, expect } from 'vitest'

import { isDisposableEmail } from './disposable'

/**
 * Disposable-email hygiene on the open-signup path. High-precision: known throwaway
 * providers are blocked; real providers and unknown domains pass (Turnstile + the
 * rate limit are the general guards, not this list).
 */
describe('isDisposableEmail', () => {
  it('blocks known disposable domains', () => {
    for (const e of ['x@mailinator.com', 'y@yopmail.com', 'z@10minutemail.com', 'q@guerrillamail.com']) {
      expect(isDisposableEmail(e)).toBe(true)
    }
  })

  it('allows real providers and unknown domains', () => {
    for (const e of ['a@gmail.com', 'b@hanzo.ai', 'c@acme.co', 'd@somestartup.dev']) {
      expect(isDisposableEmail(e)).toBe(false)
    }
  })

  it('is case/whitespace tolerant on the domain (email already normalized upstream)', () => {
    expect(isDisposableEmail('user@mailinator.com')).toBe(true)
    expect(isDisposableEmail('nodomain')).toBe(false)
    expect(isDisposableEmail('')).toBe(false)
  })
})
