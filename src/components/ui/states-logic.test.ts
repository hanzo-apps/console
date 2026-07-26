import { describe, it, expect } from 'vitest'

import { honestError } from './states-logic'
import { ApiError } from '~/lib/api'

/**
 * `honestError` is the ONE mapper the console uses to explain a failed `/v1` read.
 * These lock the status → honest-state contract, with the 402 → top-up branch (an
 * unfunded org must see "Add credits", never a dead "Could not load").
 */
describe('honestError', () => {
  it('maps a 402 to the top-up state — funded-balance prompt, never "Could not load"', () => {
    const s = honestError(new ApiError('Insufficient balance. Please add credits to continue.', 402))
    expect(s.topUp).toBe(true)
    expect(s.title).toMatch(/credit/i)
    expect(s.title).not.toMatch(/could not load/i)
    // 402 is a top-up, NOT a re-auth — a funded org, not a lapsed session.
    expect(s.reauth).toBeUndefined()
    expect(s.body).toBeTruthy()
  })

  it('does not let a surface `copy` override suppress the 402 top-up branch', () => {
    const s = honestError(new ApiError('Insufficient balance', 402), {
      notFound: 'custom',
      unauthorized: 'custom',
    })
    expect(s.topUp).toBe(true)
    expect(s.title).toMatch(/credit/i)
  })

  it('keeps 401 (re-auth) and 402 (top-up) as DISTINCT affordances', () => {
    const lapsed = honestError(new ApiError('Not authorized', 401))
    expect(lapsed.reauth).toBe(true)
    expect(lapsed.topUp).toBeUndefined()

    const unfunded = honestError(new ApiError('Insufficient balance', 402))
    expect(unfunded.topUp).toBe(true)
    expect(unfunded.reauth).toBeUndefined()
  })

  it('still maps 404/503/403 and a generic failure honestly (no regression)', () => {
    expect(honestError(new ApiError('x', 404)).title).toMatch(/not available/i)
    expect(honestError(new ApiError('x', 503)).title).toMatch(/unavailable/i)

    const forbidden = honestError(new ApiError('x', 403))
    expect(forbidden.title).toMatch(/access/i)
    expect(forbidden.reauth).toBeUndefined()
    expect(forbidden.topUp).toBeUndefined()

    const generic = honestError(new ApiError('boom', 0))
    expect(generic.title).toBe('Could not load')
    expect(generic.body).toBe('boom')
    expect(generic.topUp).toBeUndefined()
  })
})

describe('402 — subscription vs balance are different asks', () => {
  it('routes a paywall subscription_required to plans, not to credits', () => {
    // The gate answers {"error":"subscription_required"}; the API clients surface
    // that token as the message.
    const s = honestError(new ApiError('subscription_required', 402))
    expect(s.subscribe).toBe(true)
    expect(s.topUp).toBeFalsy()
    expect(s.reauth).toBeFalsy()
    expect(s.title).toMatch(/subscribe/i)
    // Never "Could not load" — a planless org is not a crash.
    expect(s.title).not.toMatch(/could not load/i)
  })

  it('still treats a plain 402 as a top-up', () => {
    const s = honestError(new ApiError('Insufficient balance. Please add credits to continue.', 402))
    expect(s.topUp).toBe(true)
    expect(s.subscribe).toBeFalsy()
  })

  it('does not offer credits to a planless org — they cannot be spent', () => {
    // The regression this guards: buying credits does not satisfy the paywall, so
    // the very next request 402s again and the user is stuck in a loop.
    const s = honestError(new ApiError('subscription_required', 402))
    expect(s.topUp).toBeFalsy()
  })
})
