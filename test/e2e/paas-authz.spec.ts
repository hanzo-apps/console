import { test, expect } from '@playwright/test'

/**
 * The `/paas` proxy attaches a powerful platform service token, so it is gated
 * deny-by-default IN the real server route. These tests deliberately do NOT use
 * the `backend` fixture (which mocks `/paas` in the browser) — they hit the REAL
 * Next route with no session, which must refuse with 401 before any token/config
 * is touched.
 */
test.describe('/paas proxy — server-side deny-by-default', () => {
  test('unauthenticated requests are 401 for every verb', async ({ request }) => {
    const methods = ['get', 'post', 'patch', 'delete'] as const
    for (const method of methods) {
      const res = await request[method]('/paas/apps')
      expect(res.status(), `${method.toUpperCase()} /paas/apps → 401`).toBe(401)
    }
  })

  test('auth precedes the not-configured state (no 501 leak to anon)', async ({ request }) => {
    const res = await request.get('/paas/apps')
    expect(res.status()).toBe(401)
    const body = await res.json().catch(() => ({}))
    expect(JSON.stringify(body)).not.toContain('PAAS_SERVICE_TOKEN')
  })
})
