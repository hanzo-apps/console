import { test, expect } from '@playwright/test'
import { primeSession } from './_session'

/**
 * Chrome must SURVIVE a navigation. A full document load re-runs the whole shell:
 * the sidebar re-mounts, scroll position is lost, and every chrome animation
 * replays. The measurement is a document-level marker: stamp the window, navigate,
 * and see whether the stamp is still there. A client-side route keeps it; a hard
 * reload wipes it.
 */
test('navigating does not reload the document', async ({ page }) => {
  await primeSession(page)
  await page.route('**/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }),
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Token volume', { exact: true })).toBeVisible({ timeout: 30_000 })

  // Count real document loads, and stamp this one.
  let loads = 0
  page.on('load', () => { loads++ })
  await page.evaluate(() => { (window as unknown as Record<string, unknown>).__stamp = 'kept' })

  await page.getByLabel('Open Playground').click()
  await page.waitForTimeout(4000)

  const stamp = await page.evaluate(() => (window as unknown as Record<string, unknown>).__stamp ?? null)
  console.log(`url=${page.url()} documentLoads=${loads} stamp=${stamp}`)
  expect(stamp, 'the document reloaded on navigation — the shell re-mounted').toBe('kept')
})
