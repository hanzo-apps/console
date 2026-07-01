import { describe, expect, it } from 'vitest'
import { type NextRequest } from 'next/server'

import { errorBody, upstreamHeaders } from './bearer-proxy'

/** A minimal NextRequest stand-in — the header rebuild only reads `headers.get`. */
const reqWith = (headers: Record<string, string>): NextRequest =>
  ({ headers: new Headers(headers) }) as unknown as NextRequest

describe('errorBody', () => {
  it('shapes the AI/OpenAI envelope with a code', () => {
    expect(errorBody('openai', 'Sign in.', 'unauthenticated')).toEqual({
      error: { message: 'Sign in.', type: 'unauthenticated', code: 'unauthenticated' },
    })
  })

  it('shapes the casibase envelope', () => {
    expect(errorBody('casibase', 'nope')).toEqual({ status: 'error', msg: 'nope' })
  })

  it('shapes the plain envelope (default)', () => {
    expect(errorBody('plain', 'boom')).toEqual({ error: 'boom' })
  })
})

describe('upstreamHeaders', () => {
  it('stamps the token owner as X-Org-Id and never leaks the browser cookie or its X-Org-Id', () => {
    const req = reqWith({ cookie: 'session=leak', 'X-Org-Id': 'evil-tenant' })
    const h = upstreamHeaders(req, 'maxpower', false, {})
    expect(h['X-Org-Id']).toBe('maxpower') // the OWNER, not the browser's spoof
    expect(h.cookie).toBeUndefined()
    expect(h.Cookie).toBeUndefined()
    expect(h.Authorization).toBeUndefined() // added by the caller after the mint
    expect(h['Content-Type']).toBeUndefined() // no body
  })

  it('adds Content-Type only when the request carries a body', () => {
    const h = upstreamHeaders(reqWith({}), 'maxpower', true, {})
    expect(h['Content-Type']).toBe('application/json')
  })

  it('forwards the tenant sub-scope only when forwardScope is set and present', () => {
    const req = reqWith({ 'X-Project-Id': 'proj-1', 'X-Environment': 'mainnet' })
    expect(upstreamHeaders(req, 'maxpower', false, {})['X-Project-Id']).toBeUndefined()
    const scoped = upstreamHeaders(req, 'maxpower', false, { forwardScope: true })
    expect(scoped['X-Project-Id']).toBe('proj-1')
    expect(scoped['X-Environment']).toBe('mainnet')
  })

  it('merges caller extra headers (e.g. the AI retrieval switch)', () => {
    const h = upstreamHeaders(reqWith({}), 'maxpower', false, { extraHeaders: { 'X-Retrieval': '1' } })
    expect(h['X-Retrieval']).toBe('1')
    expect(h['X-Org-Id']).toBe('maxpower')
  })
})
