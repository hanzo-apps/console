import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright e2e config targeting console.hanzo.ai (live) and localhost:4000 (dev).
 * Run against production: BASE_URL=https://console.hanzo.ai pnpm e2e
 * Run against dev:        pnpm dev  # then pnpm e2e (default)
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,

  use: {
    baseURL: process.env.BASE_URL ?? 'https://console.hanzo.ai',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Needed for Tamagui/RNW rendering (blocks by default on non-Chromium)
    headless: true,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
