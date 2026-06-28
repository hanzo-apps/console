import { test, expect } from '@playwright/test'

/**
 * Security headers (next.config). Asserts the strict header set is present on
 * real responses AND that the app still renders under the CSP with zero CSP
 * violations — a broken CSP would white-screen the white-label app, so this is
 * both the policy check and the render check.
 */
test.describe('security headers', () => {
  test('every response carries the strict header set', async ({ request }) => {
    const res = await request.get('/signin')
    expect(res.status()).toBeLessThan(400)
    const h = res.headers()
    const csp = h['content-security-policy'] ?? ''
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain('form-action')
    expect(csp).toContain('connect-src')
    expect(h['x-frame-options']).toBe('DENY')
    expect(h['x-content-type-options']).toBe('nosniff')
    expect(h['referrer-policy']).toBe('no-referrer')
    expect(h['strict-transport-security']).toContain('max-age=')
    expect(h['permissions-policy']).toContain('geolocation=()')
  })

  test('the app renders under CSP with no CSP violations', async ({ page }) => {
    const violations: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error' && /content security policy|refused to (?:execute|load|apply)/i.test(m.text())) {
        violations.push(m.text())
      }
    })
    await page.goto('/signin')
    await expect(page.getByText('Sign in to manage your cloud.')).toBeVisible()
    expect(violations, violations.join('\n')).toEqual([])
  })
})
