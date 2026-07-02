import { describe, it, expect } from 'vitest'

import { isSpaFallthrough } from './client'

/**
 * When a `/v1/<head>` route is not mounted on a deployment (e.g. o11y before the
 * datastore is wired), the request falls through to the Next.js catch-all and
 * comes back as `200 text/html` — the SPA shell. The transport must detect that
 * and re-throw as a 404-class error so the honest "Not available on this
 * deployment yet" card shows, never a scary "Could not reach the backend".
 */
const resWith = (contentType: string | null) => ({
  headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? contentType : null) },
})

describe('isSpaFallthrough', () => {
  it('detects the SPA shell by content-type', () => {
    expect(isSpaFallthrough(resWith('text/html; charset=utf-8'), '<!doctype html>')).toBe(true)
  })

  it('detects the SPA shell by body sniff even without a content-type', () => {
    expect(isSpaFallthrough(resWith(null), '  <!DOCTYPE html><html>')).toBe(true)
    expect(isSpaFallthrough(resWith(null), '<html lang="en">')).toBe(true)
  })

  it('does not flag a real JSON payload', () => {
    expect(isSpaFallthrough(resWith('application/json'), '{"data":[]}')).toBe(false)
    expect(isSpaFallthrough(resWith(null), '[{"id":"x"}]')).toBe(false)
    expect(isSpaFallthrough(resWith(null), '')).toBe(false)
  })
})
