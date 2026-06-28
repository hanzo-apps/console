import { describe, it, expect, beforeEach } from 'vitest'

import {
  pkceChallenge,
  buildAuthorizeUrl,
  consumeState,
  consumeCodeVerifier,
  describeAuthError,
} from '~/lib/auth/iam'

describe('PKCE S256', () => {
  it('matches the RFC 7636 Appendix B test vector', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })
})

describe('authorize URL — state always, PKCE gated', () => {
  beforeEach(() => sessionStorage.clear())

  it('stamps a random state, persists it, and emits NO PKCE by default', async () => {
    const url = new URL(await buildAuthorizeUrl())
    const state = url.searchParams.get('state')
    expect(state).toBeTruthy()
    expect(state!.length).toBeGreaterThanOrEqual(20) // not the old fixed appName
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toContain('/auth/callback')
    expect(url.searchParams.get('client_id')).toBeTruthy()
    expect(url.searchParams.has('code_challenge')).toBe(false)
    expect(sessionStorage.getItem('console2.oauth.state')).toBe(state)
  })

  it('produces a distinct state on each start (no fixed/guessable state)', async () => {
    const a = new URL(await buildAuthorizeUrl()).searchParams.get('state')
    const b = new URL(await buildAuthorizeUrl()).searchParams.get('state')
    expect(a).not.toBe(b)
  })

  it('emits an S256 challenge bound to the stored verifier when PKCE is on', async () => {
    const url = new URL(await buildAuthorizeUrl({ pkce: true }))
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    const challenge = url.searchParams.get('code_challenge')!
    const verifier = sessionStorage.getItem('console2.oauth.verifier')!
    expect(verifier).toBeTruthy()
    expect(await pkceChallenge(verifier)).toBe(challenge)
  })

  it('hints a social provider when asked', async () => {
    const url = new URL(await buildAuthorizeUrl({ provider: 'provider-github' }))
    expect(url.searchParams.get('provider_hint')).toBe('provider-github')
  })
})

describe('one-time consumption', () => {
  beforeEach(() => sessionStorage.clear())

  it('consumeState returns then clears', async () => {
    await buildAuthorizeUrl()
    expect(consumeState()).toBeTruthy()
    expect(consumeState()).toBeNull()
  })

  it('consumeCodeVerifier returns then clears (PKCE on)', async () => {
    await buildAuthorizeUrl({ pkce: true })
    expect(consumeCodeVerifier()).toBeTruthy()
    expect(consumeCodeVerifier()).toBeNull()
  })
})

describe('IdP error messages', () => {
  it('prefers the provided description', () => {
    expect(describeAuthError('access_denied', 'You said no')).toBe('You said no')
  })
  it('maps known codes and falls back for unknown', () => {
    expect(describeAuthError('access_denied')).toMatch(/cancel/i)
    expect(describeAuthError('weird_code')).toContain('weird_code')
  })
})
