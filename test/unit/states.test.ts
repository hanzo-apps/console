import { describe, it, expect } from 'vitest'

import { honestError, asApiError } from '~/components/ui/States'
import { ApiError } from '~/lib/api'

/**
 * Honest async states are the ONE way the console explains a failed load — never
 * a fabricated success, never a generic crash. The status→message mapping is the
 * contract every admin module relies on, so it is pinned here.
 */
describe('honestError', () => {
  it('maps 404 to "Not available on this deployment"', () => {
    expect(honestError(new ApiError('x', 404)).title).toBe('Not available on this deployment')
  })

  it('maps 503 to "Service unavailable"', () => {
    expect(honestError(new ApiError('x', 503)).title).toBe('Service unavailable')
  })

  it('maps 401/403 to "Access required"', () => {
    expect(honestError(new ApiError('x', 401)).title).toBe('Access required')
    expect(honestError(new ApiError('x', 403)).title).toBe('Access required')
  })

  it('treats sign-in/unauthorized messages as access-required even without a status', () => {
    expect(honestError(new ApiError('Please sign in first')).title).toBe('Access required')
    expect(honestError(new ApiError('unauthorized operation')).title).toBe('Access required')
  })

  it('falls back to the raw message for anything else', () => {
    const e = honestError(new ApiError('disk on fire', 500))
    expect(e.title).toBe('Could not load')
    expect(e.body).toBe('disk on fire')
  })

  it('honors per-surface copy overrides for 404 / unauthorized', () => {
    expect(honestError(new ApiError('x', 404), { notFound: 'IAM not routed here' }).body).toBe('IAM not routed here')
    expect(honestError(new ApiError('x', 403), { unauthorized: 'admins only' }).body).toBe('admins only')
  })
})

describe('asApiError', () => {
  it('passes an ApiError through unchanged', () => {
    const e = new ApiError('x', 404)
    expect(asApiError(e)).toBe(e)
  })

  it('wraps a plain Error preserving the message', () => {
    const out = asApiError(new Error('boom'))
    expect(out).toBeInstanceOf(ApiError)
    expect(out.message).toBe('boom')
  })

  it('stringifies a non-Error throw', () => {
    expect(asApiError('weird').message).toBe('weird')
  })
})
