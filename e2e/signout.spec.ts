/**
 * Sign-out reaches the issuer.
 *
 * Signing out is two things — end the session at hanzo.id, and clear this
 * browser — and the console did the second and then failed to do the first, for
 * a reason no unit test can see: it published a null account BEFORE navigating,
 * the entry gate authorized on that, and the gate's `location` assignment landed
 * after the issuer hop and superseded it. The browser went to `authorize`, the
 * issuer's session was never asked to end, and silent SSO returned the person to
 * the console they had just left.
 *
 * Only a browser can measure that: both halves are `window.location` writes in
 * the same turn, and which one the document ends up committing is the whole
 * question. So this asserts the ADDRESS the browser actually left for, with the
 * issuer stubbed so the run is hermetic and never touches production IAM.
 */
import { test, expect } from '@playwright/test'

import { primeSession } from './_session'

const ISSUER = 'https://hanzo.id'

test('signing out leaves for the issuer, and nothing else navigates first', async ({ page }) => {
  // Every address the document tries to leave for, in order.
  const departures: string[] = []
  await page.route(`${ISSUER}/**`, (route) => {
    departures.push(route.request().url())
    // Refused rather than served, so the document stays on the console's own
    // origin and its storage is still readable below. Committing the navigation
    // would land on the issuer's origin, where `primeSession`'s init script runs
    // again and re-seeds the very keys this is about to check.
    return route.abort()
  })

  await primeSession(page)
  await page.goto('/')

  await page.getByTestId('nav-user').first().click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()

  await expect
    .poll(() => departures.length, { message: 'the browser never left for the issuer' })
    .toBeGreaterThan(0)

  // The FIRST place it goes must be the end-session endpoint. Reaching authorize
  // instead is the bug restated: the session survives and sign-in is silent.
  const first = departures[0]
  expect(first, `first departure was ${first}`).toContain('/v1/iam/oauth/logout')
  expect(first).not.toContain('/oauth/authorize')
})
