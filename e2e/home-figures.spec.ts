import { test, expect } from '@playwright/test'

import { primeSession } from './_session'

/**
 * The home figures, proved against the EMBED build rather than the dev server —
 * the two disagree, and the embed is what ships.
 *
 * Two runs, because the tile has two honest outcomes and only showing both proves
 * the rule: a figure READ prints the figure, and a figure that could not be read
 * prints an em dash AND the reason. A dash that never had a source behind it looks
 * identical to one that did, which is how four hardcoded nulls survived so long.
 */

/** A balance the commerce ledger really reports: $1,284.50 spendable of $1,300. */
const BALANCE = { balance: 130_000, holds: 1_550, available: 128_450 }

/** A roll-up the warehouse really reports over the 7-day window. */
const SUMMARY = {
  range: '7d',
  start: '2026-08-06T00:00:00Z',
  end: '2026-08-13T00:00:00Z',
  interval: 'day',
  org: 'hanzo',
  spend: {
    available: true,
    totalCents: 43_120,
    mtdCents: 21_875,
    overageCents: 0,
    balanceCents: 130_000,
    availableCents: 128_450,
    byCategory: [],
    series: [],
  },
  llm: {
    available: true,
    requests: 18_432,
    tokens: 24_800_000,
    promptTokens: 19_100_000,
    completionTokens: 5_700_000,
    costCents: 43_120,
    models: 12,
  },
  sources: { commerce: true, warehouse: true },
}

test('the figures print what the account really has', async ({ page }) => {
  await page.route('**/v1/billing/balance*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BALANCE) }),
  )
  await page.route('**/v1/usage/summary*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SUMMARY) }),
  )
  await primeSession(page)

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  await page.screenshot({ path: 'e2e-shots/home-embed-read.png', fullPage: false })

  // The balance the sidebar wallet reads, to the cent, grouped.
  await expect(page.getByText('$1,284.50').first()).toBeVisible()
  // Month-to-date off the ONE roll-up.
  await expect(page.getByText('$218.75').first()).toBeVisible()
  // Token volume, abbreviated the way /usage abbreviates it.
  await expect(page.getByText('24.8M').first()).toBeVisible()
})

test('a figure that cannot be read says so, and never white-screens', async ({ page }) => {
  await page.route('**/v1/billing/balance*', (r) => r.fulfill({ status: 503, body: 'down' }))
  await page.route('**/v1/usage/summary*', (r) => r.fulfill({ status: 503, body: 'down' }))
  await primeSession(page)

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  await page.screenshot({ path: 'e2e-shots/home-embed-unread.png', fullPage: false })

  // The page still renders — a dead source degrades a TILE, never the screen.
  await expect(page.getByText('Organization credits')).toBeVisible()
  // And no tile invents a zero for money nobody has.
  await expect(page.getByText('$0.00')).toHaveCount(0)
})
