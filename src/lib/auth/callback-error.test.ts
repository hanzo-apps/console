import { describe, expect, it } from 'vitest'

import { classifyCallback } from './callback-error'

describe('classifyCallback', () => {
  it('is null when the callback carries no error, so the success path is untouched', () => {
    expect(classifyCallback('?code=abc&state=xyz')).toBeNull()
    expect(classifyCallback('')).toBeNull()
  })

  // The ordinary answer to a silent attempt. Telling someone the product failed
  // because they were not signed in is the defect this whole module exists to fix.
  it.each(['login_required', 'interaction_required', 'consent_required'])(
    'treats %s as "sign in", not a failure',
    (code) => {
      const v = classifyCallback(`?error=${code}&state=s`)
      expect(v?.kind).toBe('signin')
      expect(v?.message).toMatch(/sign in/i)
      expect(v?.message).not.toMatch(/failed/i)
    },
  )

  it('treats a declined consent as the person’s choice, not a fault', () => {
    const v = classifyCallback('?error=access_denied&state=s')
    expect(v?.kind).toBe('declined')
    expect(v?.message).toMatch(/cancelled/i)
    expect(v?.message).not.toMatch(/failed/i)
  })

  it('prefers the issuer’s own words for an unrecognized code', () => {
    const v = classifyCallback('?error=server_error&error_description=Upstream+is+down')
    expect(v).toEqual({ kind: 'failed', message: 'Upstream is down' })
  })

  it('names the code when the issuer described nothing', () => {
    const v = classifyCallback('?error=temporarily_unavailable')
    expect(v?.kind).toBe('failed')
    expect(v?.message).toContain('temporarily_unavailable')
  })

  // A redirect is attacker-reachable, so its text may not set the size of the screen.
  it('bounds an unbounded description and code', () => {
    const long = 'x'.repeat(5000)
    const v = classifyCallback(`?error=weird&error_description=${long}`)
    expect(v?.message.length).toBeLessThanOrEqual(200)

    const wide = classifyCallback(`?error=${'c'.repeat(5000)}`)
    expect(wide?.message.length).toBeLessThan(120)
  })

  it('survives a malformed query rather than throwing on the callback screen', () => {
    expect(() => classifyCallback('%')).not.toThrow()
    expect(() => classifyCallback('?error=%E0%A4%A')).not.toThrow()
  })
})
