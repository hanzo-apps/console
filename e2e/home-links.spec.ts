import { test, expect } from '@playwright/test'
import { primeSession } from './_session'

// Every model card must NAVIGATE. The first version rendered inert Views — a card
// that looks pressable and does nothing is worse than a plain list.
test('model cards navigate to the catalog', async ({ page }) => {
  await primeSession(page)
  await page.route('**/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }),
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Token volume', { exact: true })).toBeVisible({ timeout: 30_000 })

  await page.getByLabel('Enso — open the model catalog').click()
  await page.waitForTimeout(2500)
  expect(page.url()).toContain('/models')
})

test('the explore strip opens a product', async ({ page }) => {
  await primeSession(page)
  await page.route('**/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }),
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Explore the cloud', { exact: true })).toBeVisible({ timeout: 30_000 })
  await page.getByLabel('Open Playground').click()
  await page.waitForTimeout(2500)
  expect(page.url()).toContain('/playground')
})
