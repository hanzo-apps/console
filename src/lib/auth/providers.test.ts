import { describe, expect, it } from 'vitest'

import { signInProvidersOf } from './providers'

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
      { name: 'provider-gitlab', canSignIn: true, provider: { type: 'GitLab' } },
      { name: 'provider-apple', canSignIn: false, provider: { type: 'Apple' } },
    ],
  },
}

describe('signInProvidersOf', () => {
  it('maps the live payload to {name, type} in IAM order, honoring canSignIn', () => {
    // gitlab (canSignIn=true) is included; apple (canSignIn=false) is dropped —
    // the list is exactly what IAM says the app can sign in with, no hardcode.
    expect(signInProvidersOf(live)).toEqual([
      { name: 'provider-github', type: 'GitHub' },
      { name: 'provider-google', type: 'Google' },
      { name: 'provider-web3', type: 'Web3Onboard' },
      { name: 'provider-gitlab', type: 'GitLab' },
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

  it('returns [] on empty/garbage payloads — no social buttons, never a hardcoded guess', () => {
    expect(signInProvidersOf(null)).toEqual([])
    expect(signInProvidersOf({})).toEqual([])
    expect(signInProvidersOf({ data: { providers: [] } })).toEqual([])
    expect(signInProvidersOf({ data: { providers: 'nope' } })).toEqual([])
    expect(signInProvidersOf('garbage')).toEqual([])
  })
})
