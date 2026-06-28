import { defineConfig, devices } from '@playwright/test'

/**
 * E2E config for console2.
 *
 * Tests are HERMETIC: the cloud `/v1` backend and the `/paas` proxy are mocked
 * with Playwright route interception (see test/e2e/fixtures.ts), so the suite is
 * deterministic and never touches real prod data. The webServer builds and
 * serves the REAL Next app, so every assertion is against real rendered UI and
 * real client logic.
 *
 * Run: `npm run test:e2e` (one command; builds + serves + tests).
 */
const PORT = 4000
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'en-US',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run start',
    url: BASE_URL,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    env: { NODE_OPTIONS: '--max-old-space-size=6144' },
  },
})
