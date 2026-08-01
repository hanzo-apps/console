import { describe, expect, it } from 'vitest'

import { identityTraits } from './Analytics'
import { type Account } from '~/lib/api/types'

const account = (over: Partial<Account> = {}): Account => ({
  owner: 'hanzo',
  name: 'z',
  userId: 'sub-1',
  ...over,
})

describe('identityTraits', () => {
  it('carries the email and the human name off the IAM claims', () => {
    expect(
      identityTraits(account({ email: 'z@hanzo.ai', displayName: 'Z Hanzo' })),
    ).toEqual({ email: 'z@hanzo.ai', name: 'Z Hanzo' })
  })

  it('falls back to the login handle when no display name was claimed', () => {
    expect(identityTraits(account({ email: 'z@hanzo.ai' }))).toEqual({
      email: 'z@hanzo.ai',
      name: 'z',
    })
  })

  // An absent claim must be ABSENT, not `undefined`: a trait sent as undefined
  // is a trait written, and it would blank a value an earlier identify had set.
  it('omits a key it has no claim for rather than sending undefined', () => {
    const traits = identityTraits(account({ displayName: 'Z Hanzo' }))
    expect(traits).toEqual({ name: 'Z Hanzo' })
    expect('email' in traits).toBe(false)
  })

  // The tenant is stamped server-side from the validated bearer. A tenant the
  // client can name is a tenant the client can get wrong.
  it('never sends the org', () => {
    const traits = identityTraits(
      account({ email: 'z@hanzo.ai', organization: 'hanzo', owner: 'hanzo' }),
    )
    expect(traits).not.toHaveProperty('org')
    expect(traits).not.toHaveProperty('organization')
    expect(traits).not.toHaveProperty('owner')
  })
})
