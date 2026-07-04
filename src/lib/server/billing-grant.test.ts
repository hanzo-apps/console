import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * The signup-time welcome grant — the WRITE-path onboarding paywall fix. Proves it
 * POSTs commerce's idempotent `grant-starter` with the SERVICE bearer + `X-Org-Id` +
 * the personal-org subject body, no-ops honestly when unconfigured, and SWALLOWS any
 * failure so a grant hiccup never blocks signup (the read-path self-heal re-lands it).
 */
const { fetchWithTimeout, baseUrl, token } = vi.hoisted(() => ({
  fetchWithTimeout: vi.fn(),
  baseUrl: vi.fn(() => 'http://commerce.test'),
  token: vi.fn(() => 'svc-token'),
}))
vi.mock('./fetch-timeout', () => ({ fetchWithTimeout }))
vi.mock('./billing-proxy', () => ({ commerceBaseUrl: baseUrl, commerceServiceToken: token }))

import { grantWelcomeCredit } from './billing-grant'

describe('grantWelcomeCredit (server-to-server starter grant)', () => {
  beforeEach(() => {
    fetchWithTimeout.mockReset()
    baseUrl.mockReturnValue('http://commerce.test')
    token.mockReturnValue('svc-token')
  })

  it('POSTs grant-starter with the service bearer, X-Org-Id, and subject body', async () => {
    fetchWithTimeout.mockResolvedValue({ ok: true })
    const ok = await grantWelcomeCredit('acme-personal')
    expect(ok).toBe(true)
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1)
    const [url, init] = fetchWithTimeout.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe('http://commerce.test/v1/billing/grant-starter')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer svc-token')
    expect(init.headers['X-Org-Id']).toBe('acme-personal')
    expect(JSON.parse(init.body as string)).toEqual({ user: 'acme-personal', trigger: 'console_signup' })
  })

  it('is a no-op (false) when the service token is unset', async () => {
    token.mockReturnValue('')
    expect(await grantWelcomeCredit('acme')).toBe(false)
    expect(fetchWithTimeout).not.toHaveBeenCalled()
  })

  it('is a no-op (false) for an empty org slug', async () => {
    expect(await grantWelcomeCredit('')).toBe(false)
    expect(fetchWithTimeout).not.toHaveBeenCalled()
  })

  it('swallows a non-ok commerce response (returns false, never throws)', async () => {
    fetchWithTimeout.mockResolvedValue({ ok: false })
    await expect(grantWelcomeCredit('acme')).resolves.toBe(false)
  })

  it('swallows a network failure (returns false, never throws)', async () => {
    fetchWithTimeout.mockRejectedValue(new Error('commerce down'))
    await expect(grantWelcomeCredit('acme')).resolves.toBe(false)
  })
})
