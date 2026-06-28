import { test, expect, ACCOUNTS, baseline, trackConsoleErrors } from './fixtures'

/**
 * Every key route must render with a CLEAN browser console — no uncaught errors,
 * no React crashes. Honest-empty backend, admin session (so admin routes load).
 */
const ROUTES = [
  '/',
  '/providers',
  '/models',
  '/model-catalog',
  '/chat',
  '/plans',
  '/status',
  '/o11y',
  '/sessions',
  '/scores',
  '/settings',
  '/iam',
  '/audit',
  '/secrets',
  '/clusters',
  '/kubernetes',
  '/vector',
  '/playground',
  '/api-keys',
  '/agents', // a soon module
]

test.describe('clean browser console', () => {
  for (const route of ROUTES) {
    test(`no console errors on ${route}`, async ({ page, backend }) => {
      baseline(backend).account(ACCOUNTS.admin)
      const errors = trackConsoleErrors(page)
      await page.goto(route)
      await expect(page.getByTestId('page-content')).toBeVisible()
      await page.waitForTimeout(400) // let async loads settle so late errors surface
      expect(errors, `console errors on ${route}`).toEqual([])
    })
  }
})
