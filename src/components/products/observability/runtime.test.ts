/**
 * The classifier tested against the statuses `/v1/o11y` REALLY answers.
 *
 * Every status and message below was measured against the live runtime through
 * the console's own `/v1` bearer proxy — not invented. That is the point: the
 * previous code had no test at all, and its one un-exercised branch reported a
 * reachable, serving backend as an uninitialized one.
 */
import { describe, it, expect } from 'vitest'

import { ApiError } from '~/lib/api/client'
import { classifyRuntime, runtimeCopy } from './runtime'

/** Statuses observed on the live surface, with the reason the runtime gave. */
const LIVE = {
  notInitialized: new ApiError('o11y traces: datastore not connected', 503),
  method: new ApiError('Method Not Allowed', 405),
  failed: new ApiError('failed to fetch evolution from datastore code: 81, message: Database o11y_metadata does not exist', 500),
  unavailable: new ApiError('404 page not found', 404),
  access: new ApiError('no validated principal', 403),
  signin: new ApiError('Not authorized', 401),
}

describe('classifyRuntime maps each live status to what actually happened', () => {
  it.each([
    ['not-initialized', LIVE.notInitialized],
    ['method', LIVE.method],
    ['failed', LIVE.failed],
    ['unavailable', LIVE.unavailable],
    ['access', LIVE.access],
    ['signin', LIVE.signin],
  ])('%s', (want, err) => {
    expect(classifyRuntime(err)).toBe(want)
  })

  it('a read that never reached HTTP is an error, not a verdict about the runtime', () => {
    expect(classifyRuntime(new Error('Network request failed'))).toBe('error')
    expect(classifyRuntime(null)).toBe('error')
  })

  it('502/504 are the runtime failing, NOT the runtime being uninitialized', () => {
    expect(classifyRuntime(new ApiError('Upstream service is unavailable.', 502))).toBe('failed')
    expect(classifyRuntime(new ApiError('timeout', 504))).toBe('failed')
  })
})

describe('403, 405 and 503 each get their own honest copy', () => {
  const c403 = runtimeCopy('traces', LIVE.access)
  const c405 = runtimeCopy('traces', LIVE.method)
  const c503 = runtimeCopy('traces', LIVE.notInitialized)
  const c500 = runtimeCopy('traces', LIVE.failed)

  it('all four are distinct — no two failures wear the same words', () => {
    const titles = [c403.title, c405.title, c503.title, c500.title]
    const bodies = [c403.body, c405.body, c503.body, c500.body]
    expect(new Set(titles).size).toBe(4)
    expect(new Set(bodies).size).toBe(4)
  })

  it('ONLY the 503 says the store is not ready — and quotes the runtime saying it', () => {
    expect(c503.body).toContain('datastore not connected')
    for (const c of [c403, c405, c500]) {
      expect(c.title).not.toMatch(/not ready|initializ/i)
      expect(c.body).not.toMatch(/not ready|initializ/i)
    }
  })

  it('the 405 names it a console defect over a live runtime, never an outage', () => {
    expect(c405.body).toContain('405')
    expect(c405.body).toMatch(/defect in the console/i)
    expect(c405.body).toMatch(/up and serving/i)
  })

  it('the 500 says the runtime was REACHED and quotes its own error', () => {
    expect(c500.body).toMatch(/was reached/i)
    expect(c500.body).toContain('Database o11y_metadata does not exist')
  })

  it('the 403 is about the org, and never tells a signed-in user to sign in', () => {
    expect(c403.body).toMatch(/organization/i)
    expect(c403.body).not.toMatch(/sign in/i)
  })

  it('every branch names the endpoint it is talking about', () => {
    for (const c of [c405, c503, c500, runtimeCopy('traces', LIVE.unavailable)]) {
      expect(c.body).toContain('/v1/o11y/traces')
    }
  })

  it('carries the surface into the copy, so two surfaces never read identically', () => {
    expect(runtimeCopy('services', LIVE.unavailable).body).toContain('/v1/o11y/services')
    expect(runtimeCopy('logs', LIVE.unavailable).body).toContain('/v1/o11y/logs')
  })

  it('a reason-less failure degrades to the plain sentence, never a dangling dash', () => {
    const c = runtimeCopy('traces', new ApiError('', 503))
    expect(c.body).not.toContain('—')
    expect(c.body).toContain('/v1/o11y/traces')
  })
})
