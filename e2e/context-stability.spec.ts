/**
 * Navigating must not hand the app a new context value.
 *
 * The console's shell reads the assistant's context (`Dashboard` takes `column`
 * from `useFloatingChat`), so a provider that builds its value inline gives every
 * consumer a NEW object on each render — and `Chat` renders on every navigation,
 * because it reads `usePathname()`. Clicking an account-menu entry therefore
 * redrew the whole console to deliver an assistant that had not changed. Measured
 * on this spec's own recorder: 1296 components across the click, 1170 of them in
 * the route commit; 856 and 730 once the value was memoized.
 *
 * The assertion is on the CAUSE rather than on a component count, which drifts
 * with every feature: after a plain route change, no context the app owns may
 * change identity. A real state change (an account loading, a preference being
 * written) is a different event and is not what this exercises — the route here is
 * visited twice first, so nothing about the app is left to settle.
 */
import { test, expect } from '@playwright/test'
import { primeSession } from './_session'
import { recordCommits, resetCommits, readCommits, summarize } from './_rerender'

/** The context values this app owns, by their members — no displayName needed. */
const APP_CTX = /prefs,ready,get,set|isOpen,open,close|enabled,gated|account,loading|org,project/

test('a route change alone changes no app context value', async ({ page }) => {
  await page.route(/\/(v1|ai|admin)\//, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', data: [] }) }),
  )
  await recordCommits(page)
  await primeSession(page, { owner: 'admin', name: 'z', email: 'z@hanzo.ai', displayName: 'Z Admin' })

  await page.goto('/')
  await page.waitForSelector('[data-testid=nav-user]', { state: 'attached', timeout: 60_000 })
  await page.waitForTimeout(4000)

  const go = async (label: string, path: string) => {
    await page.getByTestId('nav-user').first().click()
    await page.locator('[role=menu]').waitFor()
    await page.waitForTimeout(800)
    await resetCommits(page)
    await page.getByRole('menuitem', { name: label }).click()
    await page.waitForURL(`**${path}`, { timeout: 15_000 })
    await page.waitForTimeout(2500)
    return summarize(await readCommits(page))
  }

  // Visit both first: the once-per-product "you opened this" preference write is a
  // real state change, and it must not be mistaken for the churn under test.
  await go('Profile', '/profile')
  await go('Billing & usage', '/billing')

  const s = await go('Profile', '/profile')
  console.log(`profile click: ${s.commits} commits, ${s.components} components, ${s.ms}ms`)
  expect(s.ctx.filter(([k]: [string, number]) => APP_CTX.test(k))).toEqual([])
})
