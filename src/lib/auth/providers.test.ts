import { describe, expect, it } from 'vitest'

import { FALLBACK_PROVIDERS, signInProvidersOf } from './providers'

// The live get-app-login shape (hanzo-cloud, verified live): providers[] items
// carry the app-provider binding {name, canSignIn} + the nested provider {type}.
const live = {
  status: 'ok',
  data: {
    name: 'hanzo-cloud',
    providers: [
      { name: 'provider-github', canSignIn: true, provider: { type: 'GitHub' } },
      { name: 'provider-google', canSignIn: true, provider: { type: 'Google' } },
      { name: 'provider-web3', canSignIn: true, provider: { type: 'Web3Onboard' } },
      { name: 'provider-apple', canSignIn: true, provider: { type: 'Apple' } },
    ],
  },
}

describe('signInProvidersOf', () => {
  it('maps the live payload to {name, type}', () => {
    expect(signInProvidersOf(live)).toEqual([
      { name: 'provider-github', type: 'GitHub' },
      { name: 'provider-google', type: 'Google' },
      { name: 'provider-web3', type: 'Web3Onboard' },
      { name: 'provider-apple', type: 'Apple' },
    ])
  })

  it('filters canSignIn=false and rows missing name/type', () => {
    const p = signInProvidersOf({
      data: {
        providers: [
          { name: 'provider-github', canSignIn: false, provider: { type: 'GitHub' } },
          { name: '', canSignIn: true, provider: { type: 'Google' } },
          { name: 'provider-x', canSignIn: true, provider: {} },
          { name: 'provider-google', canSignIn: true, provider: { type: 'Google' } },
        ],
      },
    })
    expect(p).toEqual([{ name: 'provider-google', type: 'Google' }])
  })

  it('returns null (→ fallback) on empty/garbage payloads', () => {
    expect(signInProvidersOf(null)).toBeNull()
    expect(signInProvidersOf({})).toBeNull()
    expect(signInProvidersOf({ data: { providers: [] } })).toBeNull()
    expect(signInProvidersOf({ data: { providers: 'nope' } })).toBeNull()
    expect(signInProvidersOf('garbage')).toBeNull()
  })

  it('fallback is the set verified live to auto-advance — and never GitLab', () => {
    expect(FALLBACK_PROVIDERS.map((p) => p.type)).toEqual(['GitHub', 'Google', 'Web3Onboard'])
    expect(FALLBACK_PROVIDERS.some((p) => p.type === 'GitLab')).toBe(false)
  })
})
